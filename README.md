# FinTech Core Concurrency API

A production-minded **Node.js/Express** REST API for financial transaction management, built with a focus on data integrity, concurrency safety, and role-aware security.

---

## Table of Contents

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

## Features

- **JWT Authentication** with HttpOnly cookie transport
- **Role-Based Access Control (RBAC)** — `admin`, `analyst`, `viewer`
- **Full Transaction CRUD** with ownership enforcement
- **Soft Delete** — records are never hard-deleted; `deletedAt` timestamp is set instead
- **Idempotency** — duplicate `POST /transactions` requests are safely deduplicated
- **Write-Through Balance Caching** — in-memory cache keeps balance current without redundant aggregation
- **In-Memory Concurrency Locking** — per-user mutex prevents race conditions on writes
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
| Auth | jsonwebtoken (HS256) + bcrypt |
| Rate Limiting | express-rate-limit 8 |
| ID Generation | uuid v4 |
| Error Handling | http-errors |
| Containerisation | Docker + Docker Compose |

---

## Project Structure

```
.
├── app.js                        # Express app setup
├── server.js                     # Server entry point
├── Docker/
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── compose.dev.yml
└── src/
    ├── config/                   # App config & Mongoose connection
    ├── constants/
    │   └── permissions.js        # ACTIONS enum + ROLE_PERMISSIONS map
    ├── controllers/              # Request handling layer
    ├── middleware/               # Auth, RBAC, rate limiting, locking, ownership
    ├── routes/                   # Express routers
    ├── schema/                   # Mongoose models (User, Transaction)
    ├── services/                 # Business logic layer
    ├── utilis/                   # asyncHandler, dbOperation, withUserLock
    └── validationSchemas/        # Zod schemas
```

**Architecture pattern:** MVC with a dedicated **Service Layer**. Controllers handle HTTP concerns; services contain all business logic and receive their dependencies via injection, keeping them decoupled and testable.

**Why MVC over feature/domain-based structure?** An alternative would be to organise the codebase around domain events — e.g. a `transactions/` folder containing its own route, controller, service, schema, and middleware. For a microservices or multi-domain system that organisation scales better and keeps each feature self-contained. However, this project is a monolith with a single primary domain (transactions), so the added overhead of feature-based scaffolding provides no practical benefit. MVC was chosen for its simplicity and familiarity in this scope.

---

## Security & Architectural Decisions

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

For write operations (create, update, delete), a **`withUserLock`** wrapper sets the user's balance cache status to `processing`, blocking any concurrent write from the same user (checked by `checkResourceLock` middleware) until the operation completes. This prevents race conditions such as double-spending on expense transactions.

### 🔄 State-Aware Idempotency Logic

A critical architectural decision was made to implement **Success-Only Idempotency**. Unlike a standard request cache, this system distinguishes between "Business Logic Failures" and "Successful State Changes":

* **Failure Handling:** If a request fails due to `Insufficient Funds` or `Validation Errors`, the `X-Idempotency-Key` is **not** cached. 
* **Success Persistence:** Once a transaction is successfully committed to the database, the response is cached. Subsequent retries with the same key will return the cached data with an `Idempotency-Replay: true` header, preventing double-spending or duplicate record creation.

### Write-Through Balance Caching

An in-memory `balanceCache` (`{ [userId]: { balance, status } }`) is maintained as a **write-through cache**:

- On every successful transaction write, `updateCacheBalance` immediately adjusts the cached balance
- On a new expense, the cache is checked first; a full MongoDB aggregation is only triggered on a cache miss
- The cache also doubles as the concurrency lock store (via the `status` field)

This removes the need for a repeated `$group` aggregation on every write while keeping the cached value consistent with the database.

### User-Based Rate Limiting

Rate limiting is keyed on **`userId`** (not IP address):


IP-based limiting is easily bypassed with proxies or shared IPs in corporate environments. Keying on the authenticated user identity prevents a single account from scripting bulk requests regardless of the originating IP — a meaningful control for a financial API.

Limit: **100 requests per 15-minute window** per user.

### Soft Delete

Transactions are never physically removed. A `deletedAt: Date | null` field on the schema marks deletion; all queries filter on `{ deletedAt: null }`. This preserves the full audit trail, which is a regulatory requirement in financial systems.

### Zod Validation — Partial Schemas & Type Coercion

