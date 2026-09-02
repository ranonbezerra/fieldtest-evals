## 1. Assumptions

| Decision | Choice | Why |
|---|---|---|
| Feature folder name | `src/payouts/` | Covers both send and reconcile in one bounded context. |
| TXID derivation | `sha256hex("${orderId}:${effectiveDate}")` truncated to 32 hex chars | Deterministic, collision-resistant, bank-friendly length. |
| `effectiveDate` semantics | The settlement date (YYYY-MM-DD) the payment is booked against; stored as Prisma `DateTime` at UTC midnight. | Aligns with the bank's `getStatement(date)` key. |
| "Window" for reconcile | A single date string (`YYYY-MM-DD`); the job may be called with multiple dates. | The bank API is keyed by date. |
| Publishing-lag threshold | An order with `effectiveDate` D is "past lag" iff `now >= D + 24 h + 30 min` (i.e., next calendar day + 30 min). | Guarantees the full daily statement is published before we can prove absence. |
| Bank client | Injectable interface `BankClient` with a real HTTP impl and a mock in tests. | Separates I/O from logic; enables unit tests without network. |
| Controller surface | `POST /payouts/execute`, `POST /payouts/reconcile` (body: `{ date }`). Production adds a cron calling the same service methods. | Minimal HTTP; the real driver is a scheduler. |
| "Duplicate" from bank | Treated identically to "accepted": the txid is in-flight at the bank. | Idempotent send guarantee. |
| Transient error | Order returns to `pending`; `attempts` is **not** incremented (only committed sends count). | Transient failures don't consume the budget. |
| Attempt count | `attempts` increments each time a send is *committed* (accepted, duplicate, or timeout). Max 5. | A timed-out send may have landed; it counts. |
| No local settlements cache | Reconcile calls `bank.getStatement(date)` each run; idempotency via order-state guards. | Avoids a second source of truth; bank is canonical. |

## 2. Data model

### `orders` (`@@map("orders")`)

| Column | Prisma field | Type | Notes |
|---|---|---|---|
| `id` | `id` | `String @id @default(cuid())` | |
| `amount_cents` | `amountCents` | `Int @map("amount_cents")` | Minor units, always > 0. |
| `bank_key` | `bankKey` | `String @map("bank_key")` | Recipient bank account identifier. |
| `status` | `status` | `OrderStatus @default(pending)` | Enum (below). |
| `attempts` | `attempts` | `Int @default(0)` | Committed send attempts. |
| `txid` | `txid` | `String? @map("txid")` | Populated on first send; immutable thereafter. |
| `effective_date` | `effectiveDate` | `DateTime @map("effective_date")` | UTC midnight of settlement day. |
| `created_at` | `createdAt` | `DateTime @default(now())` | |
| `updated_at` | `updatedAt` | `DateTime @updatedAt` | |

Indexes: `(status, effectiveDate)` for send/reconcile scans; unique on `txid` where non-null.

### Enum `OrderStatus` (`@map("order_status")`)

Values: `PENDING`, `IN_FLIGHT`, `SETTLED`, `REJECTED`, `PARKED`.

## 3. Types and signatures

```ts
// ---- src/payouts/bank-client.ts ----

export interface BankSendRequest {
  txid: string;
  amountCents: number;
  bankKey: string;
}

export type BankSendResult =
  | { kind: 'accepted' }
  | { kind: 'duplicate'; originalAcceptedAt: Date }
  | { kind: 'transient'; reason: string }
  | { kind: 'permanent_rejection'; code: string; reason: string };

export interface BankSettlement {
  txid: string;
  amountCents: number;
  settledAt: Date;
}

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResult>;
  getStatement(date: string /* YYYY-MM-DD */): Promise<BankSettlement[]>;
}
```

