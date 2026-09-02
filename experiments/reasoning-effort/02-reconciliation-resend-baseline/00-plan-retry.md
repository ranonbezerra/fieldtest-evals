# plan-retry

## reasoning

```
The user wants me to write a PLAN.md for the instant-payment payout reconciler task. Let me carefully design this based on the variant-a reference and the codebase conventions.

Key things to nail down:
1. Assumptions - what's open in the spec
2. Data model - Prisma schema
3. Types and signatures - complete type declarations
4. Control flow - state machine, transactions
5. Tests - one line each
6. Manifest - files with reads

Let me think through the design:

**State machine for an order:**
- `pending` → (send attempted) → `sent` / `failed`
- `sent` → (reconciliation finds it in statement) → `settled`
- `failed`/`sent` (timeout) → (reconciliation proves absent past lag) → resend → back to `sent`
- After 5 attempts → `parked_manual_review`

Wait, let me reconsider. The spec says:
- "sends sometimes time out" — so after a timeout, we don't know if it was sent or not
- "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag"

So the states should be:
- `pending` — not yet sent
- `sent` — we got an acceptance from the bank (or we think we did after a timeout)
- `failed` — bank rejected permanently? No, permanent rejection is terminal. Let me re-read.

"Classify `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and handle each differently."

So:
- accepted → mark as `sent`
- duplicate → means we already sent it, mark as `sent` (idempotent)
- transient error → mark as `failed` (eligible for resend after reconciliation proves absence)
- permanent rejection → mark as `rejected` (terminal, no resend)

Wait, but "timeout" is different from "transient error". A timeout means we don't know if it went through. A transient error means the bank explicitly told us it didn't go through (or will retry).

Let me reconsider the states:
- `pending` — order exists, not yet sent to bank
- `sent` — bank accepted (or duplicate confirmation), waiting for settlement
- `unknown` — send timed out, we don't know if bank received it. Eligible for resend only after reconciliation proves absence.
- `failed` — bank returned transient error, we know it didn't go through. Eligible for resend after reconciliation proves absence (to be safe, same rule).
- `rejected` — bank permanently rejected. Terminal.
- `settled` — reconciliation found it in the statement. Terminal (success).
- `parked_manual_review` — attempt cap hit. Terminal (needs human).

Actually, re-reading: "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag."

So both `failed` and `unknown` (timeout) need reconciliation to prove absence before resend. The state `sent` doesn't need resend — it's waiting for settlement.

Let me simplify:
- `pending` — not yet sent
- `sent` — bank confirmed acceptance (accepted or duplicate response)
- `in_doubt` — send timed out OR transient error (we don't have confirmation it didn't go through, or we want to be safe)
- `rejected` — permanent rejection, terminal
- `settled` — found in statement, terminal (success)
- `parked_manual_review` — 5 attempts exhausted, terminal

Hmm, actually for a transient error the bank explicitly told us it failed. But the spec says "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent." So the rule applies to both. This makes sense — even if the bank says "transient error", there's a small chance it actually processed, so we reconcile first.

Let me define:
- `pending` → executePayments tries to send
- After send:
  - accepted → `sent`
  - duplicate → `sent` (we already sent it, just confirming)
  - transient error → `in_doubt` (will be resubmitted after reconciliation proves absence)
  - timeout → `in_doubt` (same as transient error from safety perspective)
  - permanent rejection → `rejected`
- Reconciliation:
  - `sent` + found in statement → `settled`
  - `in_doubt` + proven absent (not in any statement for the window, past publishing lag) → `pending` (eligible for resend)
  - `in_doubt` + found in statement → `settled` (it actually went through despite the error/timeout)

Wait, but "proven absent past the publishing lag" — this means we need to check that the statement for that date has been fully published (i.e., enough time has passed since end of that date + 30 min lag). If the statement hasn't been published yet, we can't prove absence.

So reconciliation logic:
1. For each order in `sent` or `in_doubt` state with an effective date D:
   - Check if the statement for date D is "complete" (i.e., current time > D + 24h + 30min lag, or whatever the rule is)
   - Actually, re-reading: "getStatement(date) -> Settlement[]" with up to ~30 min of publishing lag. So the statement for date D might not be complete until ~30 min after end of day D? Or 30 min after the settlement time?

