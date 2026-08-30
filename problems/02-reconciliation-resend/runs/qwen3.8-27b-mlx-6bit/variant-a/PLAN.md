## 1. Assumptions

- Bank is a single injected interface `BankClient`; no real HTTP client, no config keys for it. Reason: the task is about state logic and idempotency, not transport.
- `effectiveDate` is the UTC calendar day (YYYY-MM-DD) that drives both txid derivation and statement lookups; it is stored on the order. Reason: the bank statement is keyed by date, so the txid must be stable across retries on the same day.
- `txid` is derived as `SHA-256(orderId + "|" + effectiveDate)` truncated to 32 hex chars; stored on the order so all resends reuse it. Reason: deterministic, collision-resistant, and reusable across attempts without recomputation races.
- Order lifecycle uses explicit enum states; "pending" is the only state that `executePayments` sends. Reason: keeps the send/reconcile boundary unambiguous.
- "Proven absent" means: reconciliation ran for an effectiveDate whose statement is now published (statement timestamp + 30 min lag <= now), and the order's txid is not in that statement. Reason: matches the bank's ~30 min publishing lag guarantee.
- Attempt counter increments on every `bank.send` call whose result is not a permanent rejection and not a confirmed duplicate; a permanent rejection does not consume an attempt (it is terminal). Reason: only transient/timeout outcomes are the ones that may need a retry.
- The 5-attempt cap applies to `send_attempts`; on the 6th required send the order is parked (`state = manual_review`) and `bank.send` is never called again. Reason: matches "cap at 5; after that park".
- `bank.send` is never called twice in the same execution for one order; resends happen only on a later `executePayments` run after reconciliation has proven absence. Reason: prevents double-send within a tick.
- Money is integer minor units (cents); no float anywhere. Reason: task requirement.
- The reconcile job is exposed as a `POST /reconcile` endpoint and `executePayments` as `POST /execute-payments`; window is a query/body parameter `{ from: ISO, to: ISO }`. Reason: the task says "reconcile job" and the stack is a NestJS API; an HTTP trigger satisfies both.
- Overlapping windows are safe because reconciliation is idempotent: it only advances an order forward along the state machine and never re-sends or reverts. Reason: requirement 2.
- A `duplicate` response from the bank means the order is already settled; we mark it `settled` and do not count an attempt. Reason: the bank already has it.
- A `permanent` rejection marks the order `rejected` (terminal); no auto-revert, no further sends. Reason: requirement 4.
- File layout: feature lives in `src/payout/`; files are `payout.module.ts`, `payout.controller.ts`, `payout.service.ts`, `payout.repository.ts`, `payout.types.ts`, `bank-client.ts` (interface + types). Reason: follows the repo's `<feature>/` convention.
- No `main.ts` or `app.module.ts` changes are in scope; the plan assumes they exist and import `PayoutModule`. Reason: task says "deliver schema, service, reconcile job, and tests".
- Prisma migration file name: `20250101000000_init`. Reason: single initial migration.

## 2. Data model

**Table `orders`** (Prisma model `Order`, `@@map("orders")`)

| Column | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK, `@id @default(cuid())` |
| `supplier_key` | `String` | `@map("supplier_key")`, the bank account key |
| `amount_cents` | `Int` | `@map("amount_cents")`, minor units, > 0 |
| `effective_date` | `String` | `@map("effective_date")`, format YYYY-MM-DD |
| `txid` | `String` | `@map("txid")`, derived, unique per order+date |
| `state` | `String` | `@map("state")`, enum values below |
| `send_attempts` | `Int` | `@map("send_attempts")`, default 0 |
| `created_at` | `DateTime` | `@map("created_at")`, default now() |
| `updated_at` | `DateTime` | `@map("updated_at")`, updated on change |

Index: unique on `(txid)`. Index on `(state, effective_date)` for query efficiency.

**Table `reconcile_runs`** (Prisma model `ReconcileRun`, `@@map("reconcile_runs")`)