```ts
// ---- src/payouts/payouts.repository.ts ----

export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPending(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>;
  findInFlight(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>;
  findByTxid(txid: string): Promise<Prisma_ordersGetPayload<never> | null>;

  /** Atomically transition. Returns true if the row was updated (status matched). */
  transition(id: string, from: OrderStatus, to: OrderStatus,
             patch?: Partial<Pick<Order, 'attempts' | 'txid'>>): Promise<boolean>;
}
```

```ts
// ---- src/payouts/payouts.service.ts ----

export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}

export class PayoutsService {
  constructor(
    private readonly repo: PayoutsRepository,
    private readonly bank: BankClient,
  ) {}

  /** Send all PENDING orders for the given effective date. */
  executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }>;

  /** Reconcile one date window. Idempotent; safe under overlap. */
  reconcile(date: string /* YYYY-MM-DD */): Promise<ReconcileResult>;

  // --- internal helpers (not exported) ---
  private deriveTxid(orderId: string, effectiveDate: Date): string;
  private isPastPublishingLag(effectiveDate: Date, now?: Date): boolean;
}
```

```ts
// ---- src/payouts/payouts.controller.ts ----

export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  execute(@Body() body: { effectiveDate: string }): Promise<{ sent: number; rejected: number }>;

  @Post('reconcile')
  reconcile(@Body() body: { date: string }): Promise<ReconcileResult>;
}
```

### Errors

| Code | Raised when |
|---|---|
| `invalid_date_format` | Controller receives a date string that is not `YYYY-MM-DD`. |
| `bank_unavailable` | `BankClient.send` or `getStatement` throws (network, 5xx). Wrapped in the standard error envelope. |

All errors use the single envelope `{ error: { code, message, details } }`.

### Ordering rules

- `executePayments` must complete before `reconcile` for the same date: a send in progress (status `IN_FLIGHT`) is the input to reconcile. If both run concurrently, reconcile must not see a `PENDING` row mid-send.
- Reconcile for date D and D+1 may run concurrently; they touch disjoint `effectiveDate` sets, so no conflict.
- Within one reconcile call, matching (found → SETTLED) is processed before absence-check (not found + past lag → PENDING or PARKED). An order matched in the same statement will never be treated as absent.

## 4. Control flow

### Order state machine

```
PENDING ──send accepted/duplicate──▶ IN_FLIGHT ──reconcile: found──▶ SETTLED
PENDING ──send timeout (no resp)──▶ IN_FLIGHT ──reconcile: absent + past lag──▶ PENDING (attempts<5)
PENDING ──send permanent reject──▶ REJECTED  (terminal)
PENDING ──send transient error──▶ PENDING   (attempts unchanged)
IN_FLIGHT ──reconcile: absent + past lag + attempts≥5──▶ PARKED (terminal)
```

`SETTLED`, `REJECTED`, `PARKED` are terminal. No auto-revert from any state.

### executePayments(effectiveDate)

1. `repo.findPending(effectiveDate)` → list of orders.
2. For each order (sequentially, to respect bank rate limits):
   a. Compute `txid = deriveTxid(order.id, effectiveDate)`. If `order.txid` is already set, reuse it (resend path).
   b. Call `bank.send({ txid, amountCents, bankKey })`.
   c. Classify:
      - `accepted` / `duplicate` → `repo.transition(id, PENDING, IN_FLIGHT, { txid, attempts: order.attempts + 1 })`.
      - `transient` → no state change; log and continue.
      - `permanent_rejection` → `repo.transition(id, PENDING, REJECTED)`.
   d. If `bank.send` throws (network) → treat as timeout: `repo.transition(id, PENDING, IN_FLIGHT, { txid, attempts: order.attempts + 1 })`.
3. Return counts.

No outer transaction; each order is an independent unit of work. A failure on one order does not block others.

### reconcile(date)

1. Compute `effectiveDate = parseUTC(date)` (midnight UTC).
2. Call `bank.getStatement(date)` → `Settlement[]`. Build a `Map<txid, BankSettlement>`.
3. **Match phase** — `repo.findInFlight(effectiveDate)`:
   - For each order, if `statementMap.has(order.txid)`:
     - Verify `amountCents` matches; if mismatch, raise an alarm log and skip (do not settle).
     - `repo.transition(id, IN_FLIGHT, SETTLED)`. Increment `settled` counter.
