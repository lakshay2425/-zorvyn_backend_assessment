# Frontend Labs Spec — Idempotency & Concurrency Demos

Use this document to implement a dedicated **Labs** section in the React frontend.  
**No backend changes are required.** Both labs only call existing APIs from [`API.md`](./API.md).

---

## 1. Purpose

Give users (technical and non-technical) a hands-on way to see:

1. **Idempotency Lab** — firing the same create many times with one key creates **one** transaction; the rest are safe replays.
2. **Concurrency Lab** — firing many writes at once shows the per-user lock: some requests succeed, others get **`409`** while a write is in progress.

These are **demo / education** tools, not normal product flows. Protect them with a strict client-side usage limit.

---

## 2. Placement & access

| Item | Recommendation |
|---|---|
| Route | `/labs` (or `/demo/labs`) |
| Nav | Separate “Labs” / “Try concurrency” entry — not inside normal dashboard CRUD |
| Auth | User must already be logged in (auth-service cookie `token`) and have a shadow profile (`GET /api/users/check` → create if needed) |
| Audience | Anyone, but show plain-language summary + expandable technical details |

### Preflight before enabling “Run”

1. Confirm session cookie works (any authenticated call succeeds).
2. Confirm shadow user exists (`GET /api/users/check`).
3. For **Concurrency Lab** (expense creates): ensure the user has enough balance (seed income first if needed), or the demo will fail with “Insufficient balance” and look broken.

---

## 3. Hard rate limit (frontend-enforced)

Labs must not be freely spammable.

### Policy

| Setting | Value |
|---|---|
| Max successful lab **runs** per user | **2** |
| Window | **2 hours** (7200000 ms) |
| Scope | Per browser profile (localStorage), keyed by user id if available |
| What counts as a “run” | One click of **Run** that actually fires the burst (not changing sliders) |
| Apply to | Both labs share one budget **or** separate budgets — **use separate budgets** (cleaner UX) |

Recommended:

- Idempotency Lab: **2 runs / 2 hours**
- Concurrency Lab: **2 runs / 2 hours**

### Storage shape (`localStorage`)

Key examples:

```txt
labs:idempotency:runs:<userId>
labs:concurrency:runs:<userId>
```

Value:

```json
{
  "runs": [
    { "at": 1730000000000 },
    { "at": 1730003600000 }
  ]
}
```

### Enforcement logic

```ts
const WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_RUNS = 2;

function canRun(storeKey: string): { allowed: boolean; remaining: number; nextAvailableAt: number | null } {
  const now = Date.now();
  const raw = localStorage.getItem(storeKey);
  const parsed = raw ? JSON.parse(raw) : { runs: [] };
  const recent = (parsed.runs || []).filter((r) => now - r.at < WINDOW_MS);

  if (recent.length >= MAX_RUNS) {
    const oldest = Math.min(...recent.map((r) => r.at));
    return {
      allowed: false,
      remaining: 0,
      nextAvailableAt: oldest + WINDOW_MS,
    };
  }

  return {
    allowed: true,
    remaining: MAX_RUNS - recent.length,
    nextAvailableAt: null,
  };
}

function recordRun(storeKey: string) {
  const now = Date.now();
  const raw = localStorage.getItem(storeKey);
  const parsed = raw ? JSON.parse(raw) : { runs: [] };
  const recent = (parsed.runs || []).filter((r) => now - r.at < WINDOW_MS);
  recent.push({ at: now });
  localStorage.setItem(storeKey, JSON.stringify({ runs: recent }));
}
```

### UI when blocked

- Disable **Run**
- Show: “You’ve used this lab 2 times in the last 2 hours. Try again after {local time}.”
- Do **not** call the API when blocked

> This is a UX safeguard, not security. A determined user can clear `localStorage`. That is acceptable for a personal demo app.

---

## 4. Shared UI shell for Labs page

```
Labs
├── Intro (what this page is / is not)
├── Usage remaining badges (per lab)
├── Idempotency Lab card/section
└── Concurrency Lab card/section
```

### Intro copy (plain language)

> These labs let you stress-test how the app protects your money data.  
> Idempotency stops accidental duplicates. Concurrency locking stops two changes from colliding.  
> Each lab can be run only twice every two hours.

### Technical details (collapsed `<details>`)

Link readers to `API.md` for exact status codes and headers.

### Shared request helper requirements

- Always `credentials: "include"`
- Always JSON `Content-Type` on POST
- Capture for each response:
  - HTTP status
  - duration ms (`performance.now()`)
  - parsed JSON body
  - `Idempotency-Replay` header (idempotency lab)
  - error `message` when present