| Column | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `window_from` | `DateTime` | `@map("window_from")` |
| `window_to` | `DateTime` | `@map("window_to")` |
| `matched_count` | `Int` | `@map("matched_count")`, orders matched in this run |
| `created_at` | `DateTime` | `@map("created_at")`, default now() |

Purpose: audit trail; also used to determine the latest reconciled window for a given effectiveDate so we know the statement is "published enough".

**Table `send_events`** (Prisma model `SendEvent`, `@@map("send_events")`)

| Column | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `order_id` | `String` | `@map("order_id")`, FK to orders.id |
| `txid` | `String` | `@map("txid")` |
| `classification` | `String` | `@map("classification")`, one of the SendClassification values |
| `raw_response` | `String` | `@map("raw_response")`, JSON string of bank response for debugging |
| `created_at` | `DateTime` | `@map("created_at")`, default now() |

Purpose: full audit of every send attempt; enables debugging and proves which attempts consumed the counter.

## 3. Types and signatures

### `src/payout/bank-client.ts`

```ts
export type SendClassification =
  | "accepted"
  | "duplicate"
  | "transient_error"
  | "permanent_rejection";

export interface BankSendResponse {
  classification: SendClassification;
  txid: string;
  message?: string;
}

export interface Settlement {
  txid: string;
  amount_cents: number;
  settled_at: Date;
}

export interface BankClient {
  send(req: { txid: string; amount_cents: number; key: string }): Promise<BankSendResponse>;
  getStatement(date: string): Promise<Settlement[]>;
}
```

### `src/payout/payout.types.ts`

```ts
export type OrderState =
  | "pending"
  | "sent"
  | "settled"
  | "manual_review"
  | "rejected";

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface PayoutResult {
  order_id: string;
  txid: string;
  classification: SendClassification;
}

export interface ReconcileResult {
  window: ReconcileWindow;
  matched_count: number;
}

export class InsufficientAttemptsError extends Error {
  readonly code = "insufficient_attempts";
  constructor(orderId: string) { super(`Order ${orderId} has exhausted attempts`); }
}

export class BankClientError extends Error {
  readonly code = "bank_client_error";
  constructor(message: string) { super(message); }
}
```

### `src/payout/payout.service.ts`

```ts
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  executePayments(): Promise<PayoutResult[]>;
  reconcile(window: ReconcileWindow): Promise<ReconcileResult>;

  // internal, exported for testability
  deriveTxid(orderId: string, effectiveDate: string): string;
  classifyResponse(resp: BankSendResponse): SendClassification;
}
```

### `src/payout/payout.repository.ts`

```ts
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order>;
  findOrdersByTxids(txids: string[]): Promise<Order[]>;
  findOrdersByEffectiveDate(date: string): Promise<Order[]>;
  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun>;
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null>;
  createSendEvent(orderId: string, txid: string, classification: SendClassification, raw: string): Promise<SendEvent>;
}
```

### `src/payout/payout.controller.ts`

```ts
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  executePayments(): Promise<PayoutResult[]>;

  @Post("reconcile")
  reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult>;
}
```

### `src/payout/payout.module.ts`

```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### `prisma/schema.prisma`

Models `Order`, `ReconcileRun`, `SendEvent` as described in section 2. Generator `prisma-client-js`, datasource `postgresql` with `env("DATABASE_URL")`.

### Ordering rules

- `executePayments` must not run concurrently with itself for the same order; a single Postgres advisory lock or an atomic `UPDATE ... WHERE state = 'pending'` guard ensures one winner. The loser sees no row and skips.
- `reconcile` may run concurrently with `executePayments`; reconcile only advances `sent -> settled` or proves absence (leaving state as-is), so it never conflicts with a send in flight.
- Within one `executePayments` run, orders are processed sequentially to avoid overwhelming the bank; no parallelism requirement.
- `reconcile` for a given effectiveDate is only considered "complete" once the statement timestamp (max `settled_at` in the returned array, or the window `to`) + 30 min <= now. Before that, the run records the window but does not mark any order as proven-absent.

### Errors

- `InsufficientAttemptsError` — raised internally if a bug attempts a 6th send; should never surface to the caller because `executePayments` checks the cap before calling `bank.send`. If it does surface, the controller maps it to `{ code: "insufficient_attempts" }`.
- `BankClientError` — raised if `bank.send` throws a non-classifiable exception (network error not modeled by the bank's own classification). The order stays in `sent` (or `pending` if no prior send) and the attempt is counted as a transient error. Controller maps to `{ code: "bank_client_error" }`.
- Any other unexpected error propagates as a 500 with `{ code: "internal_error" }`.

## 4. Control flow

### State machine

```
pending ──send accepted──► sent ──reconcile match──► settled
   │                         │
   │──send duplicate────────►settled
   │
   ├──send transient──► sent (attempts+1)
   │       │
   │       └─ proven absent, attempts < 5 ──► pending (will re-send next run)
   │       └─ proven absent, attempts >= 5 ──► manual_review (terminal)
   │
   ├──send permanent──► rejected (terminal)
   │
   └──(no send this run, e.g. lock lost)──► pending (unchanged)