4. **Absence phase** — re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled):
   - For each remaining order:
     - If `!isPastPublishingLag(effectiveDate)` → skip (cannot yet prove absence).
     - Else: `newAttempts = order.attempts`.
       - If `newAttempts >= 5` → `repo.transition(id, IN_FLIGHT, PARKED)`. Increment `parked`.
       - Else → `repo.transition(id, IN_FLIGHT, PENDING)`. Increment `provenAbsent`.
5. Return `{ date, settled, provenAbsent, parked }`.

**Idempotency / overlap safety:**
- `repo.transition` uses `UPDATE … WHERE id = ? AND status = $from`. If a concurrent run already moved the row, the update affects 0 rows and returns `false`; the caller skips.
- The match phase runs before the absence phase within the same call, so an order found in the statement is never also treated as absent.
- No distributed lock needed; the `WHERE status = $from` guard is sufficient for the 15-min cadence.

### Transaction boundaries

Each `repo.transition` is a single Prisma `$transaction` (or a bare parameterised UPDATE). There is no multi-row transaction spanning the send loop or the reconcile scan.

## 5. Tests

| # | Proves |
|---|---|
| 1 | Timeout-but-settled: order sent (→ IN_FLIGHT), reconcile finds txid in statement → status becomes SETTLED; no resend occurs. |
| 2 | Proven-absent, attempts remaining: order IN_FLIGHT, not in statement, past lag → status returns to PENDING, same txid retained; next executePayments reuses the txid. |
| 3 | Attempt exhaustion: order IN_FLIGHT, not in statement, past lag, attempts = 5 → status becomes PARKED; a subsequent executePayments does not pick it up. |
| 4 | Accepted response: PENDING → IN_FLIGHT, attempts incremented, txid stored. |
| 5 | Duplicate response: PENDING → IN_FLIGHT (same as accepted), attempts incremented. |
| 6 | Transient error: status stays PENDING, attempts unchanged; order is eligible for next executePayments. |
| 7 | Permanent rejection: PENDING → REJECTED; order is never picked up by executePayments or reconcile again. |
| 8 | Not-yet-past-lag: order IN_FLIGHT, not in statement, but `now` is within 30 min of effectiveDate+24h → status unchanged (still IN_FLIGHT). |
| 9 | Reconcile idempotency: running reconcile twice for the same date does not double-settle or double-park; counts on second run are zero. |
| 10 | Amount mismatch: statement entry has different `amountCents` than order → order is NOT settled; remains IN_FLIGHT. |
| 11 | TXID determinism: calling `deriveTxid` with same order ID + date yields the same 32-char hex string across calls. |
| 12 | Bank network error on send: treated as timeout → IN_FLIGHT, attempts incremented. |

## 6. Manifest

```
<!-- manifest
prisma/schema.prisma | reads: - | orders table, OrderStatus enum, indexes
src/payouts/bank-client.ts | reads: - | BankClient interface, BankSendRequest/Result, BankSettlement types
src/payouts/payouts.repository.ts | reads: prisma/schema.prisma | PayoutsRepository class (find, transition)
src/payouts/payouts.service.ts | reads: src/payouts/bank-client.ts, src/payouts/payouts.repository.ts | PayoutsService: executePayments, reconcile, deriveTxid, isPastPublishingLag
src/payouts/payouts.controller.ts | reads: src/payouts/payouts.service.ts | PayoutsController: POST /payouts/execute, POST /payouts/reconcile
src/payouts/payouts.module.ts | reads: src/payouts/payouts.controller.ts, src/payouts/payouts.service.ts, src/payouts/payouts.repository.ts | NestJS module wiring providers, controller
test/payouts.spec.ts | reads: src/payouts/payouts.service.ts, src/payouts/bank-client.ts | Unit tests for all behaviours listed in section 5
-->
