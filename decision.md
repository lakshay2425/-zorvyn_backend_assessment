# Architecture & Design Decisions

This document records intentional decisions made during the evolution of **Personal Income & Expense Tracker v1**, including changes from the concurrency and user-profile hardening work.

For the live API contract, see [`API.md`](./API.md).

---

## Table of contents

1. [Required `name` on shadow profile creation](#1-required-name-on-shadow-profile-creation)
2. [Write-through balance cache](#2-write-through-balance-cache)
3. [Cache rebuild on miss (all write paths)](#3-cache-rebuild-on-miss-all-write-paths)
4. [Cache entry shape and eviction](#4-cache-entry-shape-and-eviction)
5. [Dependency injection for cache helpers](#5-dependency-injection-for-cache-helpers)
6. [Bulk lab transaction cleanup](#6-bulk-lab-transaction-cleanup)

---

## 1. Required `name` on shadow profile creation

### Context

The shadow user profile (`POST /api/users/profile`) originally treated `name` as optional. An empty body `{}` was valid, and the service only added `name` to the payload when it was not `undefined`.

### Decision

**`name` is required** at every layer:

| Layer | Enforcement |
|---|---|
| Zod (`createUserProfileSchema`) | `z.string().trim().min(1)` — no `.optional()` |
| Service (`createUserProfileService`) | Early return `400` with `"Name is required"` before any DB call |
| Mongoose (`user` schema) | `name: { type: String, required: true }` |

### Rationale

- A FinTech-style profile without a display name is a weak onboarding experience and an incomplete record.
- Rejecting invalid payloads **before** `findById` / `create` avoids unnecessary database work.
- Aligning validation (Zod), service logic, and schema prevents drift where the API accepts data the database should not store.

### Alternatives considered

| Option | Why not chosen |
|---|---|
| Keep `name` optional (shadow profile only needs `_id`) | Product decision: profile creation should mean a complete minimal identity |
| Rely on Zod only | Service-level guard adds defense in depth if validation is bypassed in tests or future refactors |

### Consequences

- **Breaking change for clients:** `POST /api/users/profile` must send `{ "name": "..." }`.
- `GET /api/users/check` and all transaction/analytics endpoints are unchanged.

---

## 2. Write-through balance cache

### Context

Expense creates need a fast balance check to reject insufficient funds without running a MongoDB aggregation on every request. Concurrent writes from the same user must not race (e.g. double-spend).

### Decision

Maintain an in-memory **`balanceCache`** keyed by `userId`:

```js
{
  [userId]: {
    balance: Number,              // net balance: total income − total expense
    status: "idle" | "processing",
    processingIdempotencyKey: string | null, // in-flight create key (POST only)
    lastUpdatedAt: Number         // Unix ms from Date.now()
  }
}
```

Behaviour:

- **Write-through:** after a successful DB write, `updateCacheBalance` adjusts `balance` immediately.
- **Concurrency lock:** `acquireUserLock` middleware atomically sets `status: "processing"` via `tryAcquireUserLock` in `balanceCache.js`. Concurrent writes with a **different** (or missing) idempotency key receive `409`.
- **Same-key pass-through:** if the lock is held and the incoming `X-Idempotency-Key` equals `processingIdempotencyKey`, the request is allowed through without taking ownership. Create-path `findOne` / unique-index (`11000`) handling returns idempotent replay. Pass-through requests do **not** register lock release.
- **Lock release:** only the lock owner registers release on `res.finish` and `res.close` (`releaseUserLock` sets `status` back to `"idle"` and clears `processingIdempotencyKey`).

Implementation lives in `src/utilis/balanceCache.js` (helpers) and `src/middleware/acquireUserLock.js`; the cache object itself is owned by `src/controllers/transactions.js`.

### Rationale

- Single-process v1 does not need Redis; in-memory state is sufficient for demo/single-instance deployment.
- Combining balance cache and lock state avoids a second concurrent structure per user.

### Trade-offs

| Benefit | Cost |
|---|---|
| Fast expense balance checks | Cache is per-process; not shared across horizontal replicas (Redis deferred to v2) |
| Simple lock model | Stale entries must be evicted manually |

---

## 3. Cache rebuild on miss (all write paths)

### Context

Originally, a full MongoDB aggregation (rebuild from DB) ran only on **POST expense** when the cache entry was missing. **PATCH**, **DELETE**, and **POST income** seeded missing entries with `{ balance: 0 }` and applied a delta — incorrect after cache eviction (24h idle) or first touch on those paths.

### Decision

Extract **`ensureBalanceCache`** and call it on **every transaction write path** after middleware acquire / before balance mutation:

| Operation | When `ensureBalanceCache` runs |
|---|---|
| POST (create) | After middleware acquire; before balance check |
| PATCH (update) | After middleware acquire |
| DELETE | After middleware acquire |
| DELETE `/lab` (bulk) | After middleware acquire |

`updateCacheBalance` also calls `ensureBalanceCache` internally so any balance adjustment self-heals on miss.

Aggregation logic (single source of truth):

```js
$match: { userId, deletedAt: null }
$group: { _id: "$type", totalAmount: { $sum: "$amount" } }
balance = incomeTotal − expenseTotal
```

### Rationale

- Cache accuracy matters for insufficient-funds checks and for consistent write-through updates.
- One helper removes duplicated aggregation code and prevents paths from diverging again.

### Trade-off

An extra aggregation on cache miss for PATCH/DELETE/income — acceptable because misses are infrequent (eviction after 24h idle, or first write after server restart).

---

## 4. Cache entry shape and eviction

### `lastUpdatedAt` as `Number`, not `Date`

**Decision:** Store `lastUpdatedAt` as milliseconds since epoch (`Date.now()`), documented as `Number` in the cache comment.

**Rationale:**

- Matches what the code actually stores (no `Date` object serialization concerns).
- Eviction in `server.js` uses simple arithmetic: `now - entry.lastUpdatedAt > TWENTY_FOUR_HOURS_MS`.

### Eviction policy

**Decision:** Hourly sweep deletes entries where `lastUpdatedAt` is older than 24 hours (or missing).

**Rationale:** Bound memory growth for long-running single-instance servers without affecting active users (their entries are refreshed on each write).

### Rebuild after eviction

After eviction, the next write for that user triggers `ensureBalanceCache` → full aggregation → correct balance before any delta is applied. No client action required.

---

## 5. Dependency injection for cache helpers

### Context

Cache utilities need `balanceCache`, `transactionModel`, and `mongoose`. Services should stay testable and not import controller-owned state directly.

### Decision

1. **Low-level functions** in `src/utilis/balanceCache.js` accept all dependencies explicitly:
   - `ensureBalanceCache(userId, balanceCache, transactionModel, mongoose)`
   - `updateCacheBalance(userId, amount, type, balanceCache, transactionModel, mongoose)`

2. **Controller wrappers** in `src/controllers/transactions.js` bind shared instances and inject into services:

   ```js
   const ensureBalanceCache = (userId) =>
       ensureBalanceCacheFn(userId, balanceCache, transactionModel, mongoose);

   const updateCacheBalance = (userId, amount, type) =>
       updateCacheBalanceFn(userId, amount, type, balanceCache, transactionModel, mongoose);
   ```

3. **Services** receive `ensureBalanceCache` and `updateCacheBalance` via the `dependencies` object — no direct import from `balanceCache.js` in `transaction.js` service.

### Rationale

- Services call simple `(userId)` / `(userId, amount, type)` signatures.
- Controller owns the singleton `balanceCache` object.
- Utils remain pure and unit-testable with mocked dependencies.

### Alternatives considered

| Option | Why not chosen |
|---|---|
| Import `ensureBalanceCache` directly in service | Couples service layer to util signatures and makes controller-owned cache harder to mock |
| Pass six arguments from every service call site | Noisy; binding at the controller is cleaner |

---

## 6. Bulk lab transaction cleanup

### Context

The frontend **Labs** section (see [`FRONTEND_LABS.md`](./FRONTEND_LABS.md)) creates many demo transactions via idempotency and concurrency exercises. Users need a way to reset lab clutter without deleting real transactions. Looping `DELETE /api/transactions/:id` per row is slow, hits rate limits, and contends with the per-user write lock.

### Decision

Add **`DELETE /api/transactions/lab`** — a scoped bulk soft-delete for the authenticated user only.

**Matching categories** (single source of truth in `src/constants/labCategories.js`):

| Category | Origin |
|---|---|
| `Idempotency Lab` | Idempotency Lab creates |
| `Concurrency Lab` | Concurrency Lab expense creates |
| `Concurrency Lab Seed` | Optional demo income before Concurrency Lab runs |

Behaviour:

1. `acquireUserLock` → same `409` model as other writes.
2. `ensureBalanceCache` → DB bulk soft-delete → force cache rebuild (preserve `processing` until response completes).
3. `updateMany` soft-delete: `{ userId, deletedAt: null, category: { $in: LAB_CATEGORIES } }`.
4. **Force cache rebuild:** `delete balanceCache[userId]` then `ensureBalanceCache(userId)` — do not loop `updateCacheBalance` per row.
5. Return `{ deletedCount, balance }`; `deletedCount: 0` is still `200` (idempotent).

Route **must** be registered before `DELETE /:transactionId` so `"lab"` is not parsed as an ObjectId.

### Rationale

- **Scoped, not “delete all”:** real user categories are never touched.
- **Category allowlist (v1):** no schema migration; lab UIs must use the exact category strings above.
- **Full cache rebuild after bulk delete:** avoids drift from many incremental deltas and reuses the existing aggregation in `ensureBalanceCache`.

### Alternatives considered

| Option | Why not chosen |
|---|---|
| Delete all transactions | Too destructive; one misclick wipes real data |
| Frontend loops single DELETE | Many requests, lock/rate-limit friction |
| Lab categories only (exclude seed income) | Leaves demo income behind after cleanup; poor reset UX |
| Add `source: "lab"` schema field | Heavier change; deferred until category matching becomes fragile |

### Consequences

- Frontend **Concurrency Lab** “Add demo income” must use category **`Concurrency Lab Seed`** exactly.
- [`API.md`](./API.md) documents the new endpoint; [`FRONTEND_LABS.md`](./FRONTEND_LABS.md) adds a “Clear lab data” action calling it.

---

## Related documents

- [`API.md`](./API.md) — full endpoint contract
- [`README.md`](./README.md) — setup, stack, and high-level architecture
- [`FRONTEND_LABS.md`](./FRONTEND_LABS.md) — idempotency and concurrency demos