- `transactionSchema` uses `z.coerce.date()` to accept ISO strings from JSON bodies and coerce them to `Date` objects
- `updateTransactionSchema` is derived as `transactionSchema.partial().omit({ type, date })`, enforcing that `type` and `date` are **immutable** after creation at the validation layer itself
- User email is transformed into `{ original, lowercase }` at parse time, enabling case-insensitive lookups without storing a separate normalised field at query time

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

All routes are prefixed with `/api`.

### Authentication

| Method | Route | Description | Auth Required |
|---|---|---|---|
| `POST` | `/users/register` | Create a new user account | Admin only |
| `POST` | `/users/login` | Authenticate and receive session cookie | No |
| `POST` | `/users/logout` | Clear the session cookie | No |

#### `POST /users/register` — Request Body
```json
{
  "name": "string (min 6)",
  "email": "string (valid email)",
  "username": "string (min 8)",
  "password": "string (min 6)",
  "role": "viewer | analyst | admin",
  "isActive": true
}
```

#### `POST /users/login` — Request Body
```json
{
  "email": "string",
  "password": "string"
}
```

---

### Transactions

All transaction routes require authentication. Ownership is enforced on `PATCH` and `DELETE`.

| Method | Route | Description | Required Role |
|---|---|---|---|
| `GET` | `/transactions` | Fetch current user's transactions | `admin`, `analyst` |
| `POST` | `/transactions` | Create a new transaction | `admin` |
| `PATCH` | `/transactions/:transactionId` | Update a transaction | `admin` (owner) |
| `DELETE` | `/transactions/:transactionId` | Soft-delete a transaction | `admin` (owner) |

#### `GET /transactions` — Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `type` | `income` \| `expense` | Filter by transaction type |
| `category` | `string` | Filter by category name |

#### `POST /transactions` — Request Headers & Body

```
X-Idempotency-Key: <uuid>   (required)
```

```json
{
  "amount": 1500.00,
  "type": "income | expense",
  "date": "2024-01-15",
  "category": "Salary",
  "description": "Monthly salary deposit"
}
```

**Response Headers on duplicate key:**
```
Idempotency-Replay: true
```

#### `PATCH /transactions/:transactionId` — Request Body

Only `amount`, `category`, and `description` are mutable. `type` and `date` are rejected by the validation schema.

```json
{
  "amount": 2000.00,
  "category": "Freelance",
  "description": "Updated description"
}
```

---

### Analytics

| Method | Route | Description | Required Role |
|---|---|---|---|
| `GET` | `/analytics` | Fetch income/expense totals and category breakdown | `admin`, `analyst`, `viewer` |

`viewer` results are scoped to their own transactions. `admin` and `analyst` receive aggregated data across all users.

#### `GET /analytics` — Response
```json
{
  "message": "Analytics data retrieved successfully",
  "data": {
    "totals": {
      "totalIncome": 5000,
      "totalExpense": 1200,
      "count": 12
    },
    "categoryBreakdown": [
      { "_id": "Salary", "netBalance": 5000 },
      { "_id": "Food", "netBalance": -800 }
    ]
  }
}
```

---

## Design Assumptions

1. **`type` is immutable** — a transaction's type (`income` / `expense`) cannot be changed after creation. Changing the type of a transaction would fundamentally alter the financial record and its contribution to the account balance. This is enforced at the Zod schema level by omitting `type` from `updateTransactionSchema`.

2. **`date` is immutable** — the transaction date represents when the financial event occurred and cannot be backdated after the fact. Also enforced by `updateTransactionSchema`.

3. **Balance is derived, not stored** — the authoritative balance is always computed from transaction records. The in-memory cache is a performance optimisation, not the source of truth.

4. **Expense validation** — the system checks that a user's current balance is sufficient before committing an expense transaction, preventing negative balances.

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
JWT_SECRET=     # Secret key for HS256 JWT signing (use a long, random string)
BYPASS_AUTH=    # Set to 'true' to skip JWT verification in development
```

> **Security note:** `BYPASS_AUTH` is only respected when `NODE_ENV=development`. It should never be set to `true` in production.

---

## Assignment Reflection

I completed this assignment in 24 hours and submitted it more than 48 hours before the deadline so I could travel properly and not miss the opportunity.
While traveling, I found out that the company was fake and not genuine.
Even though the company was fake, I learned a lot from this assignment about idempotency, race conditions, and locks to prevent race conditions in depth.