Hmm, let me re-read: "the bank exposes getStatement(date) -> Settlement[] with up to ~30 min of publishing lag."

I think this means: after a payment is settled on date D, it may take up to 30 minutes for it to appear in getStatement(D). So if we reconcile at time T, and the effective date is D, we can only trust "absence from statement" if T > D_end + 30min.

Actually, I think the simpler interpretation: the statement for a given date is complete (no more entries will be added) after 30 minutes past the end of that date. So if we're reconciling for date D, and current time > D + 24h + 30min, then the statement is authoritative.

But wait — "Must be safe to run every 15 minutes, including over overlapping windows." This suggests the reconcile job takes a window (start, end) and processes orders whose effective date falls in that window. The "overlapping windows" part means we need idempotency — processing the same order twice shouldn't cause issues.

Let me think about the txid derivation: "The txid must be derived deterministically from the order + effective date." So it's something like `hash(orderId, effectiveDate)` or just a formatted string. This ensures that if we resend, we use the same txid, making it idempotent at the bank.

Now for the data model:

**Order table:**
- id (uuid, PK)
- supplier_key (string) — the bank account key to pay
- amount_minor_units (integer) — in minor units (cents)
- effective_date (date) — the date the payment is effective
- txid (string, unique) — derived deterministically
- status (enum/string)
- attempt_count (integer, default 0)
- last_attempt_at (timestamp, nullable)
- settled_at (timestamp, nullable) — when reconciliation confirmed settlement
- created_at (timestamp)
- updated_at (timestamp)