```

Terminal states: `settled`, `manual_review`, `rejected`. No transitions out of terminal states.

### `executePayments()` transaction boundary

1. **No outer transaction.** Each order is handled in its own short unit.
2. For each pending order (fetched once at start):
   a. Atomically claim: `UPDATE orders SET state = 'sent', send_attempts = send_attempts + 1 WHERE id = ? AND state = 'pending'`. If 0 rows updated, skip (another run claimed it).
   b. Call `bank.send({ txid, amount_cents, key })`.
   c. Classify the response:
      - `accepted`: state stays `sent`. Record `SendEvent(classification = "accepted")`.
      - `duplicate`: set state to `settled`. Record `SendEvent(classification = "duplicate")`. No attempt counted (the claim already incremented; this is acceptable because a duplicate means the bank had it, and the order is now terminal).
      - `transient_error`: state stays `sent`. Record `SendEvent(classification = "transient_error")`.
      - `permanent_rejection`: set state to `rejected`. Record `SendEvent(classification = "permanent_rejection")`.
   d. If `bank.send` throws (unclassifiable): state stays `sent` (or reverts to `pending` if this was the first send and we want it retriable). Record `SendEvent(classification = "transient_error")`. The attempt was already counted in step (a).
3. Return the list of `PayoutResult`s for orders that were actually sent this run.

**What must not be in the transaction:** no HTTP calls to the bank, no long-running loops. The claim is a single atomic UPDATE; the bank call is outside any DB transaction.

### `reconcile(window)` transaction boundary

1. Call `bank.getStatement(date)` for each distinct `effective_date` in the window (derived from orders in that date range). This is outside any DB transaction.
2. For each effectiveDate:
   a. Determine if the statement is "published": the latest `settled_at` in the returned array (or `window.to` if empty) + 30 min <= now.
   b. If published:
      - For each order in `sent` state with that effectiveDate whose txid is in the statement: set state to `settled`. (Match by txid.)
      - For each order in `sent` state with that effectiveDate whose txid is NOT in the statement: this is "proven absent".
        - If `send_attempts < 5`: set state back to `pending` (next `executePayments` will re-send with the same txid).
        - If `send_attempts >= 5`: set state to `manual_review`.
   c. If not published: do nothing for that date (orders remain in their current state).
3. Record a `ReconcileRun` row with the window and matched count.
4. Return `{ window, matched_count }`.

**What must not be in the transaction:** no bank calls. All DB writes (state transitions, reconcile run) are in a single Prisma transaction per effectiveDate batch.

**Idempotency / overlapping windows:** Because state transitions are monotonic (pending -> sent -> settled, or sent -> pending only if proven absent and attempts < 5), re-running reconcile over the same or overlapping window is safe. An order already in `settled` will not be re-matched (it's no longer in `sent`). An order already in `manual_review` will not be touched. The only re-entrant transition is `sent -> pending` (proven absent), which is safe because the next send uses the same txid and the bank will return `duplicate` if it actually settled.

### Attempt accounting detail

- `send_attempts` is incremented at claim time (step 2a of executePayments), before the bank call. This means a transient error consumes an attempt, which is correct: the order was sent and may have settled.
- A `duplicate` response does not increment further (the claim already did). The order moves to `settled`, so no more attempts are possible.
- A `permanent_rejection` does not increment further. The order moves to `rejected`, terminal.
- Proven-absent with attempts < 5: state goes back to `pending`. The next `executePayments` will claim it again, incrementing to attempts+1. So the 5th send happens at attempts=4 -> claimed to 5. If that also times out and is proven absent, the next claim would make it 6, but the guard `send_attempts < 5` in reconcile prevents the revert to `pending` when attempts >= 5, so it goes to `manual_review` instead.

Wait — let me re-check: the cap is "cap attempts at 5". So sends 1-5 are allowed. After the 5th send, if proven absent, park. The guard in reconcile is: if `send_attempts >= 5`, park; else revert to pending. Since `send_attempts` is incremented at claim time, after the 5th send `send_attempts = 5`. Proven absent with `send_attempts >= 5` -> park. Correct.

## 5. Tests

- **timeout-but-settled (no resend):** Order is sent, bank times out (transient), order is in `sent`. Reconcile finds the txid in the statement. Order transitions to `settled`. A subsequent `executePayments` does not send it (it is no longer `pending`).
- **proven-absent (resend, same txid):** Order is sent, bank times out. Reconcile proves absence (txid not in statement, statement published). Order reverts to `pending`. Next `executePayments` sends it again with the identical txid. Bank returns `duplicate`. Order becomes `settled`.
- **attempt exhaustion:** Order is sent 5 times, each time proven absent. On the 5th proven-absent, order transitions to `manual_review`. A subsequent `executePayments` does not send it. No further state changes occur.
- **duplicate on first send:** Order is sent, bank immediately returns `duplicate`. Order transitions to `settled` without consuming an extra attempt beyond the claim.
- **permanent rejection:** Order is sent, bank returns `permanent_rejection`. Order transitions to `rejected`. Subsequent `executePayments` does not send it.
- **overlapping reconcile windows:** Reconcile is run for window [T1, T2] then [T2, T3] where both contain the same effectiveDate. The second run does not re-transition already-settled orders and does not double-count.
- **statement not yet published:** Reconcile runs but the statement's latest settled_at + 30 min > now. No orders are marked proven-absent; they remain in `sent`.
- **concurrent executePayments claim:** Two concurrent claims on the same pending order; only one succeeds (atomic UPDATE). The other skips.
- **txid determinism:** `deriveTxid(orderId, effectiveDate)` returns the same value for the same inputs across calls.
- **money is integer:** Schema and service reject or ignore non-integer amounts (Prisma `Int` column enforces at DB level; service validates input).

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema for orders, reconcile_runs, send_events
prisma/migrations/20250101000000_init/migration.sql | reads: - | Initial migration creating the three tables
src/payout/bank-client.ts | reads: - | BankClient interface, SendClassification, BankSendResponse, Settlement
src/payout/payout.types.ts | reads: src/payout/bank-client.ts | OrderState, ReconcileWindow, PayoutResult, ReconcileResult, error classes
src/payout/payout.repository.ts | reads: src/payout/payout.types.ts, prisma/schema.prisma | PayoutRepository with all DB access methods
src/payout/payout.service.ts | reads: src/payout/bank-client.ts, src/payout/payout.types.ts, src/payout/payout.repository.ts | PayoutService with executePayments, reconcile, deriveTxid, classifyResponse
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts, src/payout/payout.types.ts | PayoutController with POST execute-payments and POST reconcile
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts | PayoutModule wiring
test/payout.service.spec.ts | reads: src/payout/payout.service.ts, src/payout/bank-client.ts, src/payout/payout.types.ts, src/payout/payout.repository.ts | Tests for timeout-but-settled, proven-absent resend, attempt exhaustion, duplicate, permanent rejection, overlapping windows, unpublished statement, concurrent claim, txid determinism
test/payout.controller.spec.ts | reads: src/payout/payout.controller.ts, src/payout/payout.types.ts | Tests for HTTP contract: 200 responses, error envelope shape
-->
