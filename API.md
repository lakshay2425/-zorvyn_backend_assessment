# API Documentation — Personal Income & Expense Tracker v1

Base URL: `/api`

All protected routes expect an authenticated JWT in the `token` HttpOnly cookie (cookie name may change later). Requests must be made with credentials included (`credentials: 'include'` for `fetch`, or `withCredentials: true` for axios).

---

## Authentication

Authentication is delegated to an external auth service.

| Detail | Value |
|---|---|
| Algorithm | RS256 |
| Transport | HttpOnly cookie named `token` |
| Claim used | `sub` — auth service user ID (also used as this service's shadow `User._id`) |
| Public key | Fetched from the auth service and cached in memory (placeholder in code) |

### Development bypass

When `NODE_ENV=development` and `BYPASS_AUTH=true`, JWT verification is skipped and a hardcoded `userId` is injected. Never enable this in production.

### Common auth errors

| Status | Message |
|---|---|
| `400` | No Token is provided |
| `401` | Token has expired, please login again |
| `401` | Invalid token, please login again |

---

## Common response shapes

### Success

```json
{
  "success": true,
  "message": "string",
  "...additionalFields": {}
}
```

### Error

```json
{
  "message": "string",
  "errStack": "string (development only)"
}
```

### Rate limiting

Authenticated user routes are limited to **100 requests / 15 minutes** per `userId`.

| Status | Message |
|---|---|
| `429` | Too many requests. Please try again later. |

---

## Users

Shadow user profiles live in this service. Credentials live in the external auth service.

### `GET /users/check`

Check whether a shadow user profile exists for the authenticated user.

**Auth:** Required

**Response `200`**

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

When the profile does not exist:

```json
{
  "success": true,
  "message": "User existence checked successfully",
  "exists": false,
  "user": null
}
```

**Frontend flow:** call this after login. If `exists === false`, call `POST /users/profile`.

---

### `POST /users/profile`

Create a shadow user profile for the authenticated user.

**Auth:** Required

**Request body**

```json
{
  "name": "Alex"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | No | Trimmed; omit to leave `name` undefined |

`role` is always `"user"`. `plan` is always `"free"`. `_id` is set from the JWT `sub` claim.

**Response `201`**

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

**Errors**

| Status | When |
|---|---|
| `400` | Invalid body |
| `409` | Profile already exists |

---

## Transactions

All transaction data is scoped to the authenticated user's shadow `_id`.

### `GET /transactions`

List the current user's non-deleted transactions.

**Auth:** Required

**Query parameters**

| Param | Type | Required | Notes |
|---|---|---|---|
| `type` | `"income"` \| `"expense"` | No | Filter by type |
| `category` | `string` | No | Filter by category |

**Response `200`**

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

**Errors**

| Status | When |
|---|---|
| `400` | Invalid query parameters |

---

### `POST /transactions`

Create a transaction. Idempotent via `X-Idempotency-Key`.

**Auth:** Required

**Headers**

| Header | Required | Notes |
|---|---|---|
| `X-Idempotency-Key` | Yes | Unique client-generated key per create attempt |

**Request body**

```json
{
  "amount": 1500,
  "type": "income",
  "date": "2024-01-15",
  "category": "Salary",
  "description": "Monthly salary deposit"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | `number` | Yes | Must be `> 0`, max `1000000000` |
| `type` | `"income"` \| `"expense"` | Yes | Immutable after create |
| `date` | ISO date string | Yes | Coerced to `Date`; cannot be in the future |
| `category` | `string` | Yes | 1–50 chars |
| `description` | `string` | Yes | 1–500 chars |

**Response `201` (fresh create)**

```json
{
  "success": true,
  "message": "Transaction created successfully",
  "transactionID": "64f1a2b3c4d5e6f7a8b9c0d1",
  "transactionData": { }
}
```

**Response `200` (idempotent replay)**

Same body shape as a successful create, plus response header:

```
Idempotency-Replay: true
```

Returned when the same `X-Idempotency-Key` was already committed. Safe for client retries.

**Errors**

| Status | When |
|---|---|
| `400` | Missing/invalid `X-Idempotency-Key` |
| `400` | Invalid body |
| `400` | Insufficient balance (expense only) |
| `409` | Resource locked — another write for this user is in progress |

**Frontend guidance**

1. Generate a UUID (or similar) per create attempt and send it as `X-Idempotency-Key`.
2. On network failure / timeout, retry with the **same** key.
3. If the response includes `Idempotency-Replay: true`, treat it as success — do not create again.
4. On `409`, wait briefly and retry (optionally with the same key for creates).

---

### `PATCH /transactions/:transactionId`

Update a transaction owned by the authenticated user.

**Auth:** Required  
**Ownership:** Enforced

**Path params**

| Param | Type | Notes |
|---|---|---|
| `transactionId` | MongoDB ObjectId string | Validated |

**Request body** (all fields optional; at least one required)

```json
{
  "amount": 2000,
  "category": "Freelance",
  "description": "Updated description"
}
```

| Field | Mutable |
|---|---|
| `amount` | Yes |
| `category` | Yes |
| `description` | Yes |
| `type` | **No** — rejected by schema |
| `date` | **No** — rejected by schema |

**Response `200`**

```json
{
  "success": true,
  "message": "Transaction updated successfully",
  "transactionID": "64f1a2b3c4d5e6f7a8b9c0d1",
  "transactionData": { }
}
```

**Errors**

| Status | When |
|---|---|
| `400` | Invalid ObjectId / invalid body / no valid fields |
| `403` | Not the owner |
| `404` | Transaction not found |
| `409` | Resource locked |

---

### `DELETE /transactions/:transactionId`

Soft-delete a transaction (`deletedAt` set). Never hard-deletes.

**Auth:** Required  
**Ownership:** Enforced

**Response `200`**

```json
{
  "success": true,
  "message": "Transaction deleted successfully"
}
```

**Errors**

| Status | When |
|---|---|
| `400` | Invalid ObjectId / already deleted |
| `403` | Not the owner |
| `404` | Transaction not found |
| `409` | Resource locked |

---

## Analytics

### `GET /analytics`

Return income/expense totals and category breakdown for the authenticated user only.

**Auth:** Required

**Response `200`**

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

---

## Health

### `GET /health`

Unauthenticated liveness check (not under `/api`).

**Response `200`**

```json
{
  "message": "Ok"
}
```

---

## Suggested frontend onboarding sequence

1. User logs in via the external auth service (JWT cookie is set).
2. Call `GET /api/users/check`.
3. If `exists === false`, call `POST /api/users/profile` with optional `{ name }`.
4. Load dashboard: `GET /api/analytics` + `GET /api/transactions`.
5. Creates always send a fresh `X-Idempotency-Key`; retries reuse the same key.