```ts
async function apiPostTransaction(payload, idempotencyKey) {
  const started = performance.now();
  const res = await fetch(`${API_ORIGIN}/api/transactions`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const ended = performance.now();
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    replay: res.headers.get("Idempotency-Replay") === "true",
    body,
    ms: Math.round(ended - started),
  };
}
```

---

## 5. Idempotency Lab

### Goal

Fire **N** create requests **in parallel** with the **same** `X-Idempotency-Key`.  
Show that only one transaction is created; the rest return the same record with replay header.

### Controls

| Control | Type | Range / default |
|---|---|---|
| Request count | slider/number | **2–10**, default `5` |
| Amount | number | default `10` (income recommended) |
| Type | select | default `"income"` (avoids balance issues) |
| Category | text | default `"Idempotency Lab"` |
| Description | text | default `"Idempotency demo"` |
| Date | date | today (not future) |
| Run button | button | disabled if rate-limited or running |

Generate **one** UUID when Run is clicked; reuse it for every request in that burst.

### Request behaviour

```ts
const key = crypto.randomUUID();
const count = selectedCount; // 2..10

const results = await Promise.all(
  Array.from({ length: count }, (_, index) =>
    apiPostTransaction(payload, key).then((r) => ({ index: index + 1, key, ...r }))
  )
);
```

Record a lab run in `localStorage` **when the burst starts** (or when it finishes successfully enough to count — prefer **on start** after `canRun` passes, so spam-clicking mid-flight still consumes quota).

### Results UI

#### Summary badges

- `Unique transaction IDs: {n}` → expect **1**
- `Fresh creates (201, no replay): {n}`
- `Replays (Idempotency-Replay: true): {n}`
- `Failures: {n}`

#### Pass / explain states

| Condition | Show |
|---|---|
| Unique IDs === 1 and replays >= 1 | ✅ “Idempotency worked — created once, safely reused.” |
| Unique IDs === 1 and all 200 replay (no 201) | ✅ “Race resolved by replay — still one transaction.” |
| Unique IDs > 1 | ⚠ “Unexpected duplicates — show technical log” (should be rare) |

#### Results table columns

| # | HTTP | Replay header | transactionID | Latency | Message |
|---|---|---|---|---|---|

Highlight rows with `replay === true`.

### Plain-language explanation (always visible under results)

> You sent the same “save” action multiple times with one idempotency key.  
> The system created the transaction once. Extra requests returned the same saved result instead of creating duplicates.

### Technical note (collapsed)

- Header: `X-Idempotency-Key`
- Fresh create: `201`
- Replay: `200` + `Idempotency-Replay: true`
- Same `transactionID` on all successful rows
- See `API.md` § POST `/api/transactions`

### Do / don’t

- ✅ Same key for the whole burst  
- ❌ Do not generate a new key per request in this lab  
- ✅ Prefer `type: "income"` so balance doesn’t interfere  

---

## 6. Concurrency Lab

### Goal

Fire **N** create requests **at the same time** with **different** idempotency keys.  
Show that while one write holds the user lock, others receive **`409`**.  
Optionally note that a later retry *might* succeed — but **do not auto-retry** in v1 UI (keep the demo simple).

### Controls

| Control | Type | Range / default |
|---|---|---|
| Concurrent requests | slider/number | **1–25**, default `10` |
| Amount per request | number | default `1` (small expense) |
| Type | fixed or select | prefer `"expense"` (lock path is clearest) |
| Category | text | default `"Concurrency Lab"` |
| Description | text | auto `Concurrent request #i` |
| Date | date | today |
| Run button | button | disabled if rate-limited / running / insufficient setup |

### Preconditions (Concurrency Lab only)

Before enabling Run:

1. Shadow user exists.
2. If using expenses: current spendable balance should be `>= count * amount`.  
   - Simple approach: before the lab, offer **“Add demo income”** button that creates one income transaction (its own unique idempotency key, **not** counted as a lab run, or count it separately — recommend **not** counting setup income against lab quota).
3. Warn if balance is too low.

### Request behaviour

```ts
const count = selectedCount; // 1..25

const jobs = Array.from({ length: count }, (_, i) => ({
  index: i + 1,
  key: crypto.randomUUID(), // DIFFERENT per request — critical
  payload: {
    amount: selectedAmount,
    type: "expense",
    date: todayISODate,
    category: "Concurrency Lab",
    description: `Concurrent request #${i + 1}`,
  },
}));

