## 1. Assumptions

| # | Decision | Why |
|---|----------|-----|
| 1 | `txid = sha256(orderId + effectiveDate.toISOString()).hex` | Deterministic, collision-resistant, no extra column needed. |
| 2 | Publishing lag is a named constant `PUBLISHING_LAG_MS = 30 * 60 * 1000`, injected via env `PUBLISHING_LAG_MS`. | Spec says "up to ~30 min"; making it configurable avoids hardcoding. |
| 3 | A statement for date D is "complete" when `now > endOfDay(D) + PUBLISHING_LAG_MS`. | After that point, no further entries can appear. |
| 4 | `in_doubt` covers both timeout and transient-error responses (same safety rule). | Spec groups "failed/timed out" together for the resend gate. |
| 5 | Reconcile window is inclusive: `startDate` through `endDate` (both endpoints). | Simplest contract for a 15-min cadence. |
| 6 | `executePayments` processes up to `BATCH_SIZE` (default 100) orders per call. | Bounded work; caller re-invokes to drain. |
| 7 | Bank client is an injected interface (`BankClient`), not a concrete HTTP call. | Testability; the task specifies the contract, not the transport. |
| 8 | No HTTP controller exposed; `executePayments` and `reconcile` are service methods called by an external scheduler. | Task says "job", not endpoint. |
| 9 | `app.module.ts` imports only `PaymentModule`; no other feature modules. | Task scope is a single feature. |

## 2. Data model

### `orders` (table: `orders`)

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `supplier_key` | `varchar(255)` | Bank account identifier (IBAN/SP number) |
| `amount_minor_units` | `bigint` | Integer, always > 0 |
| `effective_date` | `date` | The date the payment is effective |
| `txid` | `varchar(64)` | UNIQUE, derived at insert time |
| `status` | `varchar(32)` | One of: `pending`, `sent`, `in_doubt`, `rejected`, `settled`, `parked_manual_review` |
| `attempt_count` | `int` | Default 0, max 5 before parking |
| `last_attempt_at` | `timestamptz` | Nullable |
| `settled_at` | `timestamptz` | Nullable, set when reconciliation confirms |
| `created_at` | `timestamptz` | Default now() |
| `updated_at` | `timestamptz` | Default now(), updated on change |

Indexes: `txid` (unique), `status`, `effective_date`, `(status, effective_date)`.

### `settlements` (table: `settlements`)

| Column | Type | Constraints / Notes |
|--------|------|---------------------|
| `id` | `uuid` | PK |
| `txid` | `varchar(64)` | UNIQUE — one settlement per txid |
| `amount_minor_units` | `bigint` | As reported by bank |
| `settled_at` | `timestamptz` | Bank's settlement timestamp |
| `statement_date` | `date` | The `date` argument to `getStatement` where found |
| `created_at` | `timestamptz` | Default now() |

This table is a local cache/audit of what the bank reported. Upserted by `txid`.

## 3. Types and signatures

```typescript
// ─── Bank client (injected dependency) ───────────────────────────────

interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string;
}

type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}

// ─── Domain types ────────────────────────────────────────────────────

type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

// ─── Repository ──────────────────────────────────────────────────────

interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

class PaymentRepository {
  findPending(limit: number): Promise<OrderRecord[]>;
  findByTxid(txid: string): Promise<OrderRecord | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>;

  markSent(id: string, lastAttemptAt: Date): Promise<void>;
  markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
  markRejected(id: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markPendingForResend(id: string): Promise<void>;
  markParked(id: string): Promise<void>;
  incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>;

  upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void>;
}

// ─── Service ─────────────────────────────────────────────────────────

class PaymentService {
  constructor(
    repo: PaymentRepository,
    bank: BankClient,
    opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  );

  executePayments(): Promise<void>;
  reconcile(window: ReconcileWindow): Promise<ReconcileResult>;

  // Internal — exposed for tests only
  deriveTxid(orderId: string, effectiveDate: Date): string;
}

// ─── Errors ──────────────────────────────────────────────────────────

class BankTransientError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on transient failures (network, 5xx).

class BankPermanentError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on permanent rejection (4xx).
```

**Ordering rules:**

- `markSettled` is only valid when current status is `sent` or `in_doubt`. Repository uses a conditional update (`WHERE id = ? AND status IN ('sent','in_doubt')`) so a concurrent call is a no-op.
- `markPendingForResend` is only valid when current status is `in_doubt`. Conditional update ensures idempotency under overlapping windows.
- `upsertSettlement` uses `ON CONFLICT (txid) DO NOTHING` — re-processing the same statement entry is a no-op.
- `executePayments` must not run concurrently with itself on the same order. The repository's `incrementAttempt` uses an atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; if rows affected is 0, another process won the race and this one skips.

## 4. Control flow

### State machine

```
              ┌──────────────────────────────────────────────────┐
              │                                                  │
   (insert)   ▼        accepted / duplicate                     │
  ┌──────────┐    ─────────────────────►   ┌──────────┐        │
  │ pending  │                             │   sent   │        │
  └──────────┘                             └──────────┘        │
       │                                            │           │
       │ transient_error / timeout                  │ found in  │
       │                                            │ statement │
       ▼                                            ▼           │
  ┌──────────┐   proven absent    ┌──────────┐         ┌────────┤
  │ in_doubt │ ─────────────────► │ pending  │         │settled │
  └──────────┘  (past lag,        └──────────┘         └────────┘
                not in stmt)         │
       │                            │ attempt_count >= max
       │ found in statement         ▼
       └────────────────►   ┌──────────────┐
                            │ parked_manual│
                            │   _review    │
                            └──────────────┘

  rejected (terminal) ── from pending on permanent_rejection
```