**Settlement table** (cache of statement entries we've seen):
- id (uuid, PK)
- txid (string, unique) — matches order.txid
- amount_minor_units (integer)
- settled_at (timestamp) — when the bank settled it
- statement_date (date) — the date in getStatement(date) where we found it
- created_at (timestamp)

Actually, do we need a settlements table? We could just store the reconciliation result on the order. But having a settlements table lets us:
1. Record what the bank reported
2. Handle overlapping windows (if we see the same settlement again, it's idempotent)
3. Audit trail

I think yes, we need it.

Let me also think about the "window" concept. The reconcile job takes a window like `reconcile({ startDate, endDate })`. It:
1. Fetches statements for each date in the window from the bank
2. Matches statement entries to orders by txid
3. For matched: advances order to `settled`
4. For orders in the window that are `in_doubt` and NOT matched: if the statement is "complete" (past publishing lag), marks them as `pending` for resend

Wait, but "safe to run every 15 minutes including over overlapping windows" — this means:
- If we run reconcile for [D1, D2] and then [D2, D3], orders on D2 get processed twice
- This must be idempotent

The idempotency comes from:
- Setting an order to `settled` is idempotent (if already settled, skip)
- Setting an order to `pending` for resend: only if it's currently `in_doubt`
- Inserting a settlement: use upsert by txid

Now for the "proven absent past publishing lag" check:
- An order is eligible for resend if:
  - Its status is `in_doubt`
  - The statement for its effective date has been fully published (current time > effective_date + 24h + publishing_lag)
  - Its txid is NOT in any statement entry (not settled)

Actually wait — "past the publishing lag" could mean: we need to check that enough time has passed since the order's effective date for the statement to be complete. If the effective date is yesterday and it's now 2am, and the lag is 30 min past end of day, then yesterday's statement is complete.

Let me define: a statement for date D is "complete" when `now >= D + 1 day + PUBLISHING_LAG` where PUBLISHING_LAG is 30 minutes (configurable).

Actually, I realize I should think about this differently. The publishing lag is 30 minutes. So if a payment settles at 23:59 on date D, it might not appear in getStatement(D) until 00:29 on D+1. So the statement for date D is complete at D+1 00:30 (i.e., end of day D + 30 min).

So the rule is: for an order with effective_date = D, we can prove absence only if `now > D + 24h + 30min` (end of day D plus publishing lag).

But actually, for the reconcile job running every 15 minutes with a window, I think the approach is:
- The window represents dates we're checking
- For each date in the window, we call getStatement(date)
- We match entries to orders
- For orders in `in_doubt` state whose effective_date is in the window AND the statement for that date is complete (past lag), if they're not matched, they're proven absent

Let me now think about the file layout:

```
prisma/schema.prisma
src/main.ts (maybe not needed if this is a library/service)
src/app.module.ts
src/payment/payment.module.ts
src/payment/payment.service.ts
src/payment/payment.repository.ts
src/payment/reconcile.service.ts (or is it part of payment.service?)
src/payment/types.ts (or types in the service file?)
src/bank/bank-client.ts (interface for the bank API)
test/payment.spec.ts
test/reconcile.spec.ts
```

Hmm, looking at the conventions: `src/<feature>/<feature>.module.ts`, `src/<feature>/<feature>.controller.ts`, `src/<feature>/<feature>.service.ts`, `src/<feature>/<feature>.repository.ts`

There's no controller mentioned in the task — this is a job, not an API endpoint. So maybe:
- `src/payment/payment.module.ts`
- `src/payment/payment.service.ts` — holds executePayments and reconcile logic
- `src/payment/payment.repository.ts` — Prisma access
- `src/payment/bank-client.interface.ts` — the bank API interface

Wait, but the task says "reconcile job" — should this be a separate service? Let me keep it in the payment service since it's all about payments. Or maybe a separate `reconcile.service.ts`?

Actually, looking at the conventions more carefully: "A service, repository or processor is listed in its module's providers." So I could have `payment.service.ts` and a `reconcile.processor.ts` (for a cron job). But the task doesn't specify a processor/cron — it just says "reconcile(window)" is a function. Let me keep it as a service method.

Let me also think about the bank client. The spec says "the bank exposes getStatement(date) -> Settlement[]". I need an interface for this.

Let me finalize my design:

**Files:**
1. `prisma/schema.prisma` — Order, Settlement models
2. `src/payment/bank-client.interface.ts` — BankClient interface, BankSendResponse type
3. `src/payment/payment.service.ts` — PaymentService with executePayments() and reconcile()
4. `src/payment/payment.repository.ts` — PaymentRepository
5. `src/payment/payment.module.ts` — module wiring
6. `test/payment.spec.ts` — tests

Actually, I should also have a types file or put types in the service. Let me put shared types in a types file.

Wait, the conventions say `src/<feature>/<feature>.service.ts` etc. Let me keep it simple:
- `src/payment/bank-client.interface.ts` — for the bank client interface and response types
- `src/payment/payment.service.ts` — main service
- `src/payment/payment.repository.ts` — repository
- `src/payment/payment.module.ts` — module

And tests:
- `test/payment.spec.ts`

Let me now write the plan.

For the txid derivation: I'll use a simple deterministic function like `sha256(orderId + effectiveDate)` truncated, or just `${orderId}:${effectiveDate}`. The key is it's deterministic and unique per order+date. I'll use a hash to make it look like a real txid.

Actually, for clarity and testability, let me define it as: `txid = crypto.createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex')`. This is deterministic.

For the state machine:
```
pending → (executePayments, bank.accepted/duplicate) → sent
pending → (executePayments, bank.transient/timeout) → in_doubt
pending → (executePayments, bank.rejected) → rejected
in_doubt → (reconcile, found in statement) → settled
in_doubt → (reconcile, proven absent past lag) → pending (attempt_count incremented on resend)
sent → (reconcile, found in statement) → settled
sent → (reconcile, NOT found past lag... hmm)
```

Wait, what if an order is `sent` (bank said accepted) but it never appears in the statement? That would be a bank issue. The spec doesn't explicitly address this. I'll assume that `sent` orders will eventually appear in the statement, and if they don't after some time, that's an operational alert (not part of this spec). The reconcile job just advances `sent` → `settled` when found, and leaves it alone otherwise.

Actually wait — re-reading the spec: "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag." This specifically calls out "failed/timed out" — not "sent but never settled". So `sent` orders are just waiting, period. Only `in_doubt` (timeout/transient error) orders get resubmitted.

Let me also clarify: when we resend, do we increment attempt_count at send time or at the point of marking as in_doubt? I think at the point of attempting to send (i.e., when we call bank.send). So:
- executePayments: for each `pending` order, increment attempt_count, call bank.send
  - If attempt_count would exceed 5 before sending → park for manual review
  - Actually, "Cap attempts at 5; after that, park for manual review" — so if attempt_count >= 5 and it's still pending/in_doubt, don't send again, park it.

Let me refine:
- executePayments processes `pending` orders
- Before sending, check: if attempt_count >= 5 → set to `parked_manual_review`, skip
- Otherwise, increment attempt_count, call bank.send
- Based on response, set status

Wait, but the first time we send, attempt_count goes from 0 to 1. If it times out, status becomes `in_doubt`. Then reconciliation proves absence, status goes back to `pending` (attempt_count stays at 1). Next time executePayments runs, it sees pending with attempt_count=1, increments to 2, sends again. If that times out, back to in_doubt. After the 5th attempt (attempt_count=5), if it's still in_doubt and proven absent, when it goes back to pending, executePayments sees attempt_count=5 >= 5, parks it.

Hmm, but the spec says "Cap attempts at 5; after that, park for manual review." So 5 attempts total. The 6th time we'd try, we park instead.

Let me define: `attempt_count` starts at 0. Each time we call bank.send, we increment it. If `attempt_count >= MAX_ATTEMPTS (5)` before the send, we park instead of sending.

So:
- attempt_count = 0 → send (becomes 1)
- ...timeout, proven absent, back to pending
- attempt_count = 1 → send (becomes 2)
- ...timeout, proven absent, back to pending
- ...
- attempt_count = 4 → send (becomes 5)
- ...timeout, proven absent, back to pending
- attempt_count = 5 → PARK (don't send)

That gives exactly 5 sends. Good.

Now let me think about the reconcile window more carefully.

`reconcile(window: { startDate: Date; endDate: Date })` — or should it be ISO strings? I'll use `Date` objects internally but the interface can take whatever. Let me use a simple type:

```typescript
interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}
```

The reconcile function:
1. For each date D in [startDate, endDate]:
   a. Call bank.getStatement(D)
   b. For each settlement in the response:
      - Find order by txid
      - If found and status is `sent` or `in_doubt`: set to `settled`, record settlement
   c. For orders with status `in_doubt` and effective_date = D:
      - If statement is complete (now > D_end + lag): set to `pending` (eligible for resend)
      - If statement is NOT complete: do nothing (wait)

Actually, I need to be more careful. The "proven absent" check should be:
- The order's effective_date D is within the window
- The statement for D has been fully published (current time > end_of_day(D) + publishing_lag)
- The order's txid is NOT in the statement for D

But what if the order's effective_date is before the window start? Then we wouldn't check it. That's fine — the window determines what we process.

Wait, but "Must be safe to run every 15 minutes, including over overlapping windows." If I run reconcile for [Mon, Tue] and then [Tue, Wed], Tuesday's orders get processed twice. The idempotency is:
- Setting to `settled` when already `settled`: no-op (WHERE status IN ('sent', 'in_doubt'))
- Setting to `pending` when already `pending`: no-op (WHERE status = 'in_doubt')
- Inserting settlement: upsert by txid

Good.

Now, one more consideration: the `settled_at` on the settlement vs the order. The settlement table records what the bank reported (including its settled_at timestamp). The order gets a `settled_at` too (or just a status change). I'll put `settled_at` on the order as well for convenience.

Let me also think about whether we need a `last_statement_date` or similar field to track which statements we've already checked. I don't think so — the idempotency comes from state checks (only process orders in `sent` or `in_doubt`).

One more thing: the spec says "Money in minor units, integers only." So `amount` is an integer representing cents (or whatever the minor unit is). I'll call it `amount_minor_units`.

Let me now write the actual PLAN.md. I need to be concise but complete.

For section 3, I need to declare all types completely. Let me think about what's needed:

```typescript
// Bank client interface
interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}

interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string; // supplier's bank account key (IBAN or similar)
}

type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

interface BankSendResponse {
  status: BankSendStatus;
  message?: string; // bank's error message, for logging
}

interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

// Service types
interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

type OrderStatus = 'pending' | 'sent' | 'in_doubt' | 'rejected' | 'settled' | 'parked_manual_review';
```

For the repository:
```typescript
interface PaymentRepository {
  findPendingOrders(limit?: number): Promise<Order[]>;
  findByTxid(txid: string): Promise<Order | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus, fields?: Partial<...>): Promise<void>;
  incrementAttemptAndSetStatus(id: string, status: OrderStatus): Promise<void>;
  upsertSettlement(settlement: Settlement): Promise<void>;
}
```

Hmm, I need to be more specific. Let me think about what the repository needs:

1. `findPendingOrders()` — get orders with status=pending, ordered by created_at
2. `findByIdAndTxid(id: string, txid: string)` — verify order identity
3. `findByTxid(txid: string)` — find order by txid (for reconciliation matching)
4. `findInDoubtByEffectiveDate(date: Date)` — for proven-absent check
5. `updateOrder(id: string, updates: Partial<OrderUpdate>)` — generic update
6. `upsertSettlement(txid: string, data: SettlementData)` — record settlement
7. `existsSettlementByTxid(txid: string)` — check if we've seen this settlement

Actually, let me simplify. The repository should expose domain-oriented queries:

```typescript
class PaymentRepository {
  findPending(limit: number): Promise<PendingOrder[]>;
  findByTxid(txid: string): Promise<OrderRecord | null>;
  findInDoubtForDate(date: Date): Promise<OrderRecord[]>;
  markSent(id: string): Promise<void>;
  markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
  markRejected(id: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markPendingForResend(id: string): Promise<void>;
  markParked(id: string): Promise<void>;
  incrementAttempt(id: string): Promise<number>; // returns new count
  upsertSettlement(data: SettlementInput): Promise<void>;
}
```

Hmm, this is getting granular. Let me think about what the service actually needs to do:

**executePayments:**
1. Get pending orders (limit maybe 100)
2. For each:
   a. If attempt_count >= 5 → park it
   b. Else: increment attempt, call bank.send
   c. Based on response: mark sent / in_doubt / rejected

**reconcile(window):**
1. For each date in window:
   a. Get statement from bank
   b. For each settlement: find order by txid, if status is sent/in_doubt → mark settled
   c. For orders in_doubt for this date: if statement complete and not in settlements → mark pending

I think I have enough to write the plan now. Let me be concise.

For the manifest, files I'll write:
- `prisma/schema.prisma`
- `src/payment/bank-client.interface.ts`
- `src/payment/payment.service.ts`
- `src/payment/payment.repository.ts`
- `src/payment/payment.module.ts`
- `test/payment.spec.ts`

Wait, should I also have `src/app.module.ts` and `src/main.ts`? The conventions list them but the task is about building a feature, not bootstrapping an app. I'll include them as they're part of the expected layout. Actually, re-reading the conventions: "Layout" shows the expected structure. I should include them.

Actually, let me re-read: "Do exactly what the task asks. Do not create a file it does not call for." The task says "Deliver schema, service, reconcile job, and tests." So:
- schema → prisma/schema.prisma
- service → src/payment/payment.service.ts (includes reconcile)
- reconcile job → could be same file or separate
- tests → test/payment.spec.ts

Plus the supporting files needed to make it work: repository, module, bank client interface. And app.module.ts to wire it up.

I'll include:
- prisma/schema.prisma
- src/payment/bank-client.interface.ts
- src/payment/payment.repository.ts
- src/payment/payment.service.ts
- src/payment/payment.module.ts
- src/app.module.ts
- test/payment.spec.ts

I'll skip main.ts since it's just a bootstrap and not really "delivered" — it's infrastructure. Actually, the conventions list it in the layout. Let me include it for completeness... No, "Do exactly what the task asks." The task says schema, service, reconcile job, and tests. I'll include the minimum needed to make those work (module, repository, interface, app.module) but skip main.ts.

Hmm, actually app.module.ts might not be needed if the task is just about the feature module. Let me include it since the conventions show it as part of the layout and it's needed to import the payment module.

Let me finalize and write the plan now. I need to be terse given the output limit.
```

## reply

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
```
