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
    lastUpdatedAt: Number         // Unix ms from Date.now()
  }
}
```

Behaviour:

- **Write-through:** after a successful DB write, `updateCacheBalance` adjusts `balance` immediately.
- **Concurrency lock:** `status: "processing"` blocks concurrent writes via `checkResourceLock` middleware (`409`).
- **Lock release:** `withUserLock` sets `status` back to `"idle"` in a `finally` block.

Implementation lives in `src/utilis/balanceCache.js`; the cache object itself is owned by `src/controllers/transactions.js`.

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

Extract **`ensureBalanceCache`** and call it on **every transaction write path** before lock / balance mutation:

| Operation | When `ensureBalanceCache` runs |
|---|---|
| POST (create) | Before balance check and `processing` status |
| PATCH (update) | Before `processing` status |
| DELETE | Before `processing` status |

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

---

## Related documents

- [`API.md`](./API.md) — full endpoint contract
- [`README.md`](./README.md) — setup, stack, and high-level architecture
- [`FRONTEND_LABS.md`](./FRONTEND_LABS.md) — idempotency and concurrency demos