Terminal states: `settled`, `rejected`, `parked_manual_review`. No further transitions leave them.

### `executePayments` — per-order logic (inside one DB transaction per order)

1. Fetch up to `batchSize` orders with status `pending`, ordered by `created_at ASC`.
2. For each order:
   a. If `attempt_count >= maxAttempts` → call `markParked`. Continue.
   b. Atomically increment attempt and set `last_attempt_at` (returns new count; if 0 rows affected, skip — another worker got it).
   c. Call `bank.send({ txid, amount_minor_units, key })`.
   d. **Classify response:**
      - `accepted` or `duplicate` → `markSent`.
      - `transient_error` (or `BankTransientError` thrown) → `markInDoubt`.
      - `permanent_rejection` (or `BankPermanentError` thrown) → `markRejected`.
   e. **Timeout** (request exceeds client timeout, treated same as transient) → `markInDoubt`.

### `reconcile(window)` — per-date logic

1. Enumerate each calendar date D from `window.startDate` to `window.endDate`.
2. For each D:
   a. Call `bank.getStatement(D)`.
   b. **Match settlements:** For each settlement in the response, call `repo.findByTxid(settlement.txid)`. If an order is found with status `sent` or `in_doubt`, call `markSettled(id, settlement.settled_at)` and `upsertSettlement(…)`.
   c. **Proven-absent check:** If D's statement is complete (`now > endOfDay(D) + publishingLagMs`):
      - Fetch all orders with status `in_doubt` and `effective_date = D`.
      - For each, if its `txid` is NOT in the set of txids returned by `getStatement(D)`, call `markPendingForResend(id)`.
3. Return `{ settled, provenAbsent }` counts.

**Transaction boundaries:** Each per-order state transition in step 2b and each per-order transition in step 2c is wrapped in a single short transaction (the conditional UPDATE + the upsertSettlement for 2b). The `bank.send` / `bank.getStatement` calls are **never** inside a DB transaction.

**Must not be inside a transaction:** any `bank.*` call, any loop over more than one order.

### Idempotency under overlapping windows

- `markSettled` uses `WHERE status IN ('sent','in_doubt')` — already-settled orders are untouched.
- `markPendingForResend` uses `WHERE status = 'in_doubt'` — already-pending orders are untouched.
- `upsertSettlement` uses `ON CONFLICT DO NOTHING` — duplicate statement entries are absorbed.
- Therefore running `reconcile` twice over the same or overlapping window is safe.

## 5. Tests

| Test | What it proves |
|------|---------------|
| `executePayments: accepted response transitions pending → sent` | A successful bank send marks the order as settled-pending (awaiting reconciliation). |
| `executePayments: duplicate response transitions pending → sent` | Idempotent re-send (same txid) is treated as success. |
| `executePayments: transient error transitions pending → in_doubt` | A known-failure is flagged for reconciliation before any resend. |
| `executePayments: timeout transitions pending → in_doubt` | An unknown outcome (timeout) is treated identically to a transient error. |
| `executePayments: permanent rejection transitions pending → rejected` | A definitive bank refusal is terminal; no further attempts. |
| `executePayments: attempt_count >= max parks the order` | The 6th eligibility triggers `parked_manual_review`; no bank call is made. |
| `executePayments: concurrent increment skips the order` | Two workers racing on the same order results in exactly one send. |
| `reconcile: found-in-statement transitions sent → settled` | A confirmed settlement advances a known-sent order to its terminal success state. |
| `reconcile: found-in-statement transitions in_doubt → settled (timeout-but-settled)` | A timed-out send that actually went through is NOT resent; it is settled. This is the critical "no double-pay" guarantee. |
| `reconcile: proven-absent transitions in_doubt → pending (same txid preserved)` | After the publishing lag, an absent order becomes eligible for resend with its original txid. |
| `reconcile: statement not yet complete leaves in_doubt unchanged` | Before the lag expires, no proven-absent transition occurs. |
| `reconcile: overlapping windows are idempotent` | Running reconcile twice over the same window does not double-count or corrupt state. |
| `reconcile: rejected orders are untouched by reconciliation` | Terminal `rejected` status is never modified by reconcile. |
| `deriveTxid: deterministic for same input` | Same orderId + effectiveDate always yields the same txid. |
| `deriveTxid: different orders or dates yield different txids` | The derivation is injective (collision-free in practice). |
| `full lifecycle: timeout → reconcile proves absent → resend accepted → settle` | End-to-end happy path with a timeout and one retry. |
| `full lifecycle: 5 timeouts → parked_manual_review` | Attempt exhaustion parks the order; a 6th reconcile does not re-park or modify it. |

## 6. Manifest

```html
<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema: Order and Settlement models
src/payment/bank-client.interface.ts | reads: - | BankClient interface, BankSendRequest/Response, Settlement types
src/payment/payment.repository.ts | reads: src/payment/bank-client.interface.ts | All Prisma queries and conditional updates for orders and settlements
src/payment/payment.service.ts | reads: src/payment/bank-client.interface.ts, src/payment/payment.repository.ts | PaymentService: executePayments, reconcile, deriveTxid
src/payment/payment.module.ts | reads: src/payment/payment.service.ts, src/payment/payment.repository.ts | NestJS module wiring providers and exports
src/app.module.ts | reads: src/payment/payment.module.ts | Root module importing PaymentModule
test/payment.spec.ts | reads: src/payment/bank-client.interface.ts, src/payment/payment.service.ts, src/payment/payment.repository.ts | Unit + integration tests for state machine, idempotency, attempt cap
-->