const results = await Promise.all(
  jobs.map((job) =>
    apiPostTransaction(job.payload, job.key).then((r) => ({
      index: job.index,
      key: job.key,
      ...r,
    }))
  )
);
```

No automatic retry loop in this version.

### Results UI

#### Summary badges

- `Succeeded (2xx): {n}`
- `Blocked with 409: {n}`
- `Other errors: {n}`
- `Unique transaction IDs created: {n}`

#### Expected pattern (typical)

- About **1** (sometimes a few) succeed with `201`
- Several return **`409`** with message:  
  `Please wait some moments before trying again.`
- Because requests launch together, more than one success can slip through before the lock flag is set — that is OK. Explain it.

#### Results table columns

| # | HTTP | Latency | transactionID | Message |
|---|---|---|---|---|

Color:
- `201` / success → green  
- `409` → amber (“blocked / busy”)  
- other errors → red  

#### Plain-language explanation

> When many changes hit at once, the system protects your balance by allowing a write to finish before accepting another colliding write.  
> Requests that arrive while a write is already in progress are rejected with “please wait” (`409`).  
> If you manually retry those later, some can succeed once the system is free.

#### Technical note (collapsed)

- Backend lock is **reject-on-busy**, not a server queue
- Lock checked by `checkResourceLock` before write handlers
- Concurrent lab must use **different** idempotency keys (otherwise this becomes an idempotency demo)
- Expense path is preferred because it engages balance + lock status
- See `API.md` for `409` body

### Optional helper text under the table

> Tip: A blocked (`409`) request is not a bug. It means the lock worked.  
> You can retry a single blocked request with its **same** idempotency key using a “Retry this one” button if you want — still no bulk auto-retry required.

(If you add per-row Retry, do **not** count each retry as a new lab run.)

---

## 7. Copy bank (ready to paste)

### Page title
`Safety Labs`

### Idempotency title
`Idempotency — stop duplicate saves`

### Idempotency subtitle
`Send the same create request multiple times with one key. Only one transaction should be stored.`

### Concurrency title
`Concurrency — stop colliding writes`

### Concurrency subtitle
`Send many different writes at the same time. Some should succeed; others should get a temporary “please wait” (409) response.`

### Rate-limit blocked
`Lab limit reached: 2 runs every 2 hours. Next run available at {time}.`

### Concurrency empty 409 case (edge)
If somehow no `409` appears (lock race / very fast DB):

> No 409 this time — requests finished so quickly that a lock collision wasn’t observed. Try a higher request count.

---

## 8. Component / state sketch

```ts
type LabResultRow = {
  index: number;
  status: number;
  ms: number;
  replay?: boolean;
  transactionID?: string;
  message?: string;
  key?: string;
};

type LabState = {
  count: number;
  running: boolean;
  results: LabResultRow[];
  summary: Record<string, number>;
  error?: string;
};
```

Suggested components:

- `LabsPage`
- `LabRateLimitBadge`
- `IdempotencyLab`
- `ConcurrencyLab`
- `LabResultsTable`
- `LabSummaryBadges`

---

## 9. Acceptance checklist

### Idempotency Lab
- [ ] Count limited to 2–10
- [ ] One shared idempotency key per run
- [ ] Parallel `Promise.all` fire
- [ ] Shows replay header for non-first successes
- [ ] Shows single unique `transactionID` on success path
- [ ] Rate limit: 2 runs / 2 hours
- [ ] Plain-language + technical details

### Concurrency Lab
- [ ] Count limited to 1–25
- [ ] Unique idempotency key per request
- [ ] Parallel fire, **no** bulk auto-retry
- [ ] Highlights `409` rows
- [ ] Explains that manual later retries may succeed
- [ ] Balance precondition / demo income helper
- [ ] Rate limit: 2 runs / 2 hours
- [ ] Does not claim the server queues requests

### Safety
- [ ] Run disabled while in flight
- [ ] Run disabled when rate-limited
- [ ] Labs separated from normal create form UX

---

## 10. Out of scope (do not build in this pass)

- Backend queueing / waiting mutex
- Redis / distributed locks
- Changing API rate limits for labs
- Auto-retrying all `409`s in a loop for the concurrency lab
- Using these labs as load/performance benchmarks

---

## 11. API endpoints used

Only these (details in [`API.md`](./API.md)):

| Lab | Calls |
|---|---|
| Setup | `GET /api/users/check`, maybe `POST /api/users/profile` |
| Optional balance seed | `POST /api/transactions` (income, unique key) |
| Idempotency Lab | `POST /api/transactions` × N (same key) |
| Concurrency Lab | `POST /api/transactions` × N (different keys) |
| Optional verify | `GET /api/transactions` after a run to confirm counts |

---

## 12. Quick decision summary

| Topic | Decision |
|---|---|
| Backend changes | **None** |
| Idempotency demo | Same key, parallel, show replays |
| Concurrency demo | Different keys, parallel, show `409`s, no auto-retry |
| Abuse protection | Frontend: **2 runs / 2 hours** per lab |
| Prefer income for idempotency | Yes |
| Prefer expense for concurrency | Yes |
| Docs for product APIs | `API.md` |
| Docs for these labs | **This file** |
