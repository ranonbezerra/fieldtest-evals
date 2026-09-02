# plan

## reasoning

```
Let me plan this carefully. I need to write a PLAN.md for an instant-payment payout reconciler with NestJS + Prisma + Postgres.

Let me think through the key design decisions:

1. **Data Model**: 
   - `orders` table: id, amount (integer minor units), bank_key, status (pending, sent, settled, failed, parked), attempts (integer), txid, effective_date, created_at, updated_at
   - `settlements` table: id, txid, date, amount, raw data maybe
   - `reconciliation_windows` table: to track which windows have been processed (for idempotency)

2. **Key decisions**:
   - TXID derivation: deterministic from order ID + effective date (e.g., SHA-256 hash truncated, or a structured format)
   - State machine: pending → sent → settled; pending/failed → (reconcile proves absent) → resend → sent; sent (timeout) → reconcile proves settled → settled; attempts exhausted → parked
   - Reconcile window safety: use a processed_windows table or check if the window date range was already processed
   - Publishing lag: 30 min. So reconciliation for date D can only confirm absence if the window is at least 30 min past the latest possible publication time.

3. **Bank response classification**:
   - accepted → mark as sent
   - duplicate → treat as already sent (idempotent)
   - transient error → keep pending, increment attempts on next cycle? No—keep state, retry next cycle
   - permanent rejection → mark as failed (no retry)

4. **Resend logic**:
   - Order is in "sent" state (meaning send was called but timed out/unknown)
   - Reconcile checks: is this txid in the statement for the effective date? If yes → settled. If no, AND the window is past publishing lag → proven absent → resend with same txid
   - Cap at 5 attempts total (including original)
   - After 5 → parked

Let me think about the state machine more carefully:

States: `pending`, `in_flight`, `sent`, `settled`, `failed_permanent`, `parked`

Wait, let me reconsider. The task says:
- "sends pending orders" — so there's a "pending" state
- "send failed/timed out may only be re-sent after reconciliation proves it is absent" — so after a send attempt, the order is in some state where we don't know if it succeeded
- "timeout-but-settled (no resend)" — the send timed out but reconciliation finds it in the statement → settled
- "proven-absent (resend, same txid)" — reconciliation proves it's not in the statement → resend

So states:
- `pending`: not yet sent (or failed with transient error, can retry)
- `in_flight`: send was called, result unknown (timeout). Awaiting reconciliation.
- `settled`: confirmed paid (found in statement)
- `rejected`: permanently rejected by bank, won't retry
- `parked`: attempts exhausted, manual review needed

Actually let me simplify:
- `pending`: initial state, or transient error (eligible for next send cycle)
- `in_flight`: send was called but no definitive response (timeout, or accepted-but-unconfirmed). Awaiting reconciliation.
- `settled`: confirmed in statement
- `rejected`: permanent rejection
- `parked`: 5 attempts used up

Wait, "accepted" from the bank — does that mean settled or just in_flight? The task says "classify bank.send responses (accepted, duplicate, transient error, permanent rejection) and handle each differently."

- accepted → the bank accepted it. But is it settled? In instant payments, "accepted" might mean it's processing. But since we have a statement API, maybe accepted → in_flight (awaiting settlement confirmation), or maybe accepted → settled directly?

Actually, for instant payments, "accepted" likely means the payment went through. But the task says reconciliation matches statement entries to orders and advances their state. So maybe:
- accepted → mark as `sent` (we know it was accepted, but we confirm settlement via reconciliation)
- Actually, re-reading: "reconcile(window) — matches statement entries to orders and advances their state"

I think the flow is:
- pending → (executePayments) → in_flight (we called send, got a response or timed out)
- If response is "accepted" → sent (bank confirmed receipt)
- If response is "duplicate" → treat same as accepted → sent
- If response is "transient error" → stay pending (or go back to pending), increment attempts? No, don't increment on transient—just retry next cycle
- If response is "permanent rejection" → rejected
- If timeout (no response) → in_flight (unknown state)

Then reconciliation:
- For orders in `sent` or `in_flight`: check if txid appears in statement
  - Found → settled
  - Not found AND window is past publishing lag (i.e., it's been >30 min since the effective date's latest publication time) → proven absent
    - If attempts < 5 → back to pending (will be re-sent next cycle with same txid)
    - If attempts >= 5 → parked

Wait, but if we got "accepted" from the bank, why would it not be in the statement? That would be weird. Let me re-think.

Actually, for instant payments:
- "accepted" means the bank received and processed it → it WILL appear in the statement
- Timeout means we don't know if it was sent at all

So:
- accepted → `sent` (high confidence it's there, but reconcile confirms)
- duplicate → `sent` (it was already sent before, same txid)
- transient error → `pending` (retry next cycle)
- permanent rejection → `rejected`
- timeout → `in_flight` (unknown, needs reconciliation)

Reconciliation:
- For `sent` orders: find in statement → `settled`. Should always be found. If not found past lag → something went wrong? Maybe still `sent` and wait for next window? Or treat as proven absent? I'll say: if not found past lag, it's an anomaly—leave as `sent` and log/alert. Actually the task says "matches statement entries to orders and advances their state" — so only advance when matched. If not matched, stay in current state.
- For `in_flight` orders: find in statement → `settled`. Not found past lag → proven absent → increment attempts, if < 5 go back to `pending`, else `parked`.

This makes sense. The key insight: we only resend when we're in `in_flight` (unknown state) and reconciliation proves absence.

Now for the txid: "derived deterministically from the order + effective date". I'll use a format like `sha256(order_id:effective_date).substring(0, 32)` or similar. Actually, let me make it a structured format: `{order_id}-{effective_date}-v1` hashed. Or simpler: the txid is a function like `generateTxid(orderId, effectiveDate)` that produces a deterministic string. Let me specify it as `sha256hex(`${orderId}:${effectiveDate.toISOString()}`).slice(0, 32)`.

Actually, for bank APIs, txids are often UUIDs or specific formats. Let me just say it's a deterministic 32-char hex string derived from order ID and effective date. The exact algorithm can be specified.

Let me now think about the reconcile window safety:
- "safe to run every 15 minutes, including over overlapping windows"
- The window is a date (or date range). If we run reconcile for date D, and it overlaps with a previous run, we must not double-process.
- Solution: use a `reconciliation_runs` table with (date, processed_at) to track what's been done. Or: make the reconciliation idempotent by checking current state of orders before acting.
- Actually, the simplest approach: reconciliation is idempotent by nature. If an order is already `settled`, checking it again won't change anything. If it's still `in_flight` and the txid is in the statement, set to `settled`. If it was already set to `settled`, the match step is a no-op. The "proven absent" check: if an order was already moved back to `pending` (resend), it won't be in `in_flight` anymore, so it won't be re-processed.
- But there's a race: if two reconcile runs overlap, both might see the order as `in_flight` and both try to set it. Use optimistic locking or a status check within a transaction.
- I'll specify: reconcile uses a WHERE clause that checks current status, making it idempotent. Wrap state transitions in a transaction.

For the "publishing lag" check:
- The bank publishes statements with ~30 min lag. So for date D, the statement is complete at D + 1 day + 30 min? Or is it that for a given "effective date", the statement for that date becomes available 30 min after end of day? 
- Actually re-reading: "the bank exposes getStatement(date) -> Settlement[] (each with the txid we sent) with up to ~30 min of publishing lag"
- I think this means: if you query getStatement for a given date, the results are complete (all settlements for that date have been published) after at most 30 minutes. So if effective_date is "2024-01-15", the statement for that date is complete by end-of-day + 30 min.
- Wait, or does it mean the statement for "today" is lagging by 30 min? Like, if it's 10:30 AM, the statement only shows transactions up to 10:00 AM?
- For "proven absent past the publishing lag": we can only conclude a txid is absent if the statement is complete for that date. If the effective date is yesterday (or earlier), the statement is definitely complete. If it's today, we need to wait 30 min past the end of day? Or 30 min past the time of the send?

I think the most practical interpretation: for a given effective_date, the statement is guaranteed complete after `effective_date + 1 day` (i.e., next day). The 30 min lag means if you query same-day, you might miss the last 30 minutes of transactions. So for "proven absent", we require that the current time is at least `effective_date + 1 day + 30 min` (or simply that the effective date is at least yesterday). 

Actually, simpler: the `reconcile(window)` takes a window (a date or range). The "past publishing lag" condition means: for date D in the window, we can only conclude absence if `now > D + 30 min` (if D is a time) or `now > end_of_day(D) + 30 min` (if D is a date). Since these are daily settlements, I'll say: an order with effective_date D can be proven absent only if `now >= start_of_day(D+1) + 30 min`.

Hmm, but the task says "up to ~30 min of publishing lag" which sounds like it's within the same day. Like, the statement for "today" is updated every minute but lags by up to 30 min. So if a payment was made at 10:00 AM, it might not appear in the statement until 10:30 AM.

For the plan, I'll define: an order is "past publishing lag" if `now - effective_date > 30 min` (treating effective_date as the timestamp of the send). This is the safest interpretation for a 15-min cron.

Actually, let me re-read: "reconcile(window)" — the window is probably a date range. And "past the publishing lag" means the window is old enough that all settlements should have been published.

Let me just define: `isPastPublishingLag(windowEnd)` returns true if `now - windowEnd > 30 min`. Only orders in windows where this is true can be proven absent. Orders in more recent windows can only be matched (found → settled) but not proven absent.

OK let me now structure the plan.

**Files to create:**
- `prisma/schema.prisma` — database schema
- `src/payouts/payouts.module.ts` — NestJS module
- `src/payouts/payouts.controller.ts` — HTTP endpoints (if any) — actually, the task says "Build... executePayments(), reconcile(window), Resend logic". These might be job methods, not HTTP endpoints. Let me think...
  - The task says "Deliver schema, service, reconcile job, and tests"
  - So: service (with executePayments), a job (reconcile), and tests
  - Maybe a controller for triggering these, or just the service + a scheduled job
  - I'll include a controller for manual triggering and the service with the logic

- `src/payouts/payouts.service.ts` — main business logic
- `src/payouts/payouts.repository.ts` — Prisma queries
- `src/payouts/bank-client.ts` — interface + mock for bank API
- `test/payouts.spec.ts` — tests

Wait, the conventions say:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

So the feature is "payouts" or "reconciliation"? The task is about payments + reconciliation. I'll call the feature "payouts".

Let me also think about what the controller exposes:
- POST /payouts/execute — triggers executePayments
- POST /payouts/reconcile — triggers reconcile for a given window
- Or GET /payouts — list orders

Actually the task says "Build: 1. executePayments(), 2. reconcile(window), 3. Resend logic, 4. Classify responses". These are operations, not necessarily HTTP endpoints. But in NestJS, we need a controller or a job. I'll make them service methods called by a controller (for manual triggering) and note they'd be called by a cron in production.

Let me finalize the structure:

```
prisma/schema.prisma
src/payouts/payouts.module.ts
src/payouts/payouts.controller.ts
src/payouts/payouts.service.ts
src/payouts/payouts.repository.ts
src/payouts/bank-client.ts
test/payouts.spec.ts
```

Now let me write the plan sections.

**Section 1: Assumptions**
- TXID format: deterministic SHA-256 of `orderId|effectiveDateISO`, first 32 hex chars
- Bank client is an injectable interface (for testing)
- "Window" for reconcile is a date string (YYYY-MM-DD)
- Publishing lag threshold: 30 minutes from the effective date's end-of-day (i.e., next day + 30 min)
- Feature folder: `src/payouts/`
- Controller exposes POST endpoints for triggering operations; production would use cron
- The "duplicate" response from bank means the txid was already processed → treat as `sent`
- Amount in minor units (cents), stored as integer
- effective_date is the date the payment is for (settlement date), stored as DATE

**Section 2: Data model**
- `orders` table
- Maybe no need for a separate settlements table if we just query the bank API each time. But for idempotency of reconcile, we might want to cache statement entries. Actually, the task says "reconcile(window) — matches statement entries to orders". If we call getStatement each time, and the statement is stable (append-only), then we just need to check our orders against it. No need to store settlements locally.
- But wait: "safe to run every 15 minutes, including over overlapping windows" — if we just re-query the bank and re-process, idempotency comes from state checks. I'll go with no local settlements storage; the bank is the source of truth for statements.

Actually, I should add a `reconciliation_runs` table to track which windows have been processed, for observability and to avoid redundant bank API calls. But the task doesn't strictly require it. Let me keep it simple: no extra table, rely on state-based idempotency.

**Section 3: Types and signatures**
- OrderStatus enum
- BankSendResponse union type
- BankClient interface
- PayoutsRepository class
- PayoutsService class with methods
- PayoutsController class

**Section 4: Control flow**
- State machine for orders
- executePayments flow
- reconcile flow
- Transaction boundaries

**Section 5: Tests**
- timeout-but-settled (no resend)
- proven-absent (resend, same txid)
- attempt exhaustion (parked)
- classify each bank response type
- idempotent reconcile

**Section 6: Manifest**

Let me write this out now, being concise.
```

## reply

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
```
