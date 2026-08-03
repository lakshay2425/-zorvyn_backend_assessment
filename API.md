# Vaultex — API Contract (v1)

Use this document to build and integrate a React frontend against the evolved backend.

**Design rationale:** see [`decision.md`](./decision.md) for architecture and breaking-change notes.

**Base URL:** `{API_ORIGIN}/api`  
**Health (no `/api` prefix):** `{API_ORIGIN}/health`

All authenticated requests must send cookies:

```js
fetch(url, { credentials: "include" })
// axios: withCredentials: true
```

---

## Table of contents

1. [Auth model](#1-auth-model)
2. [Shared response shapes](#2-shared-response-shapes)
3. [Shared status codes / cross-cutting errors](#3-shared-status-codes--cross-cutting-errors)
4. [Frontend onboarding sequence](#4-frontend-onboarding-sequence)
5. [Health](#5-health)
6. [Users](#6-users)
7. [Transactions](#7-transactions)
8. [Analytics](#8-analytics)
9. [Frontend handling checklist](#9-frontend-handling-checklist)

---

## 1. Auth model

Authentication is handled by an **external auth service**. This backend only verifies the JWT.

| Detail | Value |
|---|---|
| Cookie name | `token` (HttpOnly) |
| Access in backend | `req.cookies.token` |
| Algorithm | `RS256` |
| Issuer | `auth-service` |
| JWKS | `https://authentication.lakshaymahajan.com/.well-known/jwks.json` |
| Identity claim | `sub` — MongoDB ObjectId string |
| Extra claim | `userInfo.userEmail` |
| Mapped to request | `req.user = { userId: sub, email: userInfo.userEmail }` |

### Rules for frontend

- Login / logout / password flows happen on the **auth service**, not this API.
- After login, the auth service sets the `token` cookie.
- This API uses `sub` as the shadow user `_id` and as `Transaction.userId`.
- There are **no login, signup, or logout routes** on this backend.

### Auth errors (apply to every protected route)

Protected routes: `/api/users/*`, `/api/transactions/*`, `/api/analytics`.

#### Missing cookie

**Status:** `400`

```json
{
  "success": true,
  "message": "No Token is provided"
}
```

> Note: status is `400`, but body still has `"success": true` (current backend behaviour). Frontend should treat **HTTP status**, not `success`, as the source of truth for auth failures.

#### Expired token

**Status:** `401`

```json
{
  "message": "Token has expired, please login again",
  "errStack": ""
}
```

#### Invalid token / bad signature / wrong issuer / malformed JWT

**Status:** `401`

```json
{
  "message": "Invalid token, please login again",
  "errStack": ""
}
```

#### Token valid but missing `sub`

**Status:** `401`

```json
{
  "message": "You're unauthorized to access this resource",
  "errStack": ""
}
```

#### Auth / JWKS internal failure

**Status:** `500`

```json
{
  "message": "Internal server error",
  "errStack": ""
}
```

**Frontend action for `400` (no token) / `401`:** redirect user to auth-service login.

---

## 2. Shared response shapes

### Success (most endpoints)

Built by `returnResponse`. Fields from the handler are merged at the **top level** (not nested under `data`).

```json
{
  "success": true,
  "message": "Human-readable success message",
  "...endpointSpecificFields": "..."
}
```

### Error (global error handler)

```json
{
  "message": "Human-readable error message",
  "errStack": "stack trace string in development, empty string in production"
}
```

There is **no** `success: false` field on error responses from the global handler.

### Exception: invalid ObjectId on PATCH/DELETE

`validateObjectId` returns a different shape (not the global handler):

```json
{
  "error": "Invalid Input"
}
```

Frontend should handle both `{ message }` and `{ error }` error bodies.

---

## 3. Shared status codes / cross-cutting errors

| Status | When | Typical message |
|---|---|---|
| `400` | Missing auth cookie | `No Token is provided` |
| `400` | Validation / business rule | endpoint-specific |
| `401` | Bad / expired JWT | see Auth errors |
| `403` | Not owner of resource | `You're unauthorized to perform this action` |
| `404` | Resource not found | `Transaction not found` |
| `409` | Concurrent write lock | `Please wait some moments before trying again.` |
| `409` | Shadow profile already exists | `User profile already exists` |
| `429` | Rate limit exceeded | `Too many requests. Please try again later.` |
| `500` | Unexpected / DB failure | `Internal Server Error` or wrapped DB message |

### Rate limiting

- Applies to authenticated `/users`, `/transactions`, `/analytics` routes
- Keyed by `userId`
- Limit: **100 requests / 15 minutes**
- Headers: standard rate-limit headers are enabled (`RateLimit-*`)

**Status:** `429`

```json
{
  "message": "Too many requests. Please try again later.",
  "errStack": ""
}
```

**Frontend action:** show retry-later UI; optionally read `RateLimit-Reset`.

### Resource lock (`409`)

Applies to **POST /transactions**, **PATCH /transactions/:id**, **DELETE /transactions/:id**, and **DELETE /transactions/lab** when another write for the same user is in progress.

The server acquires the lock atomically at middleware entry (`acquireUserLock`):

- If the user's cache status is already `processing` and the incoming write is a **different** operation / idempotency key → reject with `409`.
- If `POST /transactions` arrives with the **same** `X-Idempotency-Key` as the in-flight create → allow through (same-key pass-through). Idempotency lookup / unique-index race in the create path returns `200` + `Idempotency-Replay: true`. Pass-through requests do not own or release the lock.
- Otherwise status is set to `processing` (and `processingIdempotencyKey` is stored for creates) and released when the owner's HTTP response finishes (`res.finish`) or the connection closes (`res.close`).

```json
{
  "message": "Please wait some moments before trying again.",
  "errStack": ""
}
```

**Frontend action:** wait ~300–1000ms and retry the same request. For creates, keep the same `X-Idempotency-Key` (same-key retries during an in-flight create should get a replay, not `409`).

---

## 4. Frontend onboarding sequence

```
1. User authenticates via auth service → cookie `token` is set
2. GET /api/users/check
3. If exists === false → POST /api/users/profile  (required body: `{ "name": "..." }`)
4. Load app data in parallel:
     - GET /api/analytics
     - GET /api/transactions
5. Mutating flows:
     - create with X-Idempotency-Key
     - update / delete with ownership (always current user)
```

---

## 5. Health

### `GET /health`

Unauthenticated. Not under `/api`.

#### Success `200`

```json
{
  "message": "Ok"
}
```

No `success` field.

---

## 6. Users

Shadow profile only. Credentials live in the auth service.

### 6.1 `GET /api/users/check`

Check whether the authenticated user already has a shadow profile.

| Item | Value |
|---|---|
| Auth | Required (`token` cookie) |
| Rate limited | Yes |
| Request body | None |
| Query params | None |

#### Success `200` — profile exists

```json
{
  "success": true,
  "message": "User existence checked successfully",
  "exists": true,
  "user": {
    "_id": "69cfaf4cd681a6a77b076222",
    "name": "Alex",
    "role": "user",
    "plan": "free",
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T00:00:00.000Z"
  }
}
```

#### Success `200` — profile does not exist

```json
{
  "success": true,
  "message": "User existence checked successfully",
  "exists": false,
  "user": null
}
```

#### Failures

| Status | Body `message` / notes | Frontend action |
|---|---|---|
| `400` | `No Token is provided` | Send to login |
| `401` | Auth errors above | Send to login |
| `429` | Rate limited | Retry later |
| `500` | DB / internal | Generic error toast |

---

### 6.2 `POST /api/users/profile`

Create the shadow user profile for the authenticated user.

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Content-Type | `application/json` |

#### Request body

```json
{
  "name": "Alex"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | **Yes** | Trimmed, min length 1. Must be present in the request body. |

**Not accepted from client (server defaults):**

| Field | Default |
|---|---|
| `_id` | JWT `sub` |
| `role` | `"user"` |
| `plan` | `"free"` |

#### Success `201`

```json
{
  "success": true,
  "message": "User profile created successfully",
  "user": {
    "_id": "69cfaf4cd681a6a77b076222",
    "name": "Alex",
    "role": "user",
    "plan": "free",
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T00:00:00.000Z"
  }
}
```

Every created profile includes `name` (validated at the API layer and required in the database schema).

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` | `{ "message": "Invalid data", "errStack": "" }` | `name` missing, empty, or invalid (Zod) | Collect and send a non-empty name before calling this endpoint |
| `400` | `{ "message": "Name is required", "errStack": "" }` | Service-layer guard (defense in depth) | Same as above — always send `name` |
| `400` / `401` | Auth errors | Missing/invalid cookie | Login |
| `409` | `{ "message": "User profile already exists", "errStack": "" }` | Profile already created | Treat as success; continue to app (or re-call `/users/check`) |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | DB / internal | Unexpected | Error toast |

---

## 7. Transactions

All transaction endpoints are scoped to the authenticated user. Soft-deleted rows (`deletedAt != null`) are excluded from list/analytics.

### Transaction object shape

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "amount": 1500,
  "type": "income",
  "date": "2024-01-15T00:00:00.000Z",
  "category": "Salary",
  "description": "Monthly salary deposit",
  "userId": "69cfaf4cd681a6a77b076222",
  "idempotencyKey": "8f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8",
  "deletedAt": null,
  "createdAt": "2026-07-23T00:00:00.000Z",
  "updatedAt": "2026-07-23T00:00:00.000Z"
}
```

| Field | Notes |
|---|---|
| `type` | `"income"` \| `"expense"` — immutable after create |
| `date` | Immutable after create |
| `deletedAt` | `null` when active; ISO date when soft-deleted |
| `idempotencyKey` | Set only on create; unique across all transactions |

---

### 7.1 `GET /api/transactions`

List the current user's active transactions (newest date first).

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |

#### Query parameters

| Param | Type | Required | Rules |
|---|---|---|---|
| `type` | `"income"` \| `"expense"` | No | Exact enum |
| `category` | `string` | No | Trimmed, min length 1 |

Examples:

```
GET /api/transactions
GET /api/transactions?type=expense
GET /api/transactions?category=Food
GET /api/transactions?type=income&category=Salary
```

#### Success `200`

```json
{
  "success": true,
  "message": "Transactions fetched successfully",
  "transactions": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "amount": 1500,
      "type": "income",
      "date": "2024-01-15T00:00:00.000Z",
      "category": "Salary",
      "description": "Monthly salary deposit",
      "userId": "69cfaf4cd681a6a77b076222",
      "idempotencyKey": "8f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8",
      "deletedAt": null,
      "createdAt": "2026-07-23T00:00:00.000Z",
      "updatedAt": "2026-07-23T00:00:00.000Z"
    }
  ]
}
```

Empty list is still success:

```json
{
  "success": true,
  "message": "Transactions fetched successfully",
  "transactions": []
}
```

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` | `{ "message": "Invalid query parameters", "errStack": "" }` | Bad `type` / empty `category` / unknown invalid query shape | Fix filters |
| `400` / `401` | Auth errors | Cookie issues | Login |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | e.g. `Failed to fetch transactions` | DB failure | Error toast |

---

### 7.2 `POST /api/transactions`

Create a transaction. **Idempotent.**

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Lock check | Yes (`409` if user write in progress) |
| Content-Type | `application/json` |

#### Headers

| Header | Required | Rules |
|---|---|---|
| `X-Idempotency-Key` | **Yes** | Non-empty trimmed string. Generate once per create attempt (UUID recommended). Reuse on retries of the **same** create. |

#### Request body

```json
{
  "amount": 1500,
  "type": "income",
  "date": "2024-01-15",
  "category": "Salary",
  "description": "Monthly salary deposit"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `amount` | `number` | Yes | `> 0`, max `1000000000` (must be a JSON number, not a string) |
| `type` | `string` | Yes | `"income"` or `"expense"` only |
| `date` | ISO date string | Yes | Coerced to `Date`; **cannot be in the future** |
| `category` | `string` | Yes | Trimmed, 1–50 chars |
| `description` | `string` | Yes | Trimmed, 1–500 chars |

#### Success `201` — fresh create

```json
{
  "success": true,
  "message": "Transaction created successfully",
  "transactionID": "64f1a2b3c4d5e6f7a8b9c0d1",
  "transactionData": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "amount": 1500,
    "type": "income",
    "date": "2024-01-15T00:00:00.000Z",
    "category": "Salary",
    "description": "Monthly salary deposit",
    "userId": "69cfaf4cd681a6a77b076222",
    "idempotencyKey": "8f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8",
    "deletedAt": null,
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T00:00:00.000Z"
  }
}
```

No `Idempotency-Replay` header on fresh create.

#### Success `200` — idempotent replay

Returned when the same `X-Idempotency-Key` was already committed (lookup hit or concurrent duplicate-key race).

**Response header:**

```
Idempotency-Replay: true
```

**Body:**

```json
{
  "success": true,
  "message": "This transaction has already been processed",
  "transactionID": "64f1a2b3c4d5e6f7a8b9c0d1",
  "transactionData": { }
}
```

(Race-path message may be `"This transaction has already been processed"` as above.)

**Frontend action:** treat as success. Do **not** create again. Prefer checking the `Idempotency-Replay` header; also accept `200` + existing `transactionID` as success.

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` | `{ "message": "Missing or invalid x-idempotency-key header", "errStack": "" }` | Header missing/empty | Always send a key |
| `400` | `{ "message": "Invalid data", "errStack": "" }` | Body fails Zod rules | Show field validation errors client-side using the rules table |
| `400` | `{ "message": "Insufficient balance for this expense transaction", "errStack": "" }` | Expense larger than current balance | Show insufficient funds; allow user to add income or reduce amount. **Same idempotency key can be reused** after fixing (failed creates are not persisted as success) |
| `400` / `401` | Auth errors | Cookie issues | Login |
| `409` | `{ "message": "Please wait some moments before trying again.", "errStack": "" }` | User lock held | Wait + retry **same** key |
| `429` | Rate limited | Too many calls | Retry later with **same** key if create not confirmed |
| `500` | e.g. `Failed to record the transaction` / `Failed to check idempotency key` | Unexpected | If uncertain whether create succeeded, retry with **same** key |

#### Idempotency rules for frontend

1. Generate a new key only for a **new user intent** to create.
2. On network timeout / `5xx` / unknown outcome → retry with the **same** key.
3. On validation / insufficient funds → you may reuse the same key after the user fixes input (failure was not stored as a successful transaction).
4. On `Idempotency-Replay: true` → stop retrying; show success.

---

### 7.3 `PATCH /api/transactions/:transactionId`

Update a transaction owned by the authenticated user.

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Ownership | Required (must own the row) |
| Lock check | Yes |
| Content-Type | `application/json` |

#### Path params

| Param | Type | Required | Rules |
|---|---|---|---|
| `transactionId` | MongoDB ObjectId string | Yes | Valid ObjectId format |

#### Request body

All fields optional, but **at least one mutable field** must be present after validation.

```json
{
  "amount": 2000,
  "category": "Freelance",
  "description": "Updated description"
}
```

| Field | Mutable | Rules |
|---|---|---|
| `amount` | Yes | Same as create: `> 0`, max `1000000000` |
| `category` | Yes | Trimmed, 1–50 chars |
| `description` | Yes | Trimmed, 1–500 chars |
| `type` | **No** | Rejected by schema → `400 Invalid data` |
| `date` | **No** | Rejected by schema → `400 Invalid data` |

#### Success `200`

```json
{
  "success": true,
  "message": "Transaction updated successfully",
  "transactionID": "64f1a2b3c4d5e6f7a8b9c0d1",
  "transactionData": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "amount": 2000,
    "type": "income",
    "date": "2024-01-15T00:00:00.000Z",
    "category": "Freelance",
    "description": "Updated description",
    "userId": "69cfaf4cd681a6a77b076222",
    "idempotencyKey": "8f3c2a1b-4d5e-6f70-8192-a3b4c5d6e7f8",
    "deletedAt": null,
    "createdAt": "2026-07-23T00:00:00.000Z",
    "updatedAt": "2026-07-23T01:00:00.000Z"
  }
}
```

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` | `{ "error": "Invalid Input" }` | `transactionId` not a valid ObjectId | Fix route param / navigation |
| `400` | `{ "message": "Missing objectId", "errStack": "" }` | Param missing | Should not happen via normal routing |
| `400` | `{ "message": "Invalid data", "errStack": "" }` | Body fails Zod (incl. sending `type`/`date`) | Fix form |
| `400` | `{ "message": "No valid fields provided for update", "errStack": "" }` | Empty / no allowed fields | Require at least one editable field |
| `400` / `401` | Auth errors | Cookie issues | Login |
| `403` | `{ "message": "You're unauthorized to perform this action", "errStack": "" }` | Not the owner | Show forbidden; refresh list |
| `404` | `{ "message": "Transaction not found", "errStack": "" }` | Unknown id | Remove from UI / refresh |
| `409` | Lock held | Concurrent write | Wait + retry |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | e.g. `Failed to update the transaction record` | Unexpected | Error toast |

---

### 7.4 `DELETE /api/transactions/:transactionId`

Soft-delete a transaction (`deletedAt` set to now). Never hard-deletes.

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Ownership | Required |
| Lock check | Yes |
| Request body | None |

#### Path params

| Param | Type | Required |
|---|---|---|
| `transactionId` | MongoDB ObjectId string | Yes |

#### Success `200`

```json
{
  "success": true,
  "message": "Transaction deleted successfully"
}
```

No transaction payload is returned.

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` | `{ "error": "Invalid Input" }` | Invalid ObjectId | Fix param |
| `400` | `{ "message": "Missing objectId", "errStack": "" }` | Missing param | Should not happen |
| `400` | `{ "message": "This transaction has already been deleted", "errStack": "" }` | Already soft-deleted | Treat as deleted; refresh list |
| `400` / `401` | Auth errors | Cookie issues | Login |
| `403` | Not owner | Forbidden | Refresh list |
| `404` | Not found | Unknown id | Refresh list |
| `409` | Lock held | Concurrent write | Wait + retry |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | e.g. `Failed to delete the transaction record` | Unexpected | Error toast |

---

### 7.5 `DELETE /api/transactions/lab`

Bulk soft-delete all **lab demo** transactions for the authenticated user. Real transactions (any other category) are never affected.

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Ownership | Scoped to authenticated `userId` only |
| Lock check | Yes |
| Request body | None |

#### Categories deleted

Only active rows (`deletedAt: null`) whose `category` is one of:

| Category | Typical source |
|---|---|
| `Idempotency Lab` | Idempotency Lab |
| `Concurrency Lab` | Concurrency Lab |
| `Concurrency Lab Seed` | Demo income before Concurrency Lab |

Defined in `src/constants/labCategories.js`.

#### Success `200` (transactions deleted)

```json
{
  "success": true,
  "message": "Lab transactions deleted successfully",
  "data": {
    "deletedCount": 12,
    "balance": 1500
  }
}
```

#### Success `200` (nothing to delete)

Idempotent — not an error:

```json
{
  "success": true,
  "message": "No lab transactions to delete",
  "data": {
    "deletedCount": 0,
    "balance": 1500
  }
}
```

| Field | Meaning |
|---|---|
| `data.deletedCount` | Number of rows soft-deleted in this request |
| `data.balance` | User net balance after cleanup (income − expense, active rows only) |

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` / `401` | Auth errors | Cookie issues | Login |
| `409` | Lock held | Concurrent write | Wait + retry |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | e.g. `Failed to delete lab transactions` | Unexpected | Error toast |

**Frontend action:** show confirmation before calling; on success refresh transaction list and analytics.

---

## 8. Analytics

### 8.1 `GET /api/analytics`

Income/expense totals and per-category net balance for the **authenticated user only**.

| Item | Value |
|---|---|
| Auth | Required |
| Rate limited | Yes |
| Query / body | None |

Soft-deleted transactions are excluded.

#### Success `200`

```json
{
  "success": true,
  "message": "Analytics data retrieved successfully",
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
```

#### Empty account / no transactions `200`

```json
{
  "success": true,
  "message": "Analytics data retrieved successfully",
  "totals": {
    "totalIncome": 0,
    "totalExpense": 0,
    "count": 0
  },
  "categoryBreakdown": []
}
```

| Field | Meaning |
|---|---|
| `totals.totalIncome` | Sum of income amounts |
| `totals.totalExpense` | Sum of expense amounts |
| `totals.count` | Number of active transactions |
| `categoryBreakdown[]._id` | Category name |
| `categoryBreakdown[].netBalance` | Income positive, expense negative contribution |

Derived balance for UI: `totals.totalIncome - totals.totalExpense`.

#### Failures

| Status | Body | When | Frontend action |
|---|---|---|---|
| `400` / `401` | Auth errors | Cookie issues | Login |
| `429` | Rate limited | Too many calls | Retry later |
| `500` | e.g. `Failed to fetch analytics data` | Unexpected | Error toast |

---

## 9. Frontend handling checklist

Use this when wiring the client so nothing is missed.

### Must always do

- [ ] Send `credentials: "include"` on every API call
- [ ] On `400` with message `No Token is provided` or any `401` → redirect to auth login
- [ ] After login → `GET /users/check` → if `exists === false`, `POST /users/profile` with `{ "name": "..." }` (required)
- [ ] Treat HTTP status as source of truth (do not rely only on `success`)
- [ ] Handle both error shapes: `{ message }` and `{ error: "Invalid Input" }`
- [ ] For creates: always send `X-Idempotency-Key`; reuse on uncertain retries
- [ ] On `Idempotency-Replay: true` → treat as success
- [ ] On `409` lock → brief wait + retry
- [ ] On `429` → backoff / retry later
- [ ] Never send `type` or `date` on PATCH
- [ ] Send `amount` as a JSON number, not `"1500"`

### Recommended UX mappings

| Backend case | UI behaviour |
|---|---|
| Insufficient balance | Inline error on amount / type=expense |
| Idempotency replay | Silent success / “already saved” |
| Already deleted | Remove row from list |
| Profile already exists (`409`) | Continue into app |
| Missing / invalid `name` on profile create (`400`) | Block onboarding until user provides a name |
| Empty transactions / analytics | Empty states, not errors |
| Network failure after create | Retry same idempotency key; then refresh list |

### Endpoint map (quick)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/api/users/check` | Shadow profile exists? |
| `POST` | `/api/users/profile` | Create shadow profile |
| `GET` | `/api/transactions` | List (+ optional filters) |
| `POST` | `/api/transactions` | Create (idempotent) |
| `PATCH` | `/api/transactions/:transactionId` | Update owned txn |
| `DELETE` | `/api/transactions/:transactionId` | Soft-delete owned txn |
| `DELETE` | `/api/transactions/lab` | Bulk soft-delete lab demo txns |
| `GET` | `/api/analytics` | Totals + category breakdown |

### Out of scope on this backend

- Login / logout / register / password reset (auth service)
- Admin / multi-user RBAC
- Pagination / sorting params beyond default date desc
- File uploads
- Webhooks
