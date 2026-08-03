<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/vaultex_dark.jpg" />
    <img src="./public/vaultex_light.jpg" alt="Vaultex" width="280" />
  </picture>
</p>

<h1 align="center">Vaultex</h1>

<p align="center">
  Vaultex is a personal income & expense tracker API — a production-minded <strong>Node.js/Express</strong> REST API built for data integrity and concurrency safety.
</p>

<p align="center">
  <a href="./API.md"><strong>API.md</strong></a> ·
  <a href="./decision.md"><strong>decision.md</strong></a> ·
  <a href="./FRONTEND_LABS.md"><strong>FRONTEND_LABS.md</strong></a>
</p>

---

## Table of Contents

- [Project Evolution](#project-evolution)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Security & Architectural Decisions](#security--architectural-decisions)
- [RBAC Model](#rbac-model)
- [API Documentation](#api-documentation)
- [Design Assumptions](#design-assumptions)
- [Setup & Installation](#setup--installation)
- [Docker (Development)](#docker-development)
- [Environment Variables](#environment-variables)

---

## Project Evolution

This repository started as a **backend assessment** focused on concurrency patterns for a multi-role FinTech API (RBAC with `admin` / `analyst` / `viewer`, local JWT login with HS256 + bcrypt, and in-memory idempotency keys).

It has been evolved into **Vaultex v1** with these intentional changes:

| Area | Assessment (original) | Vaultex v1 (current) |
|---|---|---|
| Product scope | Multi-role financial API | Single-owner personal income/expense tracker |
| Auth | Local login/signup issuing HS256 JWTs | External auth service; this API verifies **RS256** JWTs from a cookie using JWKS (`jwks-rsa`, issuer `auth-service`) |
| Users | Full credential user documents | Shadow `users` collection (`_id` = auth `sub`, plus `name`, `role`, `plan`) |
| RBAC | Enforced via `checkUserPermission` | Removed — every authenticated user only accesses their own data |
| Idempotency | In-memory `proccessedTransactionKeys` map | Persisted on each transaction (`idempotencyKey` + unique MongoDB index) |
| Async errors | Custom `asyncHandler` wrapper | Removed — Express 5 forwards rejected promises natively |
| Concurrency | In-memory per-user lock via `balanceCache.status` | Unchanged for v1 (single instance); Redis deferred to v2 |
| Balance cache | Aggregation on expense cache miss only | `ensureBalanceCache` rebuilds from DB on **any** write-path cache miss (POST/PATCH/DELETE) |
| Shadow profile | Optional `name` on create | **`name` required** (Zod + service + Mongoose) |
| Docs | API details embedded in this README | [`API.md`](./API.md) (contract) + [`decision.md`](./decision.md) (rationale) |

Sections below that describe the original assessment design (especially RBAC and local HS256 auth) are kept for historical context. Prefer [`API.md`](./API.md), [`decision.md`](./decision.md), and the current source tree for implementing the React frontend.

---

## Features

- **External JWT Authentication** — RS256 verification via HttpOnly cookie; public key cached in memory
- **Shadow User Profiles** — local `users` collection keyed by auth service `sub`; **`name` is required** on profile create (`role: user`, `plan: free`)
- **Full Transaction CRUD** with ownership enforcement
- **Soft Delete** — records are never hard-deleted; `deletedAt` timestamp is set instead
- **Idempotency** — `X-Idempotency-Key` stored on each transaction with a unique MongoDB index (success-only semantics)
- **Write-Through Balance Caching** — `src/utilis/balanceCache.js` keeps balance current; `ensureBalanceCache` rebuilds from MongoDB aggregation on cache miss
- **In-Memory Concurrency Locking** — per-user mutex via `balanceCache.status` prevents race conditions on writes
- **Stale Cache Eviction** — hourly sweep removes `balanceCache` entries older than 24 hours (`lastUpdatedAt` stored as Unix ms)
- **User-Based Rate Limiting** — throttled by `userId`, not IP
- **Analytics Aggregation** — income/expense totals and category breakdowns via MongoDB `$facet`
- **Zod Schema Validation** — strict input validation with partial schemas for `PATCH` routes
- **Global Error Handler** — centralised error responses with stack traces gated to `development`
- **Auth Bypass Flag** — `BYPASS_AUTH=true` skips JWT verification in development

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Framework | Express 5 |
| Database | MongoDB via Mongoose 9 |
| Validation | Zod 4 |
| Auth | jsonwebtoken (RS256 verify) |
| Rate Limiting | express-rate-limit 8 |
| Error Handling | http-errors |
| Containerisation | Docker + Docker Compose |

---

## Project Structure

```
.
├── app.js                        # Express app setup
├── server.js                     # Server entry point + balanceCache eviction
├── API.md                        # Current API contract (use this for frontend)
├── decision.md                   # Architecture & design decisions (rationale)
├── public/
│   ├── vaultex_light.jpg         # Brand logo (light theme)
│   └── vaultex_dark.jpg          # Brand logo (dark theme)
├── Docker/
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── compose.dev.yml
└── src/
    ├── config/                   # App config & Mongoose connection
    ├── controllers/              # Request handling layer
    ├── middleware/               # Auth, rate limiting, locking, ownership
    ├── routes/                   # Express routers
    ├── schema/                   # Mongoose models (User, Transaction)
    ├── services/                 # Business logic layer
    ├── utilis/                   # dbOperation, balanceCache + lock helpers
    └── validationSchemas/        # Zod schemas
```

**Architecture pattern:** MVC with a dedicated **Service Layer**. Controllers handle HTTP concerns; services contain all business logic and receive their dependencies via injection, keeping them decoupled and testable.

**Why MVC over feature/domain-based structure?** An alternative would be to organise the codebase around domain events — e.g. a `transactions/` folder containing its own route, controller, service, schema, and middleware. For a microservices or multi-domain system that organisation scales better and keeps each feature self-contained. However, this project is a monolith with a single primary domain (transactions), so the added overhead of feature-based scaffolding provides no practical benefit. MVC was chosen for its simplicity and familiarity in this scope.

---

## Security & Architectural Decisions

> Historical note: the subsections immediately below document decisions from the original assessment. In v1, authentication is RS256 against an external auth service and RBAC has been removed. See [Project Evolution](#project-evolution) and [`API.md`](./API.md).

### Authentication — Symmetric JWT (HS256)

Tokens are signed with **HS256** (HMAC-SHA256), a symmetric algorithm using a single shared secret. Asymmetric signing (RS256) was deliberately omitted — in this monolithic scope there are no separate resource servers that need to verify tokens without access to the signing key, so the added key-pair management overhead of RSA provides no practical benefit. Tokens are delivered and read exclusively via **`HttpOnly` cookies**, preventing client-side JavaScript from ever accessing the credential.

- Algorithm: `HS256`
- Expiry: `12h`
- Claim structure: `sub` (userId) + `userInfo.role`

### Constant-Time Password Comparison (Timing Attack Prevention)

To prevent **user enumeration via timing side-channels**, the login flow always runs a full `bcrypt.compare()` regardless of whether the user account exists:

```js
// src/services/user.js
const userPassword = userData?.password || uuidv4();
const verify = await bcrypt.compare(inputValidation.password, userPassword);
```

If the user is not found, a random UUIDv4 string is used as the comparison target. Because `bcrypt.compare` executes its full hashing routine against any string, the response time for a non-existent user is statistically indistinguishable from that of an existing user with a wrong password — eliminating the timing delta that would otherwise reveal valid email addresses.

### Idempotency & In-Memory Locking

Every `POST /transactions` request must include an `X-Idempotency-Key` header. The system maintains an in-memory map (`processedTransactionKeys`) tracking key status:

- **`processing`** — the request is currently being handled
- **`processed`** — the transaction was committed; the cached response is returned verbatim

When a duplicate key is detected, the response includes the header **`Idempotency-Replay: true`** so clients can distinguish a replayed response from a fresh one.

For write operations (create, update, delete, lab bulk delete), the **`acquireUserLock`** middleware atomically sets the user's balance cache status to `processing` and stores the in-flight `X-Idempotency-Key` (for creates). Concurrent writes with a **different** key receive **`409`** until the owner completes. Parallel creates with the **same** key are allowed through (same-key pass-through) so idempotency replay can run; only the lock owner releases on `res.finish` or `res.close`. This prevents race conditions such as double-spending on expense transactions while keeping same-key idempotent retries unblocked.

### 🔄 State-Aware Idempotency Logic

A critical architectural decision was made to implement **Success-Only Idempotency**. Unlike a standard request cache, this system distinguishes between "Business Logic Failures" and "Successful State Changes":

* **Failure Handling:** If a request fails due to `Insufficient Funds` or `Validation Errors`, the `X-Idempotency-Key` is **not** cached. 
* **Success Persistence:** Once a transaction is successfully committed to the database, the response is cached. Subsequent retries with the same key will return the cached data with an `Idempotency-Replay: true` header, preventing double-spending or duplicate record creation.

### Write-Through Balance Caching

An in-memory `balanceCache` is maintained as a **write-through cache**. Each entry:

```js
{ balance: Number, status: "idle" | "processing", lastUpdatedAt: Number }
```

- On every successful transaction write, `updateCacheBalance` adjusts the cached balance
- On a **cache miss** (eviction after 24h idle, server restart, or first write), `ensureBalanceCache` runs a MongoDB aggregation (`income − expense`) before any balance check or delta — on **POST, PATCH, and DELETE**
- The cache also doubles as the concurrency lock store (via the `status` and `processingIdempotencyKey` fields); acquire/release helpers live in `src/utilis/balanceCache.js`, middleware in `src/middleware/acquireUserLock.js`

This removes redundant `$group` aggregation on every write while keeping the cached value consistent with the database after eviction. See [`decision.md`](./decision.md) for full rationale.

### User-Based Rate Limiting

Rate limiting is keyed on **`userId`** (not IP address):


IP-based limiting is easily bypassed with proxies or shared IPs in corporate environments. Keying on the authenticated user identity prevents a single account from scripting bulk requests regardless of the originating IP — a meaningful control for a financial API.

Limit: **100 requests per 15-minute window** per user.

### Soft Delete

Transactions are never physically removed. A `deletedAt: Date | null` field on the schema marks deletion; all queries filter on `{ deletedAt: null }`. This preserves the full audit trail, which is a regulatory requirement in financial systems.

### Zod Validation — Partial Schemas & Type Coercion

- `transactionSchema` uses `z.coerce.date()` to accept ISO strings from JSON bodies and coerce them to `Date` objects
- `updateTransactionSchema` is derived as `transactionSchema.partial().omit({ type, date })`, enforcing that `type` and `date` are **immutable** after creation at the validation layer itself
- `createUserProfileSchema` requires a non-empty trimmed `name` on `POST /users/profile`

---

## RBAC Model

Permissions are defined as a static map in `src/constants/permissions.js` and enforced by the `checkUserPermission` middleware on every protected route.

### `admin`
Full CRUD operator. Can create, read, update, and delete any transaction, view the analytics dashboard, and provision new user accounts. Intended as the primary operational role.

### `analyst`
Corporate BI / Data Analyst role. Has **global read access** — can read all transactions across all users and access the full analytics dashboard without being scoped to their own userId. Cannot mutate any data.

### `viewer` (default)
Private end-user. Can only view the analytics dashboard, and their analytics query is automatically scoped to their own `userId`. Cannot read raw transactions or mutate any data. All new registrations default to this role.

| Permission | `admin` | `analyst` | `viewer` |
|---|---|---|---|
| `create_transaction` | ✓ | — | — |
| `read_transaction` | ✓ | ✓ | — |
| `update_transaction` | ✓ | — | — |
| `delete_transaction` | ✓ | — | — |
| `view_dashboard` | ✓ | ✓ | ✓ |
| `create_account` | ✓ | — | — |

---

## API Documentation

**Current (v1) API contract for frontend implementation:** [`API.md`](./API.md)

**Design decisions and breaking-change notes:** [`decision.md`](./decision.md)

`API.md` covers authentication, shadow user routes (`GET /users/check`, `POST /users/profile` with required `name`), transactions (including idempotency replay behaviour), analytics, error shapes, and the recommended frontend onboarding sequence.

The assessment-era endpoint tables that previously lived in this section have been superseded by `API.md`.

---

## Design Assumptions

1. **`type` is immutable** — a transaction's type (`income` / `expense`) cannot be changed after creation. Changing the type of a transaction would fundamentally alter the financial record and its contribution to the account balance. This is enforced at the Zod schema level by omitting `type` from `updateTransactionSchema`.

2. **`date` is immutable** — the transaction date represents when the financial event occurred and cannot be backdated after the fact. Also enforced by `updateTransactionSchema`.

3. **Balance is derived, not stored** — the authoritative balance is always computed from transaction records. The in-memory cache is a performance optimisation, not the source of truth; `ensureBalanceCache` re-aggregates from the database on cache miss.

4. **Expense validation** — the system checks that a user's current balance is sufficient before committing an expense transaction, preventing negative balances.

5. **Profile `name` is required** — shadow profiles must include a display name at creation time (validated by Zod, enforced in the service before DB access, and required in the Mongoose schema).

---

## Setup & Installation

### Prerequisites

- Node.js >= 22.x (for native `--env-file` support)
- MongoDB instance (local or Atlas)

### Steps

```bash
# 1. Clone the repository
git clone <repository-url>
cd <folder_name>

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.sample .env.development
# Fill in the required values (see Environment Variables section)

# 4. Start the development server (with file watching)
npm run dev
```

The server starts on the port defined in your `.env.development` file.

### Health Check

```bash
curl http://localhost:<PORT>/health
# { "message": "Ok" }
```

---

## Docker (Development)

The Compose setup spins up the Node.js app alongside a MongoDB container with a persistent named volume.

```bash
# Start services with live-reload (Docker Compose Watch)
docker compose -f Docker/compose.dev.yml up --watch

# Stop services
docker compose -f Docker/compose.dev.yml down
```

File changes under the project root are synced into the container automatically. `package.json` changes trigger a full image rebuild.

---

## Environment Variables

See `.env.sample` for all required variables:

```env
PORT=           # Port the server listens on (e.g. 3000)
NODE_ENV=       # 'development' or 'production'
DB_URI=         # MongoDB connection string
BYPASS_AUTH=    # Set to 'true' to skip JWT verification in development
```

> **Security note:** `BYPASS_AUTH` is only respected when `NODE_ENV=development`. It should never be set to `true` in production.

> **Auth note (v1):** JWT verification uses RS256 against the auth service JWKS endpoint via `jwks-rsa` (`src/utilis/jwt.js`). There is no local `JWT_SECRET` in this service anymore.

---

## Assignment Reflection

I completed this assignment in 24 hours and submitted it more than 48 hours before the deadline so I could travel properly and not miss the opportunity.
While traveling, I found out that the company was fake and not genuine.
Even though the company was fake, I learned a lot from this assignment about idempotency, race conditions, and locks to prevent race conditions in depth.
