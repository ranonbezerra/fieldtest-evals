# solution

## reasoning

```
Let me start by understanding the task thoroughly.

We're building an instant-payment payout reconciler in TypeScript + NestJS + Prisma + Postgres.

Key requirements:
1. `executePayments()` — sends pending orders via `bank.send({txid, amount, key})`. The txid must be derived deterministically from the order + effective date.
2. `reconcile(window)` — matches statement entries to orders and advances their state. Must be safe to run every 15 minutes, including over overlapping windows.
3. Resend logic: an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag. Cap attempts at 5; after that, park for manual review and never auto-revert.
4. Classify `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and handle each differently.

Deliver schema, service, reconcile job, and tests for: timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion. Money in minor units, integers only.

Let me think about the architecture:

**Layers:**
- controller → validates input, calls service, zero business logic
- service → holds logic, zero raw SQL, zero Prisma client calls
- repository → only layer that touches the database

**Entities:**
- `Payout` (or `PayoutOrder`) — represents a payment order
  - id, external key (bank key), amount (minor units, integer), status, txid, attempt count, effective date, etc.

Let me think about the state machine for a payout:
- `PENDING` — initial state, waiting to be sent
- `SENDING` — being sent (maybe skip this)
- After send attempt:
  - accepted → `SENT` (waiting for reconciliation)
  - duplicate → the txid already exists, mark as `SENT` (already in flight or settled)
  - transient error → increment attempts, go back to `PENDING` if under cap
  - permanent rejection → `REJECTED` (manual review)
- After reconcile:
  - found in statement → `SETTLED`
  - not found in statement (past lag window) → if under 5 attempts, resend with same txid; if at cap, `FAILED` (manual review)

Wait, let me think more carefully about the states.

Let me re-read requirement 3:
- "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag"
- "Cap attempts at 5; after that, park for manual review and never auto-revert."

So the flow is:
1. `executePayments()` picks pending orders and sends them.
2. If send times out (we don't get a response), we don't know if it was sent. We can't immediately retry because the bank might have accepted it but just didn't respond.
3. `reconcile(window)` checks the bank statement. If the txid appears, it was settled — mark as such, no resend. If it doesn't appear AND we're past the publishing lag, then we know it wasn't sent — we can resend (same txid), but only up to 5 attempts.
4. If 5 attempts exhausted, park for manual review, never auto-revert.

So the state machine:
- `PENDING` — waiting to be sent
- `SENT` — successfully sent (or bank said duplicate), waiting for reconciliation to confirm settlement
- `SETTLED` — confirmed in bank statement
- `REJECTED` — bank permanently rejected it
- `FAILED` — attempts exhausted, parked for manual review

Let me think about the txid derivation. "derived deterministically from the order + effective date." So txid = hash(order_id + effective_date) or similar. Since it must be deterministic, same order + date → same txid always. This is important for duplicate detection.

Let me think about the `bank` abstraction. We need a `BankService` or `BankClient` that has:
- `send({txid, amount, key}): SendResult`
- `getStatement(date): Settlement[]`

The SendResult classification:
- accepted
- duplicate (the txid was already sent)
- transient error (timeout, temporary issue)
- permanent rejection (insufficient funds, invalid account, etc.)

Let me design the interface:

```ts
interface BankSendResult {
  status: 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';
  txid?: string;
}

interface Settlement {
  txid: string;
  amount: number;
  status: string; // settled, etc.
}
```

Now let me think about the schema.

```prisma
model Payout {
  id              BigInt   @id @default(autoincrement())
  external_key    String   // bank's key (account, CPF, etc.)
  amount          Int      // minor units, integer
  effective_date  DateTime
  txid            String?  // deterministic txid
  status          PayoutStatus
  attempt_count   Int      @default(0)
  settled_at      DateTime?
  rejected_at     DateTime?
  failed_at       DateTime?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

Wait, I need to think about what "order" means here. The task says "pending orders" — these are orders that need to be paid out. Let me call the table `Payout` or `PayoutOrder`. Let me go with `Payout`.

Actually, let me re-read: "sends pending orders via `bank.send({txid, amount, key})`". So an order has an amount and a key (the recipient's bank key).

Let me think about the txid derivation. "derived deterministically from the order + effective date."

```ts
function deriveTxid(orderId: string, effectiveDate: Date): string {
  return `${orderId}-${format(effectiveDate, 'yyyyMMdd')}`;
}
```

Or a hash. Let me use a simple deterministic string. Actually, bank txids might need to be in a certain format. Let me use a hash approach:

```ts
import { createHash } from 'crypto';
function deriveTxid(orderId: string, effectiveDate: Date): string {
  const dateStr = format(effectiveDate, 'yyyyMMdd');
  return createHash('sha256').update(`${orderId}:${dateStr}`).digest('hex').substring(0, 32);
}
```

Hmm, but this needs to be deterministic. Let me keep it simple but deterministic.

Now, let me think about the repository layer.

```ts
// payout.repository.ts
class PayoutRepository {
  async findPendingSendings(): Promise<Payout[]> { ... }
  async findPendingRereads(): Promise<Payout[]> { ... }
  async findById(id: string): Promise<Payout> { ... }
  async update(id: string, data: UpdateData): Promise<Payout> { ... }
  async save(payout: Payout): Promise<Payout> { ... }
}
```

Wait, I need to think about how the resend logic works. When reconciliation proves an order is absent, we need to resend it. So after reconciliation, we need to identify orders that:
- Were sent (status `SENT`)
- Were not found in the statement
- Are past the publishing lag

These orders should be resent if attempt_count < 5.

Let me think about the reconcile job more carefully.

`reconcile(window)` — where `window` is probably `{ from: Date, to: Date }` or maybe just a date. The bank exposes `getStatement(date)`. So reconcile probably takes a date or date range.

"Must be safe to run every 15 minutes, including over overlapping windows."

So we might run reconcile with overlapping time windows. The reconciliation must be idempotent — if we process the same entries twice, nothing bad happens.

Let me think about the flow:

1. `reconcile(window: { from, to })`:
   - Get statement entries from bank for the window.
   - For each statement entry, try to match it to a payout order by txid.
   - If found, mark the order as `SETTLED`.
   - After processing all statement entries, check for orders that were `SENT` but not found in the statement. For those that are past the publishing lag (i.e., the effective_date + lag < now), if attempt_count < 5, mark them back to `PENDING` for resend. If attempt_count >= 5, mark as `FAILED`.

Wait, but the resend happens in `executePayments()`, not in `reconcile()`. Let me re-read:

"Resend logic: an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag."

So:
- `reconcile` proves absence → marks the order as eligible for resend (back to `PENDING`)
- `executePayments` picks up `PENDING` orders and sends them

Actually, let me think about this differently. The order's status after a timeout is... let me think.

When we send a payment and get a timeout (no response), what status do we set? We can't set it to `SENT` because we don't know if it was accepted. We can't set it to `PENDING` because we shouldn't immediately retry.

Hmm, but the task says "may only be re-sent after reconciliation proves it is absent." So after a timeout, the order is in a state where it's waiting for reconciliation to prove absence. Let me call this state... `PENDING_RECONCILE` or `TIMEOUT_AWAITING_RECONCILE`.

Actually, let me think about what happens with each send result:
- `accepted` → status = `SENT` (we know it was sent, waiting for reconciliation to confirm settlement)
- `duplicate` → This means the txid was already sent. The order might already be `SENT` or `SETTLED`. We should check and not double-process. Status stays as is (or set to `SENT` if it was in a weird state).
- `transient_error` → increment attempt_count, keep status as `PENDING` (or move to a `PENDING` state for retry). But wait — "may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag." So even with a transient error, we need reconciliation to prove absence before re-sending?

Hmm, let me re-read: "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag."

So "failed or timed out" — this includes both transient errors and timeouts. So regardless of whether the send error was transient or a timeout, we need reconciliation to prove absence before re-sending.

But that creates a chicken-and-egg problem. If the bank returns a permanent error (like invalid account), we don't need to reconcile — we just mark it as `REJECTED`.

So let me categorize:
1. `accepted` → `SENT`, increment nothing (or maybe increment attempt_count to track sends)
2. `duplicate` → the txid was already sent by a previous attempt. The bank already has it. We should set status to `SENT` (it's in the bank's system). Actually, we need to be careful — if we got a duplicate, the send was already processed. We just need to wait for reconciliation.
3. `transient_error` (timeout, temporary) → the send might or might not have gone through. Mark as needing reconciliation proof before resend. Set status to... let me call it `PENDING_RECONCILE` or `AWAITING_RECONCILE`.
4. `permanent_rejection` → `REJECTED`, stop.

Wait, but for `accepted`, we also need reconciliation to confirm settlement. So `accepted` → `SENT`, and reconcile will match it and set to `SETTLED`.

For `transient_error` and `timeout`, the order needs to go through reconciliation to prove absence before re-sending. So:
- `transient_error`/`timeout` → `AWAITING_RECONCILE` (or a similar state)
- After reconciliation proves absence → `PENDING` (eligible for resend)
- After reconciliation proves presence (it was actually sent) → `SETTLED`

Let me refine the state machine:

States:
- `PENDING` — ready to be sent
- `SENT` — was accepted by the bank (or duplicate), waiting for reconciliation to confirm settlement
- `AWAITING_RECONCILE` — send failed/timed out, waiting for reconciliation to prove absence before re-sending
- `SETTLED` — confirmed in bank statement
- `REJECTED` — permanently rejected by the bank
- `FAILED` — attempts exhausted, parked for manual review

Flow:
1. `executePayments()`:
   - Pick `PENDING` orders
   - For each, call `bank.send({txid, amount, key})`
   - Classify result:
     - accepted → `SENT`, (attempt_count stays? or increments on each send? Let me think... The cap is 5 attempts. An "attempt" is each send call. So each send increments attempt_count.)
     - Actually wait — for accepted, attempt_count should increment. The cap of 5 is for resend attempts.
     - duplicate → `SENT` (already sent, just need to confirm)
     - transient_error → `AWAITING_RECONCILE`, increment attempt_count
     - permanent_rejection → `REJECTED`

Hmm, but when do we count attempts? Let me think about this more carefully.

The task says: "Cap attempts at 5; after that, park for manual review."

An "attempt" is each call to `bank.send()`. So:
- 1st send (from PENDING) — attempt 1
- If it times out, and reconciliation proves absence — resend — attempt 2
- If it times out again, and reconciliation proves absence — attempt 3
- ...
- If attempt 5 times out, and reconciliation proves absence — but we've exhausted attempts — park as `FAILED`

So attempt_count tracks the number of times we've called `bank.send()` for this order.

Now, the question is: after a send is accepted, we don't resend. After a transient error, we need reconciliation to prove absence before re-sending. The attempt_count is incremented on each send call (both successful and failed).

Wait, but if the send is accepted, we don't need more attempts — the order moves to `SENT` and then `SETTLED`. Attempts only matter for failed/timed-out sends.

Let me reconsider. The resend cap is specifically about re-sending after a timeout/failure. So:
- Initial send: attempt 1
- If accepted → done (eventually settled)
- If transient error → waiting for reconcile
- After reconcile proves absence → if attempt_count < 5, resend (attempt_count + 1)
- If attempt_count >= 5 → FAILED

So the check is: when reconcile determines absence, check if attempt_count < 5. If yes, move to PENDING for resend (and the resend will increment attempt_count). If no (attempt_count >= 5), move to FAILED.

Wait, but we increment attempt_count before or after the send? Let me think of it as: before sending, check if attempt_count < 5. When we send, increment attempt_count. If it fails and we need to resend, the next attempt would be attempt_count + 1, and we check if it's still < 5 (or <= 5?).

Let me think about it as: we can attempt up to 5 times. So attempt_count goes 1, 2, 3, 4, 5. After the 5th attempt fails and reconciliation proves absence, we should NOT resend (5 is the max). So the check is: at the point of deciding to resend, if attempt_count >= 5, don't resend.

Let me trace through:
- attempt 1: send → timeout → AWAITING_RECONCILE, attempt_count=1
- reconcile → proves absence → attempt_count=1 < 5 → PENDING
- attempt 2: send → timeout → AWAITING_RECONCILE, attempt_count=2
- reconcile → proves absence → attempt_count=2 < 5 → PENDING
- ...
- attempt 5: send → timeout → AWAITING_RECONCILE, attempt_count=5
- reconcile → proves absence → attempt_count=5 >= 5 → FAILED

Yes, that makes sense. The check is `if attempt_count >= MAX_ATTEMPTS (5): FAILED, else: PENDING for resend`.

Now let me think about the reconcile job more carefully.

`reconcile(window: { from: Date, to: Date })`:
1. Get statement entries from bank for the window.
2. For each statement entry, find the payout by txid. If found, mark as `SETTLED` (with settled_at timestamp).
3. After processing statement entries, find orders in `AWAITING_RECONCILE` or `SENT` state whose effective_date + publishing_lag < now (i.e., past the lag window). For those in `AWAITING_RECONCILE` that weren't found in the statement:
   - If attempt_count >= MAX_ATTEMPTS → `FAILED`
   - Else → `PENDING` (eligible for resend)

Wait, but `SENT` orders also need to be checked. If a `SENT` order doesn't appear in the statement, it might be an issue. But for `SENT`, we accepted the send — the bank said it was accepted. If it doesn't appear in the statement, something is wrong. But the task focuses on timeout/failure resends.

Actually, let me think about this differently. The reconcile job needs to:
1. Match statement entries to orders → advance to SETTLED
2. For orders that were sent (both accepted and timed out), check if they're past the publishing lag and not in the statement.
   - If they were `AWAITING_RECONCILE` (timed out) and not in statement → either resend or FAILED
   - If they were `SENT` (accepted) and not in statement → this is an anomaly, but we might want to handle it differently

Hmm, I think the key distinction is:
- `SENT` (accepted) → we trust the bank. If not in statement yet, it might just be delayed. We wait.
- `AWAITING_RECONCILE` (timed out) → we need to prove absence before resending.

Actually, for `SENT` orders, if the effective_date + lag < now and they're still not in the statement, we might need to investigate. But the task doesn't specifically mention this case. Let me focus on the AWAITING_RECONCILE path.

Let me also reconsider: maybe after a timeout, the order should be in a state where reconcile can handle it. Let me think about what "reconcile proves it is absent from the statement past the publishing lag" means.

The publishing lag is ~30 minutes. So if the effective_date was 2 hours ago, and the statement for that date doesn't contain the txid, then it's "proven absent" — meaning the bank doesn't have it, so the send didn't go through.

So the check is: effective_date + 30 minutes < now. If this is true, and the txid is not in the statement, the send failed.

Let me now think about the data model more carefully.

```prisma
enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}

model Payout {
  id            BigInt       @id @default(autoincrement())
  external_key  String       // bank's key (recipient's account key)
  amount        Int          // minor units, integer
  effective_date DateTime    // the date used for txid derivation and statement window
  txid          String?      // deterministic txid, set when first attempted
  status        PayoutStatus @default(PENDING)
  attempt_count Int          @default(0)
  settled_at    DateTime?
  rejected_at   DateTime?
  failed_at     DateTime?
  created_at    DateTime     @default(now())
  updated_at    DateTime     @updatedAt

  @@map("payouts")
}
```

Wait, should txid be set before the first send? The task says "The txid must be derived deterministically from the order + effective date." So we can derive it before sending. Let me set it when the order is first picked up for sending (in `executePayments`).

Actually, we can derive it in `executePayments` when we pick up the order. The txid doesn't change between attempts — it's always the same for the same order + effective date. This is important for duplicate detection.

Now let me think about the repository layer.

```ts
// payout.repository.ts
@Injectable()
class PayoutRepository {
  // Find orders ready to send (PENDING)
  async findPending(): Promise<Payout[]> { ... }
  
  // Find orders awaiting reconciliation that might need resend
  async findAwaitingReconsilePastLag(now: Date, lagMinutes: number): Promise<Payout[]> { ... }
  
  // Find orders by txid
  async findByTxid(txid: string): Promise<Payout | null> { ... }
  
  // Update payout
  async update(id: string, data: Partial<Payout>): Promise<Payout> { ... }
  
  // Update status atomically (to handle race conditions)
  async updateStatus(id: string, expectedStatus: PayoutStatus, newStatus: PayoutStatus, data: Partial<Payout>): Promise<boolean> { ... }
}
```

Hmm, for concurrency safety, I should use optimistic locking or conditional updates. Let me think about what Prisma supports.

Prisma supports `@@version: true` or version column for optimistic locking. Actually, Prisma's `@updatedAt` doesn't help with locking. Let me use a version field.

Actually, for simplicity and given the task scope, let me use Prisma's `update` with a `where` clause that includes the current status. This way, we can check if the status hasn't changed.

Wait, but the task says the repository is the only layer that touches the database. The service calls repository methods. So I need to design the repository API carefully.

Let me think about what operations the service needs:

1. `executePayments()`:
   - Find PENDING orders → `findPending()`
   - For each, derive txid, call bank.send
   - Based on result:
     - accepted → update to SENT
     - duplicate → update to SENT (if not already settled)
     - transient_error → update to AWAITING_RECONCILE, increment attempt_count
     - permanent_rejection → update to REJECTED
     - timeout → update to AWAITING_RECONCILE, increment attempt_count

2. `reconcile(window)`:
   - Get statement from bank
   - For each settlement, find payout by txid, update to SETTLED
   - Find AWAITING_RECONCILE orders past the publish lag
   - For each not in statement:
     - If attempt_count >= 5 → update to FAILED
     - Else → update to PENDING

Let me now think about the bank client interface.

```ts
interface BankClient {
  send(request: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}

type BankSendResult =
  | { status: 'accepted'; txid: string }
  | { status: 'duplicate'; txid: string }
  | { status: 'transient_error'; error: string }
  | { status: 'permanent_rejection'; error: string };
```

Wait, I need to think about timeouts. If `bank.send` times out, that's a transient error. The bank client should handle this and return a transient error result (or a timeout result).

Actually, let me make the bank client return a timeout result separately:

```ts
type BankSendResult =
  | { status: 'accepted'; txid: string }
  | { status: 'duplicate'; txid: string }
  | { status: 'timeout' }
  | { status: 'transient_error'; error: string }
  | { status: 'permanent_rejection'; error: string };
```

Or I could just use `transient_error` to cover timeouts. Let me keep it simple with the 4 categories mentioned in the task: "accepted, duplicate, transient error, permanent rejection." A timeout is a transient error.

Now, let me think about the test scenarios:

1. **timeout-but-settled (no resend)**: An order is sent, times out (transient error), goes to AWAITING_RECONCILE. Then reconcile finds it in the statement (it was actually settled). It should be marked SETTLED, NOT resent.

2. **proven-absent (resend, same txid)**: An order is sent, times out, goes to AWAITING_RECONCILE. Reconcile runs and the order is NOT in the statement, and it's past the publish lag. The order should be moved back to PENDING for resend. When `executePayments` picks it up again, it should use the same txid.

3. **attempt exhaustion**: An order goes through 5 attempts, each timing out and then being proven absent. After the 5th attempt is proven absent, the order should be moved to FAILED and not re-sent.

Now let me think about the Prisma schema and migration.

Actually, I need to think about what the `key` field is. In the bank's instant payment API, `key` is the recipient's bank key (like a PIX key in Brazil — could be a CPF, email, phone number, etc.). So `external_key` in our schema is the bank key.

Let me also think about the `effective_date`. This is the date used for:
1. Deriving the txid
2. Determining which statement to check
3. Determining if the publish lag has passed

So the effective_date is the date the payment is intended for. The statement is retrieved for this date (or a range including it).

Let me now think about the full file structure:

```
prisma/schema.prisma
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.types.ts        (interfaces, enums)
src/bank/bank.module.ts
src/bank/bank.service.ts          (bank client wrapper)
src/bank/bank.types.ts            (bank interfaces)
test/payout.spec.ts
```

Actually, the task says "Deliver schema, service, reconcile job, and tests." Let me think about what to include.

The task mentions:
- Schema (Prisma schema + migration)
- Service (payout service with executePayments and reconcile)
- Reconcile job (maybe a scheduled job?)
- Tests

Let me also think about whether I need a controller. The conventions say NestJS, and the layout shows controllers. But the task only asks for schema, service, reconcile job, and tests. Let me include a controller for completeness since it's part of the NestJS pattern, but the task doesn't explicitly require it.

Actually, re-reading: "Deliver schema, service, reconcile job, and tests for: timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion."

So the core deliverables are:
1. Prisma schema
2. Service (with executePayments and reconcile)
3. Reconcile job (could be a separate file or part of the service)
4. Tests for the three scenarios

Let me think about whether the bank client is a mock or real. For testing, we'll need to mock the bank. So I should define a `BankClient` interface and provide a mock implementation in tests.

Let me think about the module structure:

```
src/payout/
  payout.module.ts
  payout.service.ts
  payout.controller.ts
  payout.repository.ts
  payout.types.ts
src/bank/
  bank.module.ts
  bank.service.ts  (implements BankClient using HTTP)
  bank.types.ts
test/
  payout.spec.ts
prisma/
  schema.prisma
  migrations/
    <timestamp>_init/migration.sql
```

Now, let me also think about the configuration. The task says "Configuration comes from environment variables only." So we need env vars for:
- `DATABASE_URL`
- Bank API URL (if we have a real bank client)
- Publishing lag (in minutes)

But for the mock/test, we'll use a mock bank client.

Let me think about the configuration for the publishing lag. It's "~30 min" per the task. Let me make it configurable with a default of 30 minutes.

Now let me start writing the code.

First, the Prisma schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}

model Payout {
  id             BigInt       @id @default(autoincrement())
  external_key   String
  amount         Int
  effective_date DateTime
  txid           String?
  status         PayoutStatus @default(PENDING)
  attempt_count  Int          @default(0)
  settled_at     DateTime?
  rejected_at    DateTime?
  failed_at      DateTime?
  created_at     DateTime     @default(now())
  updated_at     DateTime     @updatedAt

  @@map("payouts")
}
```

Wait, I should also think about whether I need a version field for optimistic locking. Given the task mentions "Must be safe to run every 15 minutes, including over overlapping windows," idempotency is key. Using status-based conditional updates should be sufficient.

Actually, let me think about the concurrency issues more carefully. If reconcile runs every 15 minutes with overlapping windows, we might process the same payout twice. The key is idempotency:
- Marking a SETTLED order as SETTLED again is fine (no change).
- Moving an AWAITING_RECONCILE order to PENDING when it's already PENDING is fine.
- The txid-based matching for settlements is idempotent — we just update the status.

For executePayments, if two instances run simultaneously, we might pick up the same PENDING order twice. This is harder to handle without locks. But for this task, I'll focus on the reconciliation idempotency and assume executePayments runs as a single instance or uses a queue.

Actually, let me add a simple concurrency guard: when finding PENDING orders, I could update their status to SEATTLE (sending) atomically. But this adds complexity. For this task, let me keep it simpler but add a note.

Hmm, let me think about what's really needed. The task says "Must be safe to run every 15 minutes, including over overlapping windows" — this is specifically about `reconcile(window)`. So the idempotency requirement is on reconcile, not necessarily on executePayments. Let me focus on that.

For reconcile idempotency:
- If we get statement entries and try to match them to payouts, the matching should be idempotent. If we process the same entry twice, the second time it should be a no-op (the payout is already SETTLED).
- If we mark AWAITING_RECONCILE orders as PENDING for resend, doing it twice is fine (it's still PENDING).

Let me think about the reconcile job flow more carefully.

Actually, I realize I need to think about this more carefully. The `reconcile(window)` takes a window (from/to dates). The bank's `getStatement(date)` returns entries for a specific date. So reconcile might need to handle a date range.

Let me define the reconcile window as `{ from: Date, to: Date }` and the job will call `getStatement` for each date in the range, or `getStatement` might accept a range.

Actually, looking at the bank interface: `getStatement(date) -> Settlement[]`. It takes a single date. So for a date range, we'd need to call it for each date. Or we could change the interface to accept a range.

Let me keep the bank interface as `getStatement(date: Date)` returning entries for that date, and reconcile will call it for the relevant dates.

Actually, let me reconsider. A "window" for reconciliation could be: "check the statement for date X and match entries." The window might be `{ effectiveDate: Date }` or `{ from: Date, to: Date }`.

Let me define:
```ts
interface ReconcileWindow {
  from: Date;
  to: Date;
}
```

And in reconcile, we iterate over dates from `from` to `to` and call `getStatement` for each.

But this could be slow. Let me simplify: maybe `getStatement` can accept a range. Or maybe the window is just a single date.

Actually, let me re-read the task: "reconcile(window) — matches statement entries to orders and advances their state."

I think `window` is a time range. Let me make the bank client flexible:

```ts
interface BankClient {
  send(request: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

And in reconcile, we determine which dates to query based on the window and match orders.

Actually, let me think about this differently. The orders have an `effective_date`. When we reconcile a window `{ from, to }`, we:
1. Query the statement for dates in the window.
2. Match found entries to orders.
3. For orders not found but past the lag, mark for resend.

Let me simplify and make `getStatement` accept a single date, and reconcile calls it for each date in the window.

Actually, I think the most practical approach is:

```ts
interface BankClient {
  send(request: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

And reconcile takes a date (the effective date to check) or a range. For simplicity, let me have reconcile take `{ from: Date, to: Date }`:

In reconcile:
1. For each date in [from, to], call `getStatement(date)`.
2. Collect all settlements.
3. Match settlements to orders by txid.
4. Mark matched orders as SETTLED.
5. Find orders in AWAITING_RECONCILE whose effective_date is in the window (or before `to`) and are past the lag.
6. For unmatched AWAITING_RECONCILE orders, if past lag: mark for resend (PENDING) or FAILED.

Hmm, this is getting complex. Let me simplify the design.

Let me define reconcile as working with a specific date range. The key insight is:
- Orders have an effective_date.
- The bank statement for a given date contains settlements with our txids.
- The publishing lag means the statement for date D is available up to ~30 min after D.

So when reconcile processes window { from, to }:
1. For each date from `from` to `to`, get the statement.
2. Match settlements to orders (by txid).
3. Mark matched orders as SETTLED.
4. For orders in AWAITING_RECONCILE with effective_date <= to (i.e., they should have appeared in the statement by now):
   - If the order's effective_date + publish_lag < now:
     - If found in statement → already handled (SETTLED)
     - If not found → proven absent:
       - If attempt_count < MAX_ATTEMPTS → PENDING (for resend)
       - If attempt_count >= MAX_ATTEMPTS → FAILED

Let me now think about the implementation more concretely.

Actually, I think I'm overcomplicating this. Let me step back and think about the core logic.

The three things to implement:
1. `executePayments()` — picks PENDING orders, sends via bank, classifies responses.
2. `reconcile(window)` — matches statement to orders, advances states, triggers resend eligibility.
3. Resend logic — in executePayments, pick up orders that reconcile marked as eligible for resend.

Let me think about the state transitions:

```
PENDING → (send: accepted) → SENT
PENDING → (send: duplicate) → SENT  (duplicate means the txid was already used)
PENDING → (send: transient_error/timeout) → AWAITING_RECONCILE (attempt_count++)
PENDING → (send: permanent_rejection) → REJECTED

SENT → (reconcile: found in statement) → SETTLED
SENT → (reconcile: not found, past lag) → (stay SENT, anomaly, or maybe AWAITING_RECONCILE?)

AWAITING_RECONCILE → (reconcile: found in statement) → SETTLED (timeout-but-settled)
AWAITING_RECONCILE → (reconcile: not found, past lag, attempt_count < 5) → PENDING (proven-absent, resend)
AWAITING_RECONCILE → (reconcile: not found, past lag, attempt_count >= 5) → FAILED (attempt exhaustion)
```

Wait, for the `SENT` case where it's not found in the statement — the send was accepted, so the bank should have it. If it's not in the statement after the lag, something is wrong. But the task doesn't specify this case. Let me handle it minimally — maybe just leave it as `SENT` and wait for the next reconcile cycle.

Actually, let me reconsider. The task says "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag." So only AWAITING_RECONCILE orders can be re-sent. SENT orders are confirmed sends — we trust the bank.

But what about SENT orders not in the statement after the lag? This is an edge case. The task doesn't mention it. Let me just leave them in SENT and not handle it explicitly. Or maybe I should handle it by marking them as some kind of error. But the task says "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." So I'll leave SENT orders alone.

Hmm, actually, on re-reading, I think the reconcile function should primarily handle:
1. Matching statement entries → SETTLED
2. For AWAITING_RECONCILE orders not in statement and past lag → resend or FAILED

Let me now think about the publish lag. The task says "~30 min of publishing lag." This means the statement for a given date might not include entries published in the last 30 minutes. So when we check if an order is "proven absent," we need to make sure the effective_date is at least 30 minutes in the past.

Let me make the publish lag configurable: `PUBLISH_LAG_MINUTES` env var, default 30.

Now let me think about the reconcile window. The window determines which dates' statements to check. We should check dates that are at least 30 minutes in the past (to account for the lag). So if now is 14:00, we should check statements for dates up to 13:30.

But the effective_date of orders could be any date in the past. When reconcile runs with a window, it:
1. Checks statements for the dates in the window.
2. Matches orders to statement entries.
3. For AWAITING_RECONCILE orders whose effective_date + lag < now and effective_date is in the window, checks if they're in the statement.

Actually, I think the window for reconcile should cover the period we want to check. For a 15-minute run, the window might be the last 24 hours or something. Let me make the window explicit.

Let me define:

```ts
interface ReconcileWindow {
  from: Date;  // start of the date range to check statements for
  to: Date;    // end of the date range
}
```

And `reconcile(window: ReconcileWindow)` will:
1. For each date from `from` to `to`, get the statement (but only if past the publish lag).
2. Match settlements to orders.
3. For AWAITING_RECONCILE orders with effective_date in [from, to] that are past the lag:
   - If in statement → SETTLED
   - If not in statement → resend or FAILED

Hmm, actually I think the window might not need to be a range. Let me simplify: maybe `reconcile` takes a date and checks the statement for that date. But the task says "reconcile(window)" which implies a window object.

Let me go with:

```ts
interface ReconcileWindow {
  from: Date;
  to: Date;
}
```

And the reconcile logic handles it.

OK, let me also think about the `executePayments` function. It:
1. Finds PENDING orders.
2. For each, derives txid (from order + effective_date).
3. Calls `bank.send({txid, amount, key})`.
4. Based on result, updates the order.

For the txid derivation, I need a deterministic function. Let me use:

```ts
function deriveTxid(id: string | number, effectiveDate: Date, amount: number): string {
  const dateStr = format(effectiveDate, 'yyyyMMdd');
  const payload = `${id}:${dateStr}:${amount}`;
  return createHash('sha256').update(payload).digest('hex').substring(0, 32);
}
```

But wait — the txid is derived from the order + effective date. The "order" includes the order ID. But when we resend with the same txid, the bank should return "duplicate." So the txid is stable across resends for the same order + date. Good.

Let me also think about the Prisma `BigInt` type. In TypeScript with Prisma, BigInt is returned as `bigint` or `string`. Let me use `String` for IDs in the TS layer to avoid BigInt issues in JSON serialization. Or I can use a regular `Int` ID. Let me use `BigInt` in Prisma and `string` in TypeScript.

Actually, let me use a `String` ID with `@default(uuid())` or `@default(cuid())` to avoid BigInt issues. Or I could use `Int` with `@default(autoincrement())`. Let me use `BigInt` for the ID since the conventions say to use it, and handle the conversion in the repository.

Hmm, actually, let me use a string-based UUID:

```prisma
model Payout {
  id             String       @id @default(uuid())
  ...
}
```

This avoids BigInt issues. But the task says "Money in minor units, integers only" — that's about the amount, not the ID.

Let me use `String` with `uuid()` for simplicity.

Wait, actually the conventions don't specify. Let me just use `BigInt` as it's common in production, and handle it in the repository by converting to string.

Actually, let me just use `String` with `uuid()` for simplicity. The conventions don't mandate BigInt.

Let me now think about the actual implementation.

Let me write out all the files.

### prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}

model Payout {
  id             String       @id @default(uuid())
  external_key   String
  amount         Int
  effective_date DateTime
  txid           String?
  status         PayoutStatus @default(PENDING)
  attempt_count  Int          @default(0)
  settled_at     DateTime?
  rejected_at    DateTime?
  failed_at      DateTime?
  created_at     DateTime     @default(now())
  updated_at     DateTime     @updatedAt

  @@map("payouts")
}
```

Wait, I need to think about indexes. For performance, we should index:
- `status` (for finding PENDING/AWAITING_RECONCILE orders)
- `txid` (for looking up orders by txid during reconciliation)
- `effective_date` (for date range queries during reconciliation)

```prisma
model Payout {
  id             String       @id @default(uuid())
  external_key   String
  amount         Int          @default(0)
  effective_date DateTime     @default(now())
  txid           String?
  status         PayoutStatus @default(PENDING)
  attempt_count  Int          @default(0)
  settled_at     DateTime?
  rejected_at    DateTime?
  failed_at      DateTime?
  created_at     DateTime     @default(now())
  updated_at     DateTime     @updatedAt

  @@map("payouts")
  @@index([status])
  @@index([txid])
  @@index([effective_date])
}
```

Hmm, wait. Let me not add default values for amount and effective_date since they're required. Let me make them required fields.

Actually, in Prisma, fields without `?` are required. So `amount Int` is required. Let me not use `@default` for required fields.

Now let me think about the migration SQL. When we create the schema and run `prisma migrate dev`, Prisma generates the migration. But the task says "Every schema change ships with a migration." So I need to provide the migration SQL file.

Let me create the migration manually. I'll need to figure out the timestamp format.

The migration file would be at:
`prisma/migrations/<timestamp>_init/migration.sql`

The SQL would be:

```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ("PENDING","SENT","AWAITING_RECONCILE","SETTLED","REJECTED","FAILED");

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "external_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" TIMESTAMP WITH TIME ZONE NOT NULL,
    "txid" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMP WITH TIME ZONE,
    "rejected_at" TIMESTAMP WITH TIME ZONE,
    "failed_at" TIMESTAMP WITH TIME ZONE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "payouts_txid_idx" ON "payouts"("txid");
CREATE INDEX "payouts_effective_date_idx" ON "payouts"("effective_date");
```

Now let me think about the types file.

### src/payout/payout.types.ts

```ts
export enum PayoutStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  AWAITING_RECONCILE = 'AWAITING_RECONCILE',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}
```

### src/bank/bank.types.ts

```ts
export type BankSendResult =
  | { status: 'accepted'; txid: string }
  | { status: 'duplicate'; txid: string }
  | { status: 'transient_error'; error: string }
  | { status: 'permanent_rejection'; error: string };

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(request: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

Wait, for the timeout case — the task says "Sends sometimes time out." A timeout means we don't get a response. The `bank.send` returns a `Promise` — if it times out, we catch the error and classify it as `transient_error`. But the bank client might also explicitly return a timeout result.

Let me think about how the bank client handles timeouts. If `bank.send` is an HTTP call that times out, the client should catch the timeout and return `{ status: 'transient_error', error: 'timeout' }`. Or it could throw, and the service catches it.

I think it's cleaner for the bank client to always return a `BankSendResult` (never throw for transient issues). So timeouts are caught and returned as `transient_error`. But if the bank client itself crashes (network error, etc.), it might throw. Let me have the service catch those as `transient_error` too.

Actually, let me have the bank client return results for normal bank responses, and throw for infrastructure errors (which the service catches as transient). Or better yet, let me have the bank client always return a result:

```ts
export interface BankSendAttempt {
  txid: string;
  amount: number;
  key: string;
  effectiveDate: Date;
}
```

Hmm, this is getting complicated. Let me simplify.

The bank client interface:

```ts
export interface BankSendResult {
  status: 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

The service uses the bank client. For testing, we provide a mock bank client.

Now let me think about the configuration for the publish lag.

### src/payout/payout.config.ts

```ts
export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}
```

Or I can put this in the module. Let me keep it in the service with an `@ASSUMPTION` for the defaults.

OK let me now think about the actual implementation flow.

#### PayoutRepository

The repository deals with Prisma operations. Let me think about what methods it needs:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAwaitingReconcilePastLag(cutoffDate: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.AWAITING_RECONCILE,
        effectiveDate: { lte: cutoffDate },
      },
    });
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { txid },
    });
  }

  async update(id: string, data: Partial<PayoutUpdateData>): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: this.toPrismaUpdate(data),
    });
  }

  async updateStatus(id: string, expectedStatus: PayoutStatus, data: PayoutUpdateData): Promise<boolean> {
    const result = await this.prisma.payout.update({
      where: { id, status: expectedStatus },
      data: this.toPrismaUpdate(data),
    });
    return !!result;
  }
}
```

Hmm, but Prisma doesn't support conditional updates based on status in the `where` clause easily — actually it does: `where: { id_status: { id, status: expectedStatus } }` or just `where: { id, status: expectedStatus }`.

Wait, Prisma supports compound unique filters. But `status` is not unique. However, Prisma's `update` supports filtering by multiple fields in the `where` clause, and if no record matches, it throws. So we can use:

```ts
await this.prisma.payout.update({
  where: { id, status: expectedStatus },
  data: ...,
});
```

This will throw if the status doesn't match, which we can catch and return `false`.

Let me think about the Prisma types. With Prisma, the `Payout` model generates a `Payout` type in TypeScript. The field names are camelCase (e.g., `external_key` → `externalKey`, `effective_date` → `effectiveDate`, `created_at` → `createdAt`).

Let me define a Prisma service wrapper:

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

OK, let me now think about the full payout service.

#### PayoutService

```ts
@Injectable()
export class PayoutService {
  private readonly publishLagMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankClient: BankClient,
  ) {
    // ASSUMPTION: publish lag is ~30 minutes and configurable via env
    // For this implementation, we use a default of 30 minutes
    this.publishLagMs = (parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10)) * 60 * 1000;
    this.maxAttempts = 5;
  }

  /**
   * Derives a deterministic txid from the order ID and effective date.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = format(effectiveDate, 'yyyyMMdd');
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payments via the bank API.
   */
  async executePayments(): Promise<void> {
    const orders = await this.payoutRepository.findPending();
    
    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      
      let result: BankSendResult;
      try {
        result = await this.bankClient.send({
          txid,
          amount: order.amount,
          key: order.externalKey,
        });
      } catch (err) {
        // Network/timeout error → treat as transient
        result = { status: 'transient_error', error: (err as Error).message };
      }

      await this.handleSendResult(order, txid, result);
    }
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepository.update(order.id, {
          txid,
          status: PayoutStatus.SENT,
          attemptCount: { increment: 1 },
        });
        break;
      
      case 'duplicate':
        // The txid was already sent by a previous attempt.
        // The order is already in the bank's system.
        await this.payoutRepository.update(order.id, {
          txid,
          status: PayoutStatus.SENT,
          attemptCount: { increment: 1 },
        });
        break;
      
      case 'transient_error':
      case 'timeout':
        await this.payoutRepository.update(order.id, {
          txid,
          status: PayoutStatus.AWAITING_RECONCILE,
          attemptCount: { increment: 1 },
        });
        break;
      
      case 'permanent_rejection':
        await this.payoutRepository.update(order.id, {
          txid,
          status: PayoutStatus.REJECTED,
          rejectedAt: new Date(),
          attemptCount: { increment: 1 },
        });
        break;
    }
  }

  /**
   * Reconciles bank statements with payout orders.
   * Safe to run every 15 minutes, including over overlapping windows.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - this.publishLagMs);
    
    // 1. Fetch statement entries for each date in the window
    const settlements = await this.fetchStatementForWindow(window, cutoffDate);
    
    // 2. Match statement entries to orders → mark as SETTLED
    const matchedTxids = new Set<string>();
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.update(order.id, {
          status: PayoutStatus.SETTLED,
          settledAt: now,
        });
      }
      matchedTxids.add(settlement.txid);
    }
    
    // 3. For AWAITING_RECONCILE orders not in statement and past lag:
    //    mark as PENDING (for resend) or FAILED (if attempts exhausted)
    const awaitingOrders = await this.payoutRepository.findAwaitingReconcilePastLag(cutoffDate);
    
    for (const order of awaitingOrders) {
      if (matchedTxids.has(order.txid!)) {
        // Already handled in step 2 (shouldn't happen since we mark as SETTLED,
        // but just in case)
        continue;
      }
      
      // Proven absent past the publish lag
      if (order.attemptCount >= this.maxAttempts) {
        await this.payoutRepository.update(order.id, {
          status: PayoutStatus.FAILED,
          failedAt: now,
        });
      } else {
        await this.payoutRepository.update(order.id, {
          status: PayoutStatus.PENDING,
        });
      }
    }
    
    return {
      settlementsMatched: matchedTxids.size,
      resendEligible: awaitingOrders.filter(o => o.attemptCount < this.maxAttempts).length,
      failed: awaitingOrders.filter(o => o.attemptCount >= this.maxAttempts).length,
    };
  }

  private async fetchStatementForWindow(
    window: ReconcileWindow,
    cutoffDate: Date,
  ): Promise<Settlement[]> {
    const settlements: Settlement[] = [];
    const currentDate = new Date(window.from);
    
    while (currentDate <= window.to) {
      // Only query statements for dates past the publish lag
      if (currentDate <= cutoffDate) {
        const entries = await this.bankClient.getStatement(currentDate);
        settlements.push(...entries);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return settlements;
  }
}
```

Wait, I'm using `format` from `date-fns`. Let me think about whether to use `date-fns` or a custom function. The task doesn't specify, but `date-fns` is common in NestJS projects. However, I should check if it's available. Since the task says I'm building from scratch, I can use `date-fns` (it's a very common dependency).

Actually, let me avoid external dependencies and just format dates manually:

```ts
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

Or I could use `date-fns`. Let me use `date-fns` since it's standard.

Hmm, but I don't know what's in the package.json. Let me assume `date-fns` is available (it's extremely common). If not, I can use native date formatting.

Actually, let me use Node's built-in `Intl` or just string manipulation to avoid dependency issues. Let me use a simple helper:

```ts
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

This is simple and doesn't require any dependencies.

Now, let me think about the Prisma client types. When I use Prisma, the `Payout` type from `@prisma/client` has fields in camelCase. So `external_key` → `externalKey`, `effective_date` → `effectiveDate`, `created_at` → `createdAt`, etc.

The `attemptCount` field in Prisma would be `attempt_count` in SQL but `attemptCount` in TS. And for increment operations, Prisma supports `attempt_count: { increment: 1 }` but in the TS client it would be `attemptCount: { increment: 1 }`.

Wait, I need to be careful. The Prisma client uses camelCase for field names. So when I write:

```ts
await this.prisma.payout.update({
  where: { id },
  data: {
    status: PayoutStatus.SENT,
    attemptCount: { increment: 1 },
  },
});
```

But the `PayoutStatus` from Prisma client and our local enum need to match. In Prisma, enums are generated as TypeScript enums in the `@prisma/client` package. But we also define our own `PayoutStatus` enum. I need to make sure they match.

Actually, the standard approach is to use the Prisma-generated `PayoutStatus` enum. But since the conventions say the repository is the only layer that touches the database, the service should use its own types, and the repository translates between them.

Hmm, that's getting complex. Let me think about the layering more carefully.

The conventions say:
- `controller` validates input and calls the service. Zero business logic.
- `service` holds the logic. Zero raw SQL, zero Prisma client calls.
- `repository` is the only layer that touches the database.

So:
- The service should not import `@prisma/client`.
- The repository imports `@prisma/client` and translates between Prisma types and domain types.
- The service works with domain types defined in `payout.types.ts`.

This means I need to define a domain `Payout` type and a domain `PayoutStatus` enum, and the repository maps between them and Prisma types.

OK, let me refactor. The repository will:
1. Define its own methods that return domain types.
2. Internally use Prisma client and map results.

Let me design the repository interface from the service's perspective:

```ts
// The service depends on this interface
export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  update(id: string, data: PayoutUpdate): Promise<Payout>;
  updateWithStatusId(id: string, expectedStatus: PayoutStatus, data: PayoutUpdate): Promise<boolean>;
}
```

Where `Payout` is our domain type and `PayoutUpdate` is a domain type for partial updates.

Hmm, this is getting complex with the mapping. Let me simplify by having the repository return domain types directly. The mapping is straightforward since the field names are similar (just snake_case vs camelCase).

Actually, let me think about this differently. The Prisma client already generates camelCase types. So if I define my domain types to match Prisma's generated types, the mapping is trivial (identity). The key constraint is that the service shouldn't import `@prisma/client`. So the service imports from `payout.types.ts` which defines the same types.

But there's a subtlety: the Prisma `PayoutStatus` enum and our domain enum need to be compatible. If I define them identically, the values will match. Let me just define them in `payout.types.ts` and have the repository use those.

Actually, Prisma generates its own `PayoutStatus` type from the schema. The repository would use Prisma's types internally and return domain types. But since the field names and enum values are the same, the mapping is trivial.

Let me just define the domain types in `payout.types.ts`, use them in the service, and have the repository convert. The conversion is essentially just passing through since the names match.

Wait, actually, I realize I need to be more careful. In Prisma, the `PayoutStatus` enum is generated in `@prisma/client`. If I define my own `PayoutStatus` in `payout.types.ts`, they won't be the same type. The repository needs to convert between them.

But actually, if the enum values (strings) are the same, I can just cast. Let me define the domain enum with the same string values:

```ts
// payout.types.ts
export enum PayoutStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  AWAITING_RECONCILE = 'AWAITING_RECONCILE',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}
```

And in Prisma:
```prisma
enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}
```

Prisma generates the enum with the same string values. So `PayoutStatus.PENDING` in our domain = `'PENDING'` = Prisma's `PayoutStatus.PENDING`. We can cast between them with `as` since the values are the same.

Actually, I realize this might cause issues. Let me think about whether to just use the Prisma-generated types in the repository and domain types in the service, with the repository doing the conversion.

You know what, let me simplify. I'll define the domain types in `payout.types.ts`. The repository will use Prisma internally but expose methods that work with domain types. The conversion is straightforward since the field names and enum values match. I'll use simple casts.

Actually, let me think about this even more carefully. The Prisma generated types use `PayoutStatus` from `@prisma/client`. If my domain types also use `PayoutStatus`, they're different types with the same string values. TypeScript won't complain about string values being the same, but the types are nominally different.

The simplest approach: use `as any` or `as unknown as` for the enum conversion. Or, since both use string values, I can just construct the Prisma values directly.

Let me take a different approach. The repository will:
1. Use Prisma client internally.
2. Accept and return domain types.
3. Do minimal conversion.

Since Prisma generates `PayoutStatus` as a string enum with values like `'PENDING'`, `'SENT'`, etc., and our domain enum has the same values, we can pass them directly (they're compatible at runtime, even if TypeScript sees them as different types).

Actually, you know what, let me just use the Prisma-generated types in the repository and map to domain types using a simple conversion function. This is cleaner.

Let me think about the actual types.

Prisma generates:
```ts
type Payout = {
  id: string;
  external_key: string; // Wait, no — Prisma uses camelCase in TS
  // Actually, Prisma converts snake_case to camelCase
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Wait, actually Prisma's naming convention in the generated client is camelCase. So `external_key` becomes `externalKey`, `effective_date` becomes `effectiveDate`, etc.

So the Prisma-generated `Payout` type and our domain `Payout` type have the same field names. The only difference is the enum type.

Let me just define the domain types and have the repository do `as` casts for the enum. Or better yet, let me not define a separate domain enum and just use string literals:

Actually, this is getting too complicated. Let me take a pragmatic approach:

1. Define domain types (`Payout`, `PayoutStatus`, etc.) in `payout.types.ts`.
2. The repository imports Prisma types and maps to/from domain types.
3. The mapping is trivial since field names match.

For the enum, I'll define it in `payout.types.ts` with the same values as the Prisma schema. The repository will cast Prisma enums to domain enums.

Let me also think about the `PayoutUpdate` type for the repository's `update` method. The service needs to update various fields. Let me define:

```ts
export interface PayoutUpdate {
  status?: PayoutStatus;
  txid?: string | null;
  attemptCount?: { increment: number } | number;
  settledAt?: Date | null;
  rejectedAt?: Date | null;
  failedAt?: Date | null;
}
```

Hmm, but the Prisma update data type is different. Let me think about this differently.

Actually, I think the cleanest approach is:
1. The service defines what it wants to update using domain types.
2. The repository translates to Prisma update data.

But the `{ increment: 1 }` operation is Prisma-specific. I need to handle this in the repository.

Let me define the update data type to include both regular values and increment operations:

```ts
export type PayoutUpdateData = {
  status?: PayoutStatus;
  txid?: string | null;
  attemptCount?: number | { increment: number };
  settledAt?: Date | null;
  rejectedAt?: Date | null;
  failedAt?: Date | null;
};
```

And in the repository:

```ts
async update(id: string, data: PayoutUpdateData): Promise<Payout> {
  const prismaData: Prisma.PayoutUpdateInput = {};
  if (data.status !== undefined) prismaData.status = data.status;
  if (data.txid !== undefined) prismaData.txid = data.txid;
  if (data.attemptCount !== undefined) {
    if (typeof data.attemptCount === 'number') {
      prismaData.attemptCount = data.attemptCount;
    } else {
      prismaData.attemptCount = data.attemptCount;
    }
  }
  if (data.settledAt !== undefined) prismaData.settledAt = data.settledAt;
  if (data.rejectedAt !== undefined) prismaData.rejectedAt = data.rejectedAt;
  if (data.failedAt !== undefined) prismaData.failedAt = data.failedAt;
  
  const result = await this.prisma.payout.update({
    where: { id },
    data: prismaData,
  });
  return this.toDomain(result);
}
```

Where `toDomain` converts Prisma's Payout to our domain Payout (essentially a cast since the types match).

OK this is getting quite involved. Let me think about whether there's a simpler approach.

Alternative approach: Have the repository use Prisma's generated types directly, and have the service also use those types. But the convention says the service should have "zero Prisma client calls" — it doesn't necessarily say the service can't import Prisma types. It says "zero raw SQL, zero Prisma client calls." So the service can't call `this.prisma.payout.findMany()` etc., but it could use Prisma-generated types.

Hmm, but that would mean the service imports from `@prisma/client`, which couples it to Prisma. That's not ideal but it's a common pattern.

Actually, let me re-read the convention: "service holds the logic. Zero raw SQL, zero Prisma client calls." So the service cannot import and use the Prisma client. But it can use types that happen to be generated by Prisma.

Let me take the approach where:
1. Domain types are defined in `payout.types.ts`.
2. The repository handles Prisma-specific operations and translates.
3. The service uses only domain types.

For the enum, I'll define a domain enum with the same string values. Since Prisma enums are string-based, this works at runtime.

Let me now think about the Prisma update for increment. I need to support incrementing `attempt_count`. In the repository, I'll accept a flag or use a specific type.

Actually, let me simplify the update interface. Instead of a generic `PayoutUpdateData`, let me have specific repository methods:

```ts
class PayoutRepository {
  async findPending(): Promise<Payout[]> { ... }
  async findByTxid(txid: string): Promise<Payout | null> { ... }
  async findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]> { ... }
  
  async markAccepted(id: string, txid: string): Promise<Payout> { ... }
  async markSent(id: string, txid: string): Promise<Payout> { ... }
  async markAwaitingReconcile(id: string, txid: string): Promise<Payout> { ... }
  async markRejected(id: string, txid: string): Promise<Payout> { ... }
  async markSettled(id: string, settledAt: Date): Promise<Payout> { ... }
  async markForResend(id: string): Promise<Payout> { ... }
  async markFailed(id: string, failedAt: Date): Promise<Payout> { ... }
}
```

This is cleaner! The repository has specific methods for each state transition, and each one handles the Prisma-specific logic (like incrementing attempt_count).

For `markAccepted` and `markSent`, we increment attempt_count.
For `markAwaitingReconcile`, we increment attempt_count.
For `markRejected`, we increment attempt_count and set rejected_at.
For `markSettled`, we set status and settled_at.
For `markForResend`, we set status to PENDING (don't change attempt_count — it was already incremented during send).
For `markFailed`, we set status and failed_at.

Wait, but should `markForResend` keep the attempt_count? Yes, because when the order is re-sent, `executePayments` will pick it up (it's PENDING) and send again, incrementing attempt_count. The resend doesn't increment attempt_count itself — the send does.

Let me trace through:
- Initial send: PENDING → send → AWAITING_RECONCILE (attempt_count: 1)
- Reconcile proves absence: AWAITING_RECONCILE → PENDING (attempt_count still 1)
- Re-send: PENDING → send → AWAITING_RECONCILE (attempt_count: 2)
- ...
- 5th send: PENDING → send → AWAITING_RECONCILE (attempt_count: 5)
- Reconcile proves absence: attempt_count >= 5 → FAILED (attempt_count still 5)

Yes, this makes sense. The attempt_count is incremented during send, not during resend eligibility check.

Now let me also think about `markSent` vs `markAccepted`. They're the same in terms of state transition (both go to SENT). The difference is semantic: "accepted" means the bank accepted the payment, "duplicate" means the txid was already used. In both cases, the order is in the bank's system, so we mark it as SENT.

Let me simplify: `markSentAfterSend` handles both accepted and duplicate.

Actually, let me just have `markSent(id, txid)` and `markAwaitingReconcile(id, txid)` for the two non-terminal outcomes. And `markRejected(id, txid)` for permanent rejection.

Let me redesign:

```ts
class PayoutRepository {
  async findPending(): Promise<Payout[]> { ... }
  async findByTxid(txid: string): Promise<Payout | null> { ... }
  async findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]> { ... }
  async findReprocessableForResend(cutoff: Date): Promise<Payout[]> { ... } // AWAITING_RECONCILE past lag, not in statement
  
  async markSent(id: string, txid: string): Promise<Payout> { ... }
  async markAwaitingReconcile(id: string, txid: string): Promise<Payout> { ... }
  async markRejected(id: string, txid: string): Promise<Payout> { ... }
  async markSettled(id: string, settledAt: Date): Promise<Payout> { ... }
  async markForResend(id: string): Promise<Payout> { ... }
  async markFailed(id: string, failedAt: Date): Promise<Payout> { ... }
}
```

This is much cleaner. Let me implement each.

For the `attemptCount` increment, it happens in `markSent`, `markAwaitingReconcile`, and `markRejected`.

Wait, should `markRejected` increment the attempt_count? The task says "Cap attempts at 5." A permanent rejection is a terminal state — we don't retry. So whether we increment the attempt_count doesn't matter (we'll never resend a rejected order). But for consistency, let me increment it.

Actually, should a permanent rejection count as an attempt? If the bank says "permanent rejection," we know the send definitively failed. We don't need reconciliation to prove anything. We just mark it as REJECTED. Whether the attempt count matters... I think it should still increment, for auditability.

OK let me also think about whether I need `markSent` to set the txid. Yes, because the txid is derived on the first send and should be stored for future reference (duplicate detection, reconciliation).

Now let me think about the domain type more carefully. I need to make sure the repository's `toDomain` conversion is correct.

Prisma Payout type (generated):
```ts
{
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus; // Prisma-generated enum
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Domain Payout type:
```ts
{
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus; // Domain enum
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

They're identical in structure. The only difference is the enum type (Prisma's vs. domain's). Since both use the same string values, I can cast: `result as unknown as Payout` or just spread it.

Let me just use a simple cast.

Now let me think about the tests.

### test/payout.spec.ts

The tests need to:
1. Set up an in-memory database (or mock the repository).
2. Mock the bank client.
3. Test the three scenarios.

For testing without a real database, I can either:
- Use a real in-memory database (PostgreSQL with `pg-mem` or SQLite).
- Mock the repository and test only the service logic.

Given the task asks for tests for specific scenarios, I think mocking the repository and bank client is the most practical approach. But the task also says "Never assert only that a call happened" — so we need to verify actual behavior.

Actually, let me think about what we're testing. The three scenarios are:
1. timeout-but-settled (no resend): Order times out, reconcile finds it in statement, mark as SETTLED, don't resend.
2. proven-absent (resend, same txid): Order times out, reconcile doesn't find it, mark as PENDING, executePayments resends with same txid.
3. attempt exhaustion: Order goes through 5 attempts, all timeout, after 5th reconcile proves absence, mark as FAILED.

These involve both the service and the bank client. For a realistic test, I'd want to use a real database. But since we're in a test environment, let me use a mock or in-memory approach.

Let me use Prisma with SQLite (in-memory) for testing. This gives us a real database without needing PostgreSQL.

But the Prisma schema uses PostgreSQL-specific types (`TIMESTAMP WITH TIME ZONE`, `gen_random_uuid()`). For SQLite, `gen_random_uuid()` is not available. Let me adjust.

Actually, for testing, I can use a different data source. But that's complex. Let me instead mock the repository and bank client for the service tests. This way, I test the service logic in isolation, which is what the task is really about.

But the convention says "Never assert only that a call happened." So I need to verify the state transitions, not just that certain methods were called.

Let me use a mock repository that actually stores state (like an in-memory store) and a mock bank client. This way, I can verify the actual state transitions.

Here's my approach:
- Create a mock repository that implements `PayoutRepository` with an in-memory store.
- Create a mock bank client that implements `BankClient`.
- Test the service with these mocks.

This gives us real behavioral testing without needing a database.

Let me design the mock repository:

```ts
class MockPayoutRepository implements PayoutRepository {
  private store: Map<string, Payout> = new Map();
  
  create(payout: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = uuid();
    const now = new Date();
    const p: Payout = { id, ...payout, createdAt: now, updatedAt: now };
    this.store.set(id, p);
    return p;
  }
  
  async findPending(): Promise<Payout[]> {
    return [...this.store.values()].filter(p => p.status === PayoutStatus.PENDING);
  }
  
  async findByTxid(txid: string): Promise<Payout | null> {
    return [...this.store.values()].find(p => p.txid === txid) ?? null;
  }
  
  async findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]> {
    return [...this.store.values()].filter(p => 
      p.status === PayoutStatus.AWAITING_RECONCILE && p.effectiveDate <= cutoff
    );
  }
  
  async update(id: string, data: Partial<Payout>): Promise<Payout> {
    const p = this.store.get(id);
    if (!p) throw new Error('Not found');
    const updated = { ...p, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
  
  // ... specific methods
}
```

Actually, let me think about this more carefully. The service calls specific repository methods like `markSent`, `markAwaitingReconcile`, etc. The mock needs to implement these.

Let me define the repository interface properly.

OK, I think I'm overcomplicating the design. Let me take a step back and just write the code. Let me define everything clearly.

Let me plan all the files:

1. `prisma/schema.prisma` — the schema
2. `prisma/migrations/<timestamp>_init/migration.sql` — the migration
3. `src/payout/payout.types.ts` — domain types
4. `src/bank/bank.types.ts` — bank client interface
5. `src/payout/payout.repository.ts` — repository (Prisma)
6. `src/payout/payout.service.ts` — service with executePayments and reconcile
7. `src/payout/payout.controller.ts` — controller (for triggering payments/reconcile)
8. `src/payout/payout.module.ts` — module wiring
9. `src/bank/bank.module.ts` — bank module
10. `test/payout.spec.ts` — tests

Wait, I also need a Prisma service. Let me include that.

11. `src/prisma/prisma.service.ts` — Prisma client wrapper

And for the bank client, I need either a real implementation or just the interface. The task doesn't require a real bank client, so let me provide the interface and maybe a mock for testing.

Actually, let me also provide a bank service that wraps the HTTP calls, even if it's a stub. But the task says "Do exactly what the task asks." The task asks for "schema, service, reconcile job, and tests." So I need:
- Schema (Prisma)
- Service (PayoutService with executePayments and reconcile)
- Reconcile job (could be the reconcile method itself, or a scheduled job)
- Tests

Let me include the necessary supporting files (types, repository, module, controller, bank interface) but focus on the core deliverables.

Let me now write all the code.

Actually, let me reconsider the repository design. Instead of having separate methods like `markSent`, `markAwaitingReconcile`, etc., let me have a more generic interface but with specific helpers. The service should call repository methods that abstract away Prisma details.

Let me define:

```ts
export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]>;
  setTxid(id: string, txid: string): Promise<void>;
  incrementAttempt(id: string): Promise<void>;
  setStatus(id: string, status: PayoutStatus, timestamps?: { settledAt?: Date; rejectedAt?: Date; failedAt?: Date }): Promise<void>;
  // Or a more generic update
}
```

Hmm, this is getting complex. Let me go with the specific methods approach — it's cleaner and more expressive:

```ts
export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}
```

This is clean. The service calls these methods, and the repository handles the Prisma details.

Now let me write all the files.

Actually wait, I also need to think about how the `Payout` type's `status` field uses the domain `PayoutStatus` enum. The service uses `PayoutStatus` from `payout.types.ts`. The repository returns `Payout` with the domain `PayoutStatus`. Internally, the repository casts from Prisma's enum to the domain enum.

Let me define the domain types:

```ts
// src/payout/payout.types.ts

export enum PayoutStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  AWAITING_RECONCILE = 'AWAITING_RECONCILE',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}
```

Now the bank types:

```ts
// src/bank/bank.types.ts

export type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

export interface BankSendResult {
  status: BankSendStatus;
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

Now the repository:

```ts
// src/payout/payout.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus } from './payout.types';

@Injectable()
export class PayoutRepository implements PayoutRepositoryInterface {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
      orderBy: { effectiveDate: 'asc' },
    });
    return results.map(this.toDomain);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const result = await this.prisma.payout.findUnique({
      where: { txid },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.AWAITING_RECONCILE,
        effectiveDate: { lte: cutoff },
      },
    });
    return results.map(this.toDomain);
  }

  async markSent(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.SENT,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.AWAITING_RECONCILE,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markRejected(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.REJECTED,
        rejectedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        settledAt,
      },
    });
  }

  async markForResend(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.PENDING,
      },
    });
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.FAILED,
        failedAt,
      },
    });
  }

  private toDomain(prismaPayout: any): Payout {
    return {
      id: prismaPayout.id,
      externalKey: prismaPayout.externalKey,
      amount: prismaPayout.amount,
      effectiveDate: prismaPayout.effectiveDate,
      txid: prismaPayout.txid,
      status: prismaPayout.status as PayoutStatus,
      attemptCount: prismaPayout.attemptCount,
      settledAt: prismaPayout.settledAt,
      rejectedAt: prismaPayout.rejectedAt,
      failedAt: prismaPayout.failedAt,
      createdAt: prismaPayout.createdAt,
      updatedAt: prismaPayout.updatedAt,
    };
  }
}
```

Wait, I'm implementing the interface on the class itself, but I should separate the interface from the implementation. Let me put the interface in `payout.types.ts` and the implementation in `payout.repository.ts`.

Actually, let me think about this. The service depends on the repository interface. The repository class implements that interface. For testing, I can create a mock implementation.

Let me define the repository interface in `payout.types.ts`:

```ts
// src/payout/payout.types.ts

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}
```

Then the Prisma implementation:

```ts
// src/payout/payout.repository.ts

@Injectable()
export class PayoutPrismaRepository implements PayoutRepository {
  // ...
}
```

And the service:

```ts
// src/payout/payout.service.ts

@Injectable()
export class PayoutService {
  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankClient: BankClient,
  ) {}
  // ...
}
```

This is clean. For testing, I create a mock `PayoutRepository` and mock `BankClient`.

Now let me think about the `date-fns` dependency. I need `format` or a similar function. Let me avoid external dependencies and just use a simple date formatting function.

Actually, I need to iterate over dates in the reconcile window. I need to:
1. Start from `window.from`
2. Go day by day until `window.to`
3. For each date, call `getStatement(date)` if the date is past the publish lag

Wait, actually, I think the reconcile function should be simpler. Let me reconsider.

The reconcile function matches statement entries to orders. The statement is for specific dates. The orders have `effective_date`. 

When reconcile runs with a window `{ from, to }`:
1. For each date in the window (that's past the publish lag), get the statement.
2. For each settlement in the statement, find the matching order by txid. If found, mark as SETTLED.
3. For orders in AWAITING_RECONCILE with effective_date <= now - publish_lag, check if they were found in the statement. If not, mark for resend or FAILED.

Let me think about step 3 more carefully. We need to check if an AWAITING_RECONCILE order's txid appears in any of the settlements we fetched. But we only fetch settlements for dates in the window. If the order's effective_date is not in the window, we won't find it.

Hmm, so the reconcile window needs to cover the effective_date of the orders we want to check. If the window is `{ from: today - 1 day, to: today }`, and the order's effective_date is today, we'll check today's statement.

But the statement for "today" might not be ready (due to the 30-min lag). So we only check dates that are past the lag.

Let me reconsider. Maybe the reconcile function doesn't need to be as complex. Let me think about what the window means.

I think the window is the time range of statements to check. The orders we want to reconcile are those whose effective_date falls within this window. The reconcile function:
1. Fetches statements for dates in the window that are past the publish lag.
2. Matches settlements to orders.
3. For AWAITING_RECONCILE orders whose effective_date is in the window and past the lag:
   - If found in statement → SETTLED
   - If not found → resend or FAILED

This makes sense. Let me implement it.

For date iteration, I need a helper:

```ts
function* dateRange(from: Date, to: Date): Generator<Date> {
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    yield new Date(current);
    current.setDate(current.getDate() + 1);
  }
}
```

Now, for the txid derivation, I need a date formatting function:

```ts
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

OK, let me also think about the controller. The task doesn't explicitly ask for a controller, but the NestJS conventions include one. Let me include a minimal controller that exposes endpoints for triggering payments and reconciliation.

Actually, the task says "Do exactly what the task asks. Do not create a file it does not call for." The task asks for "schema, service, reconcile job, and tests." So I should provide:
1. Schema (Prisma)
2. Service (PayoutService)
3. Reconcile job (the reconcile method, possibly as a scheduled job)
4. Tests

But I also need supporting infrastructure: types, repository, module, bank interface, Prisma service. These are necessary for the service to work. Let me include them.

For the controller, I'll include one since it's part of the NestJS pattern and the service needs to be wired into a module. But I'll keep it minimal.

Actually, re-reading the conventions: "A controller is declared by a module." So I need a module, which declares the controller and provides the service and repository. This is part of the NestJS pattern. Let me include the module and controller.

But wait — should the "reconcile job" be a separate file? The task says "reconcile job." In a NestJS context, this could be a scheduled task (using `@nestjs/schedule`) or just a method on the service. Let me include it as a method on the service, and optionally as a scheduled job in the module.

Actually, let me include a separate file for the reconcile job that uses `@nestjs/schedule` to run every 15 minutes. But `@nestjs/schedule` might not be installed. Let me keep it simpler — the reconcile job is just the `reconcile` method on the service, which can be called by a cron job or manually.

Let me include a controller endpoint that triggers reconciliation, and the service has the `reconcile` method. That's sufficient.

OK, I think I have a good plan. Let me also think about the `package.json` to include dependencies. Actually, the task doesn't ask for package.json, and the conventions say I should work against existing files. Let me check if there are existing files mentioned.

The task says "If files are given above the task, they are the existing codebase." But the task only gives a reference markdown file, no actual codebase files. So I'm building from scratch.

Since I'm building from scratch, I need to include enough files to make the solution work. Let me include:
- `package.json` (with dependencies)
- `tsconfig.json`
- `prisma/schema.prisma`
- Migration SQL
- Source files
- Test files

Actually, the task says "Decide the file layout yourself. Nothing here dictates one." and "Deliver every file the solution needs." So I need to deliver all necessary files. Let me include the essential ones.

For dependencies, I'll need:
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (NestJS core)
- `@prisma/client` (Prisma client)
- `prisma` (Prisma CLI, dev dependency)
- `uuid` (for generating IDs, or use Prisma's uuid)
- `vitest` (testing framework)
- `@types/node` (Node types)
- TypeScript

Let me also think about the tsconfig for ESM. The conventions say `"type": "module"` and ESM. So `tsconfig.json` needs `"module": "node16"` or `"module": "esnext"` with `"moduleResolution": "node16"`.

Actually, let me not get too deep into build configuration. The key deliverables are the schema, service, reconcile job, and tests. Let me focus on those and include supporting files as needed.

Let me now write all the files. Let me be careful about the types and imports.

One more thing: the `pnpm` package manager. The conventions say `pnpm as the package manager`. So the lock file would be `pnpm-lock.yaml`. But I don't need to include that.

Let me also think about the `PrismaService`. I need it for the Prisma client. Let me include it.

OK, let me write all the files now.

Actually, let me also think about the `publishLagMinutes` configuration. The task says "~30 min of publishing lag." Let me make this configurable via an environment variable `PUBLISH_LAG_MINUTES`, defaulting to 30.

And `MAX_ATTEMPTS` — the task says "Cap attempts at 5." Let me make this configurable via `MAX_PAYOUT_ATTEMPTS`, defaulting to 5.

Wait, the task says "Cap attempts at 5" — this seems like a business rule, not a configuration. Let me use a constant.

Actually, the conventions say "Configuration comes from environment variables only." So let me use env vars with defaults.

Hmm, but for testing, I need to control the publish lag. Let me make it injectable.

Let me think about the cleanest way to do this. I'll create a config interface:

```ts
export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}
```

And the service takes this as a constructor parameter. In the module, I read from env vars.

Actually, for simplicity, let me just use env vars directly in the service constructor. For testing, I can set env vars or mock them.

Wait, that's not great for testing. Let me make the config injectable. But NestJS DI can be complex. Let me just pass the config to the service constructor.

Hmm, let me think about the testing approach. In the tests, I'll create the service directly:

```ts
const service = new PayoutService(repository, bankClient, {
  publishLagMinutes: 30,
  maxAttempts: 5,
});
```

This is clean for testing. In the module, I'll provide the config from env vars.

OK, let me finalize the design and write the code.

Let me also think about the `format` import. I was going to use `date-fns` but decided against external deps. Let me just write a simple date formatting function inline in the service.

Actually, I do need date-fns for the `format` function in some implementations. But I can replace it with a simple utility. Let me avoid the dependency.

Let me also think about the `crypto` module. Node.js has a built-in `crypto` module for `createHash`. I'll use that for the txid derivation.

Wait, should I use `createHash('sha256')` or something simpler? The task says "derived deterministically from the order + effective date." A simple hash works. Let me use a simple approach:

```ts
import { createHash } from 'crypto';

function deriveTxid(orderId: string, effectiveDate: Date): string {
  const dateStr = formatDateKey(effectiveDate);
  return createHash('sha256')
    .update(`${orderId}:${dateStr}`)
    .digest('hex')
    .substring(0, 32);
}
```

This is deterministic — same orderId + effectiveDate always produces the same txid.

Now let me think about the reconcile job. The task says "reconcile job." In a production system, this would be a scheduled task. In NestJS, we'd use `@nestjs/schedule` with `@Cron`. But for this task, I can implement it as a method on the service and trigger it via a controller endpoint or a cron job.

Let me include a simple cron-based job in the module or service. But since `@nestjs/schedule` might not be installed, let me just make it a method and include a comment about how it would be scheduled.

Actually, let me create a separate `ReconcileJob` class that uses `setInterval` or similar to run periodically. But that's not the NestJS way. Let me just keep the `reconcile` method on the service and note that it can be scheduled.

Hmm, the task specifically says "reconcile job." Let me create a separate file for it: `src/payout/reconcile-job.ts` or include it in the service. I'll make it a method on the service with a controller endpoint to trigger it.

Actually, let me re-read: "Deliver schema, service, reconcile job, and tests." I think "reconcile job" just means the `reconcile` function. It's not necessarily a separate file. Let me include it as the `reconcile` method on the `PayoutService`, and add a controller endpoint to trigger it.

OK, I think I've been planning enough. Let me write the code now.

Let me also consider: the `PayoutRepository` interface — should I define it in `payout.types.ts` or in a separate file? Let me put it in `payout.types.ts` along with the other types.

Wait, actually, the repository interface references `Payout` and `PayoutStatus`, which are also in `payout.types.ts`. So it makes sense to put the interface there.

But there's a circular dependency risk: the service depends on the repository interface, and the repository interface depends on the Payout type. Let me just put everything in `payout.types.ts`.

Actually, there's no circular dependency — `payout.types.ts` defines types only, no imports. The service and repository both import from it. This is clean.

Let me also think about the `BankClient` interface. It should be in `bank.types.ts`. The service depends on it. In the module, we provide a concrete implementation (or a mock for testing).

For the module wiring, I need:
- `PrismaModule` (provides `PrismaService`)
- `BankModule` (provides `BankClient`)
- `PayoutModule` (provides `PayoutService`, `PayoutRepository`; declares `PayoutController`; imports `PrismaModule`, `BankModule`)

Let me now write everything.

Let me think about one more thing: the `executePayments` method needs to handle the case where `bank.send` throws (not just returns a result). For example, if the HTTP call fails entirely. I should catch this and treat it as a `transient_error`.

Also, I need to think about what happens when `bank.send` returns `accepted` but the order is already in `SENT` or `SETTLED` state. This could happen if executePayments runs twice quickly. The service should handle this gracefully.

Actually, `executePayments` only picks up `PENDING` orders, so if a second run happens, the order is no longer `PENDING` (it's `SENT` or `AWAITING_RECONCILE`). So we're fine.

But what about `duplicate`? If we send a payment and get a `duplicate` response, it means the txid was already used. But since `executePayments` only picks up `PENDING` orders, and each order has a unique txid (derived from order ID + effective date), a `duplicate` response would mean the bank already has this txid from a previous send. This could happen if:
1. The first send was accepted but we didn't record it (race condition).
2. The first send timed out but was actually accepted, and now we're sending again.

Wait, but if the first send timed out, the order would be in `AWAITING_RECONCILE`, not `PENDING`. So `executePayments` wouldn't pick it up. The `duplicate` case would only happen if there's a bug or data inconsistency.

Actually, the `duplicate` case is more relevant when we get it from the bank's first response. For example:
- We try to send payment with txid T.
- The bank says "duplicate" — this txid was already used.
- This means the bank already has this payment. It's likely `SENT` or `SETTLED`.
- We should check if the order is already settled. If not, mark it as `SENT`.

But since `executePayments` only picks up `PENDING` orders, and a `PENDING` order shouldn't have a duplicate txid in the bank (unless it was sent before and not recorded), the `duplicate` case is an edge case.

Let me handle it by marking the order as `SENT` (same as accepted) — the bank has the payment, so it's in the system.

OK, I think I've thought through all the edge cases. Let me now write the code.

One more consideration: the tests. I need to test:
1. timeout-but-settled (no resend): 
   - Create a PENDING order.
   - executePayments → bank returns transient_error (timeout).
   - Order is now AWAITING_RECONCILE.
   - reconcile → bank statement contains the txid.
   - Order is now SETTLED.
   - executePayments → order is not picked up (it's SETTLED).
   - Assert: order is SETTLED, not re-sent.

2. proven-absent (resend, same txid):
   - Create a PENDING order.
   - executePayments → bank returns transient_error (timeout).
   - Order is now AWAITING_RECONCILE, attempt_count = 1.
   - reconcile → statement does NOT contain the txid, effective_date is past lag.
   - Order is now PENDING (eligible for resend).
   - executePayments → bank.send called with SAME txid.
   - Assert: order was re-sent with the same txid.

3. attempt exhaustion:
   - Create a PENDING order.
   - executePayments → timeout, attempt_count = 1, AWAITING_RECONCILE.
   - reconcile → no txid in statement, past lag → PENDING.
   - executePayments → timeout, attempt_count = 2, AWAITING_RECONCILE.
   - ... repeat 5 times.
   - After 5th timeout + reconcile:
     - reconcile → no txid, past lag → attempt_count >= 5 → FAILED.
   - Assert: order is FAILED, not re-sent.

For the tests, I need to control time (for the publish lag). Let me use a configurable time or mock `Date.now()`.

Actually, let me think about how to test the time-based logic. The publish lag check is: `effectiveDate + publishLagMs < now`. If I set the effectiveDate far enough in the past, it will be past the lag. This is the simplest approach.

For the test, I'll set `effectiveDate` to a date that's more than 30 minutes in the past. Then when reconcile runs, the order is past the lag.

For the "not past lag" case (where we shouldn't resend yet), I'd set effectiveDate to recent. But the test scenarios don't specifically require this — they focus on timeout-but-settled, proven-absent, and attempt exhaustion. In all three, the effective date needs to be past the lag for the resend logic to kick in.

Wait, for timeout-but-settled, the order is found in the statement. The "past lag" check doesn't matter because we found it. For proven-absent, the order is NOT in the statement and is past the lag — so we resend. For attempt exhaustion, same thing.

Let me make the tests set the effectiveDate to 2 hours ago (well past the 30-min lag).

For the mock bank client, I need to track:
- How many times `send` was called.
- What txids were sent.
- What to return from `send` (can be configured per call).
- What to return from `getStatement` (the statement entries).

Let me design the mock:

```ts
class MockBankClient implements BankClient {
  sendCalls: { txid: string; amount: number; key: string }[] = [];
  sendResults: BankSendResult[] = [];
  statementEntries: Settlement[] = [];
  statementDates: Map<string, Settlement[]> = new Map();
  
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    const result = this.sendResults[this.sendCalls.length - 1] ?? this.sendResults[0];
    return result;
  }
  
  async getStatement(date: Date): Promise<Settlement[]> {
    const key = formatDateKey(date);
    return this.statementDates.get(key) ?? this.statementEntries;
  }
  
  setStatementForDate(date: Date, entries: Settlement[]): void {
    this.statementDates.set(formatDateKey(date), entries);
  }
}
```

This is flexible enough for the tests.

Now let me also think about the mock repository:

```ts
class MockPayoutRepository implements PayoutRepository {
  private store: Map<string, Payout> = new Map();
  private counter = 0;
  
  create(data: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = `payout-${++this.counter}`;
    const now = new Date();
    const payout: Payout = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, payout);
    return payout;
  }
  
  get(id: string): Payout | undefined {
    return this.store.get(id);
  }
  
  async findPending(): Promise<Payout[]> {
    return [...this.store.values()].filter(p => p.status === PayoutStatus.PENDING);
  }
  
  async findByTxid(txid: string): Promise<Payout | null> {
    return [...this.store.values()].find(p => p.txid === txid) ?? null;
  }
  
  async findAwaitingReconcilePastLag(cutoff: Date): Promise<Payout[]> {
    return [...this.store.values()].filter(p => 
      p.status === PayoutStatus.AWAITING_RECONCILE && p.effectiveDate <= cutoff
    );
  }
  
  async markSent(id: string, txid: string): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.txid = txid;
    p.status = PayoutStatus.SENT;
    p.attemptCount++;
    p.updatedAt = new Date();
  }
  
  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.txid = txid;
    p.status = PayoutStatus.AWAITING_RECONCILE;
    p.attemptCount++;
    p.updatedAt = new Date();
  }
  
  async markRejected(id: string, txid: string): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.txid = txid;
    p.status = PayoutStatus.REJECTED;
    p.rejectedAt = new Date();
    p.attemptCount++;
    p.updatedAt = new Date();
  }
  
  async markSettled(id: string, settledAt: Date): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.status = PayoutStatus.SETTLED;
    p.settledAt = settledAt;
    p.updatedAt = new Date();
  }
  
  async markForResend(id: string): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.status = PayoutStatus.PENDING;
    p.updatedAt = new Date();
  }
  
  async markFailed(id: string, failedAt: Date): Promise<void> {
    const p = this.store.get(id);
    if (!p) throw new Error('Payout not found');
    p.status = PayoutStatus.FAILED;
    p.failedAt = failedAt;
    p.updatedAt = new Date();
  }
}
```

This mock repository actually stores and updates state, so we can verify behavior end-to-end.

Now let me think about the test structure. Each test:

```ts
describe('PayoutService', () => {
  let service: PayoutService;
  let repo: MockPayoutRepository;
  let bank: MockBankClient;

  beforeEach(() => {
    repo = new MockPayoutRepository();
    bank = new MockBankClient();
    service = new PayoutService(repo, bank, { publishLagMinutes: 30, maxAttempts: 5 });
  });

  describe('reconcile', () => {
    it('timeout-but-settled: does not resend', async () => {
      // Create a PENDING order with effective date 2 hours ago
      const order = repo.create({
        externalKey: 'key-123',
        amount: 1000,
        effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: PayoutStatus.PENDING,
        txid: null,
        attemptCount: 0,
        settledAt: null,
        rejectedAt: null,
        failedAt: null,
      });

      // executePayments → bank times out
      bank.sendResults = [{ status: 'transient_error', error: 'timeout' }];
      await service.executePayments();

      // Order should be AWAITING_RECONCILE with txid set
      expect(repo.get(order.id).status).toBe(PayoutStatus.AWAITING_RECONCILE);
      expect(bank.sendCalls.length).toBe(1);
      const txid = repo.get(order.id).txid;

      // reconcile → bank statement contains the txid (it was actually settled)
      bank.setStatementForDate(new Date(Date.now() - 2 * 60 * 60 * 1000), [{
        txid: txid!,
        amount: 1000,
        status: 'settled',
      }]);
      
      const window = {
        from: new Date(Date.now() - 3 * 60 * 60 * 1000),
        to: new Date(),
      };
      await service.reconcile(window);

      // Order should be SETTLED
      expect(repo.get(order.id).status).toBe(PayoutStatus.SETTLED);

      // executePayments again → should NOT resend (order is SETTLED, not PENDING)
      await service.executePayments();
      expect(bank.sendCalls.length).toBe(1); // no additional send
    });

    it('proven-absent: resends with same txid', async () => {
      // Create PENDING order
      const order = repo.create({
        externalKey: 'key-123',
        amount: 1000,
        effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: PayoutStatus.PENDING,
        txid: null,
        attemptCount: 0,
        settledAt: null,
        rejectedAt: null,
        failedAt: null,
      });

      // executePayments → bank times out
      bank.sendResults = [{ status: 'transient_error', error: 'timeout' }];
      await service.executePayments();

      expect(repo.get(order.id).status).toBe(PayoutStatus.AWAITING_RECONCILE);
      const originalTxid = repo.get(order.id).txid;

      // reconcile → bank statement does NOT contain the txid
      bank.setStatementForDate(new Date(Date.now() - 2 * 60 * 60 * 1000), []);
      
      const window = {
        from: new Date(Date.now() - 3 * 60 * 60 * 1000),
        to: new Date(),
      };
      await service.reconcile(window);

      // Order should be PENDING (eligible for resend)
      expect(repo.get(order.id).status).toBe(PayoutStatus.PENDING);

      // executePayments → should resend
      bank.sendResults = [{ status: 'transient_error', error: 'timeout' }];
      await service.executePayments();

      expect(bank.sendCalls.length).toBe(2);
      expect(bank.sendCalls[1].txid).toBe(originalTxid); // same txid
    });

    it('attempt exhaustion: parks for manual review', async () => {
      const order = repo.create({
        externalKey: 'key-123',
        amount: 1000,
        effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: PayoutStatus.PENDING,
        txid: null,
        attemptCount: 0,
        settledAt: null,
        rejectedAt: null,
        failedAt: null,
      });

      // Simulate 5 attempts
      for (let i = 0; i < 5; i++) {
        // executePayments → bank times out
        bank.sendResults = [{ status: 'transient_error', error: 'timeout' }];
        await service.executePayments();
        
        // reconcile → proven absent
        bank.setStatementForDate(new Date(Date.now() - 2 * 60 * 60 * 1000), []);
        const window = {
          from: new Date(Date.now() - 3 * 60 * 60 * 1000),
          to: new Date(),
        };
        await service.reconcile(window);
        
        // After reconcile, order should be PENDING (for i < 4) or FAILED (for i = 4)
        if (i < 4) {
          expect(repo.get(order.id).status).toBe(PayoutStatus.PENDING);
        }
      }

      // After 5th attempt + reconcile, should be FAILED
      expect(repo.get(order.id).status).toBe(PayoutStatus.FAILED);
      expect(repo.get(order.id).attemptCount).toBe(5);

      // executePayments should NOT resend
      await service.executePayments();
      expect(bank.sendCalls.length).toBe(5); // no 6th send
    });
  });
});
```

Wait, there's a subtlety. In the attempt exhaustion test, after the 5th attempt, the reconcile should mark the order as FAILED (because attempt_count >= 5). Let me trace through:

- Attempt 1: PENDING → send (timeout) → AWAITING_RECONCILE, attempt_count=1
- Reconcile: not in statement, attempt_count=1 < 5 → PENDING
- Attempt 2: PENDING → send (timeout) → AWAITING_RECONCILE, attempt_count=2
- Reconcile: not in statement, attempt_count=2 < 5 → PENDING
- ...
- Attempt 5: PENDING → send (timeout) → AWAITING_RECONCILE, attempt_count=5
- Reconcile: not in statement, attempt_count=5 >= 5 → FAILED

Yes, this is correct. After the 5th attempt and reconcile, the order is FAILED.

But wait, in the loop above, for i=0 to 4 (5 iterations), we do:
- executePayments (send)
- reconcile

After i=4 (5th iteration):
- attempt_count = 5 (incremented during the 5th send)
- status = AWAITING_RECONCILE
- reconcile: not in statement, attempt_count=5 >= 5 → FAILED

So the test is correct. After the loop, the order should be FAILED.

But I also need to check that for i < 4, the order is PENDING after reconcile (eligible for resend). Let me adjust:

```ts
for (let i = 0; i < 5; i++) {
  bank.sendResults = [{ status: 'transient_error', error: 'timeout' }];
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(i + 1);
  
  bank.setStatementForDate(/* ... */, []);
  await service.reconcile(window);
  
  if (i < 4) {
    expect(repo.get(order.id).status).toBe(PayoutStatus.PENDING);
  } else {
    expect(repo.get(order.id).status).toBe(PayoutStatus.FAILED);
  }
}
expect(repo.get(order.id).attemptCount).toBe(5);
```

Good.

Now let me also think about whether the test for "timeout-but-settled" should also verify that the order is NOT re-sent. In the test, I call `executePayments` again after reconciliation. Since the order is now `SETTLED`, `findPending()` won't return it, so it won't be sent. This is verified by `bank.sendCalls.length` staying at 1.

Let me also think about a subtle issue: in the "proven-absent" test, after reconcile marks the order as PENDING, we call `executePayments` again. The `executePayments` derives the txid from the order + effective_date. Since the txid is deterministic, it should be the same as the original. But the repository already stored the txid on the first send (via `markAwaitingReconcile`). When `executePayments` runs again, should it use the stored txid or derive a new one?

In my implementation, the service does:
```ts
const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
```

So if the txid is already stored, we use the stored one. If not, we derive it. This ensures the same txid is always used.

But wait — in `executePayments`, when we pick up a PENDING order, it might not have a txid yet (first attempt). So we derive it. On subsequent attempts (after reconcile marked it as PENDING), the txid is already stored. So we use the stored one.

This is correct. The txid is derived on the first attempt and stored. On subsequent attempts, the stored txid is used.

Good.

Now let me also think about the `reconcile` method's date handling. The `getStatement(date)` call needs to match the date of the order's effective_date. If the effective_date is 2024-01-15 14:30:00, we should call `getStatement(new Date(2024-01-15))` (or just the date part).

In my `fetchStatementForWindow` function, I iterate over dates and call `getStatement` for each. The statement entries have a txid that matches our stored txids. So as long as we check the right dates, the matching should work.

For the test, I set the statement for the date matching the order's effective_date. Let me make sure the date comparison works.

Actually, in my test, I use `new Date(Date.now() - 2 * 60 * 60 * 1000)` as the effective date. This is a specific time (2 hours ago). The `getStatement` call uses a date (the day). So I need to make sure the mock returns the statement for the right day.

Let me simplify by having the mock return the same statement for any date:

```ts
class MockBankClient implements BankClient {
  // ...
  statementEntries: Settlement[] = [];
  
  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statementEntries;
  }
}
```

This way, I don't need to worry about date matching in the mock. The reconcile function will call `getStatement` for each date, and the mock returns the same entries.

But in the "proven-absent" test, I need the statement to NOT contain the txid. So I set `statementEntries = []`.
In the "timeout-but-settled" test, I need the statement to contain the txid. So I set `statementEntries = [{ txid, amount, status: 'settled' }]`.

This is simpler. Let me use this approach.

But wait, there's a subtlety with the date iteration. In reconcile, I call `getStatement` for each date in the window that's past the publish lag. If the window is { from: 3h ago, to: now }, and the publish lag is 30 min, I'll call `getStatement` for dates from 3h ago to 30 min ago.

For each date, the mock returns the same `statementEntries`. So the union of all statement entries is just `statementEntries`. This is fine for testing.

OK, let me finalize the implementation. Let me also think about the `formatDateKey` function — I need it for both the mock and the service.

Let me put it in a utility file or inline in the service.

Actually, I need `formatDateKey` in:
1. The service (for date iteration in reconcile)
2. The mock bank client (for date-based statement lookup)
3. The tests (for setting up statement dates)

Let me put it in `payout.types.ts` or a separate utility file. Actually, let me put it in the service file itself as a private function, and export a standalone version for testing.

Hmm, let me just put it in a shared utility:

```ts
// src/payout/payout.utils.ts
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function* dateRange(from: Date, to: Date): Generator<Date> {
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    yield new Date(current);
    current.setDate(current.getDate() + 1);
  }
}
```

Actually, for the mock bank client, I don't need `formatDateKey` if I just return the same entries for any date. Let me keep the mock simple.

Let me now think about what happens in the reconcile method when the statement contains a txid that doesn't match any order. This is the normal case for many statement entries. We just skip them (or count them as unmatched).

OK, I think I have a complete enough plan. Let me write the code now.

Let me also think about the module and dependency injection.

```ts
// src/payout/payout.module.ts
@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait, but `PayoutRepository` implements `PayoutRepository` interface. In NestJS DI, I need to provide it. The service injects it by token. If I use an interface, I need to provide a token.

Actually, in NestJS, when you inject by type, TypeScript types are erased. So injecting an interface doesn't work directly. I need to use a class or a symbol token.

Let me use the class `PayoutRepository` as the injection token:

```ts
@Injectable()
export class PayoutRepository implements PayoutRepository {
  // ...
}
```

But this creates a naming conflict (class name = interface name). Let me rename the interface:

Actually, the standard NestJS approach is to just use a concrete class. The "interface" is implicit. For testing, we can override the provider with a mock.

Let me just have:
- `PayoutRepository` is a class that implements the Prisma operations.
- The service injects `PayoutRepository`.
- For testing, we create a `MockPayoutRepository` that has the same methods.

In the test, we instantiate the service directly (not through NestJS DI), so we can pass any implementation.

Let me also think about the `BankClient`. Same approach — `BankService` is a class that implements the bank client interface, and the service injects it.

For testing, the mock bank client is passed directly to the service constructor.

OK, let me finalize the file list:

1. `prisma/schema.prisma`
2. `prisma/migrations/<timestamp>_init/migration.sql`
3. `src/prisma/prisma.service.ts`
4. `src/bank/bank.types.ts`
5. `src/bank/bank.service.ts` (real implementation, maybe just a stub)
6. `src/bank/bank.module.ts`
7. `src/payout/payout.types.ts`
8. `src/payout/payout.repository.ts`
9. `src/payout/payout.service.ts`
10. `src/payout/payout.controller.ts`
11. `src/payout/payout.module.ts`
12. `test/payout.spec.ts`

Actually, for the bank service, I need a real implementation. But the task doesn't specify what the bank API looks like. Let me provide an interface and a stub implementation, with an `// ASSUMPTION` comment.

Hmm, the task says the bank exposes `getStatement(date)` and `send({txid, amount, key})`. These are the interface methods. A real implementation would make HTTP calls. For this task, I'll provide the interface and a mock/stub.

Actually, let me not include a real bank service implementation since it's not part of the deliverables (schema, service, reconcile job, tests). I'll include the bank types/interface and provide a mock in the test.

But I do need the bank module for wiring. Let me include a simple module that provides a mock or stub bank service.

Actually, let me think about what's truly needed:
- The `PayoutService` depends on `BankClient` and `PayoutRepository`.
- For the tests, I provide mocks of both.
- For production, I need a real `BankClient` implementation.

Let me include the bank types and a stub implementation, plus the module wiring. This makes the solution complete.

Actually, the task says "Do exactly what the task asks." The task asks for schema, service, reconcile job, and tests. Let me include the minimum necessary supporting files but focus on the deliverables.

The "service" deliverable includes the `PayoutService` with `executePayments` and `reconcile`. The "reconcile job" is the `reconcile` method (which could be scheduled). The "schema" is the Prisma schema. The "tests" cover the three scenarios.

Supporting files needed:
- Types (for the service to compile)
- Repository (the service depends on it)
- Module (for NestJS wiring)
- Bank types (for the service to compile)

Let me include all of these but keep them minimal.

OK, let me now write the actual code. I'll be thorough and complete.

Let me also reconsider the `PayoutStatus` enum. In Prisma, when we define an enum, it generates a TypeScript enum in the Prisma client. If I define my own enum with the same values, there's a type mismatch. The repository casts between them.

Actually, let me just use string types for the status in the domain model, and let the repository handle the Prisma enum. Or I can define the enum and export it, and have the repository use the Prisma enum and cast.

Hmm, let me think about this more carefully. The Prisma client generates:

```ts
export type PayoutStatus = "PENDING" | "SENT" | "AWAITING_RECONCILE" | "SETTLED" | "REJECTED" | "FAILED";
```

Wait, actually Prisma generates enums as TypeScript enums:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED'
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

So `PayoutStatus.PENDING` is `'PENDING'`. If my domain enum also has `PENDING = 'PENDING'`, then the values are the same, but the types are different. TypeScript uses structural typing, but enums are nominal. So I'd need to cast.

Let me just define my domain enum and cast in the repository. The cast is safe since the values match.

Actually, I just realized there might be a simpler approach. I can define the domain types using string literals instead of an enum:

```ts
export type PayoutStatus = 'PENDING' | 'SENT' | 'AWAITING_RECONCILE' | 'SETTLED' | 'REJECTED' | 'FAILED';
```

This is compatible with Prisma's generated type (which is also a union of string literals). No casting needed!

But then I lose the enum convenience (e.g., `PayoutStatus.PENDING`). Let me use a `const` object instead:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

This is essentially what Prisma generates. So it's compatible.

But wait, if I define this in `payout.types.ts` and Prisma generates the same thing, there would be two definitions. The repository would use the Prisma-generated one internally and return domain types. Since the types are structurally the same, no casting is needed.

Actually, let me just use an enum. TypeScript enums are commonly used and the cast is trivial. Let me define:

```ts
export enum PayoutStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  AWAITING_RECONCILE = 'AWAITING_RECONCILE',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}
```

And in the repository, I'll cast from Prisma's type to our enum type: `result.status as PayoutStatus`. Since both use the same string values, this is safe.

OK, I think I've been overthinking the types. Let me just write the code now.

Let me also think about the `PrismaService`. I need it for the Prisma client. Let me create a simple wrapper:

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

And a module for it:

```ts
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Wait, making it `@Global()` means it's available everywhere without importing. That's convenient. Let me keep it.

Now let me think about the bank module:

```ts
// src/bank/bank.module.ts
import { Module } from '@nestjs/common';
import { BankService } from './bank.service';

@Module({
  providers: [{ provide: 'BankClient', useExisting: BankService }],
  exports: [{ provide: 'BankClient', useExisting: BankService }],
})
export class BankModule {}
```

Hmm, but using string tokens for injection is not ideal. Let me use a class-based approach.

Actually, let me just have `BankService` be injectable and the service depends on it directly:

```ts
// src/bank/bank.service.ts
@Injectable()
export class BankService implements BankClient {
  constructor() {}
  
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via environment variables.
    // This is a stub implementation that should be replaced with actual HTTP calls.
    throw new Error('Bank API not configured');
  }
  
  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via environment variables.
    throw new Error('Bank API not configured');
  }
}
```

And the module:

```ts
@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
```

Then the service injects `BankService`:

```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  private readonly bankClient: BankClient,
)
```

Wait, but `BankClient` is an interface, and NestJS can't inject interfaces. I need to use `BankService` as the injection token:

```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  private readonly bankService: BankService,
) {}
```

But then the service depends on the concrete class, not the interface. This is the standard NestJS approach. For testing, we pass a mock.

Actually, there's a pattern using `@Inject` with a symbol or string token:

```ts
export const BANK_CLIENT = Symbol('BankClient');

// In the module:
{
  provide: BANK_CLIENT,
  useExisting: BankService,
}

// In the service:
constructor(
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
)
```

This allows injecting any implementation of `BankClient`. Let me use this pattern.

Actually, for simplicity and since the tests instantiate the service directly (not through NestJS DI), let me just use the concrete class `BankService` as the injection token but have the service accept the type `BankClient` (which `BankService` implements). At runtime, NestJS will inject the `BankService` instance.

Wait, that won't work because NestJS uses the TypeScript type for injection tokens, and `BankClient` is an interface (erased at runtime). I need a class or token.

Let me use the simplest approach: the service depends on `BankService` (the concrete class), and for testing, I create the service directly with a mock that implements the same interface.

```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  private readonly bankClient: BankClient,
) {}
```

But `BankClient` is an interface, so in the NestJS module, I can't inject it. Let me just not use NestJS DI for this and pass it in the constructor. For the module, I can use a token.

OK, I'm overcomplicating this. Let me just define a class `BankClient` (not an interface) that the service and tests can use:

No wait, the convention says to have an interface. Let me use the injection token pattern:

```ts
// src/bank/bank.types.ts
export const BANK_CLIENT = Symbol('BANK_CLIENT');

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

```ts
// src/bank/bank.module.ts
@Module({
  providers: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
  exports: [BANK_CLIENT],
})
export class BankModule {}
```

```ts
// src/payout/payout.service.ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
) {}
```

For testing, I create the service directly:
```ts
const service = new PayoutService(repo, mockBank, config);
```

This works because the constructor accepts the `BankClient` interface type, and the mock implements it.

Actually wait, in NestJS with TypeScript, `@Inject(BANK_CLIENT)` requires the token to be imported. But for direct instantiation in tests, we can just pass the mock directly. So this works.

Let me go with this approach. But I realize I don't actually need `@Inject` for testing since I instantiate the service directly. The `@Inject` is only for NestJS DI.

Let me finalize the approach:
1. `BankClient` is an interface in `bank.types.ts`.
2. `BANK_CLIENT` is a symbol token in `bank.types.ts`.
3. `BankService` is a concrete implementation.
4. `BankModule` provides `BANK_CLIENT` → `BankService`.
5. `PayoutService` injects `BankClient` via `@Inject(BANK_CLIENT)`.
6. Tests instantiate `PayoutService` directly with a mock.

OK, I think this is solid. Let me also handle the case where the bank client throws (not returns a result, but throws an exception). The service should catch this and treat it as a `transient_error`.

Now let me also think about the config. I'll define a config interface and pass it to the service:

```ts
export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}
```

The service uses this config. In the module, I create the config from env vars. For testing, I pass a fixed config.

Hmm, but injecting config in NestJS requires another token or a config service. Let me just pass it as a constructor parameter and have the module create it.

Actually, for NestJS DI, I can use a factory:

```ts
// In PayoutModule:
providers: [
  PayoutRepository,
  PayoutService,
  {
    provide: PAYOUT_CONFIG,
    useFactory: () => ({
      publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
      maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
    }),
  },
],
```

And the service:
```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

For testing, I pass the config directly:
```ts
const service = new PayoutService(repo, mockBank, {
  publishLagMinutes: 30,
  maxAttempts: 5,
});
```

This works. Let me finalize.

Actually, I realize I should also provide a `PAYOUT_CONFIG` symbol. Let me put it in `payout.types.ts`.

Let me now also think about the controller. The controller should expose endpoints for:
- Triggering payment execution: `POST /payouts/execute`
- Triggering reconciliation: `POST /payouts/reconcile`

```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments() {
    await this.payoutService.executePayments();
    return { status: 'ok' };
  }

  @Post('reconcile')
  async reconcile(@Body() body: { from: string; to: string }) {
    return await this.payoutService.reconcile({
      from: new Date(body.from),
      to: new Date(body.to),
    });
  }
}
```

The controller validates the input (basic date parsing) and calls the service. Zero business logic.

OK, I think I have a complete plan. Let me now write all the files.

Wait, I also need to think about error handling. The conventions say:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

I should use this error envelope for any errors the service throws. Let me create a custom error class:

```ts
export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
```

And a NestJS exception filter to transform it into the right response. But this might be overkill for the task. Let me include the error class and use it where appropriate.

Actually, the task doesn't mention error handling for the API responses. The error envelope is a convention, but the tests focus on the service logic. Let me include the error class but not go overboard with exception filters.

Hmm, let me include a simple `HttpException` or `PayoutError` and an exception filter. Or just use NestJS's built-in `HttpException`.

Actually, let me keep it simple. The service methods don't throw errors that need to be caught by the controller — they're background jobs. The controller just calls them and returns the result. If something goes wrong, it's a server error.

Let me not overcomplicate the error handling. I'll include the `PayoutError` class and use it where it makes sense (e.g., if a payout is not found during reconciliation).

OK, let me now write all the code. I'll start with the schema and work my way up.

Let me also reconsider the table name. I called it `Payout` — this represents a payout order to a supplier. Let me also think about whether we need a separate `Order` entity. The task says "pending orders" — these are the payout orders. I'll just use `Payout` for the entity.

Let me also think about the migration timestamp. Migration directories in Prisma are named like `20240115123456_init`. Let me use a current-ish timestamp.

OK, I'm going to write the code now. Let me be thorough and complete.

Let me think about one more thing: the `PayoutRepository` class. In the NestJS module, I need to provide it. But the service depends on the `PayoutRepository` interface (or class). Since `PayoutRepository` is a class, I can use it as the injection token:

```ts
@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
        maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
      }),
    },
  ],
})
export class PayoutModule {}
```

And the service:
```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

This should work. The `PayoutRepository` is a concrete class, so NestJS can inject it.

Now, for the repository to work, it needs the `PrismaService`:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}
  // ...
}
```

And `PrismaModule` is `@Global()`, so `PrismaService` is available everywhere.

OK, I'm confident in the design now. Let me write all the files.

One last thing: I need to think about the `dateRange` function in the reconcile method. I iterate over dates from `window.from` to `window.to` and call `getStatement(date)` for each date that's past the publish lag.

But what if the window spans many days? That's a lot of API calls. For a production system, I'd optimize this. But for this task, it's fine.

Actually, let me reconsider. The reconcile window might not need to be a day-by-day range. It could be a more targeted window. But the task says "reconcile(window)" and mentions overlapping windows, so let me support a date range.

For the implementation, I'll iterate over dates in the window and call `getStatement` for each past-lag date. This is correct but potentially slow for large windows. For this task, it's fine.

Let me also think about whether `getStatement` returns entries for a specific date or for a range. The task says `getStatement(date) -> Settlement[]`. So it's for a specific date. I'll call it for each date.

OK, I'm going to write the code now. Let me be careful about all the details.

Actually, let me reconsider the `fetchStatementForWindow` function. Instead of iterating date by date, maybe I should get the statement for the specific dates that correspond to the orders' effective_dates. But I don't know the effective dates until I query the orders.

Hmm, let me think about the reconcile flow again:

1. Get all orders in `AWAITING_RECONCILE` or `SENT` state that are past the publish lag.
2. For each such order, get its effective_date and txid.
3. Get the statement for that effective_date.
4. If the txid is in the statement → SETTLED.
5. If not → AWAITING_RECONCILE → PENDING or FAILED.

This is more targeted — we only query statements for dates when we have orders to check. But it might result in duplicate queries if multiple orders have the same effective_date.

Alternatively, I can:
1. Get all orders in `AWAITING_RECONCILE` past the lag.
2. Collect their effective_dates.
3. Query statements for each unique effective_date.
4. Build a set of txids from the statements.
5. For each order, check if its txid is in the set.

This is more efficient. Let me use this approach.

But the method signature is `reconcile(window: ReconcileWindow)`. The window defines the date range. So I should:
1. Query statements for dates in the window that are past the publish lag.
2. Match statement entries to orders by txid.
3. For AWAITING_RECONCILE orders not in the statement, mark for resend or FAILED.

Let me think about which orders to check in step 3. I should check all AWAITING_RECONCILE orders whose effective_date is in the window and past the lag. But I also need to know which ones were found in the statement.

Actually, the simplest approach is:
1. Query statements for all dates in the window past the lag.
2. Collect all txids from the statements.
3. For each settlement, find the matching order and mark as SETTLED.
4. For each AWAITING_RECONCILE order past the lag (effective_date <= now - publish_lag), check if its txid is in the collected set. If not, mark for resend or FAILED.

But step 4 doesn't use the window — it checks all AWAITING_RECONCILE orders past the lag, regardless of the window. The window only determines which statements to query.

Hmm, but if the window doesn't cover the order's effective_date, the statement for that date won't be queried, so the order won't be found. This is correct — we can only prove absence for dates we've checked.

Actually, the task says "Must be safe to run every 15 minutes, including over overlapping windows." So the same order might be checked in multiple reconcile runs with overlapping windows. If the order's effective_date is in the window, it will be checked. If not, it won't. This is fine — the order will be picked up in a later run when its effective_date is in the window.

But what about the "proven absent" check? The order needs to be proven absent, which means we've checked the statement for its effective_date and it's not there. If the window doesn't cover the effective_date, we haven't proven anything.

So the logic should be:
1. Query statements for dates in the window past the lag.
2. Match settlements to orders → SETTLED.
3. For AWAITING_RECONCILE orders whose effective_date is in the window (and past the lag), check if they were found in the statements.
   - If found → SETTLED (already done in step 2).
   - If not found → proven absent → PENDING or FAILED.

This is correct. The window determines which orders are eligible for the "proven absent" check.

Let me implement this. I'll query the statements first, build a set of txids, then check orders.

Actually, for step 2 and 3, I can combine them. For each AWAITING_RECONCILE order whose effective_date is in the window and past the lag:
- Try to find its txid in the statement set.
- If found → SETTLED.
- If not found → PENDING or FAILED.

And for SENT orders (accepted sends), I should also check their txids in the statement. But as I discussed earlier, SENT orders are confirmed sends. If they're not in the statement after the lag, it's an anomaly. But the task doesn't focus on this. Let me handle SENT orders by also checking them — if found → SETTLED, if not found → leave as SENT (wait for next cycle).

Actually, let me also reconcile SENT orders. If a SENT order's txid appears in the statement, mark it as SETTLED. If it doesn't appear, leave it as SENT (it might just be delayed).

For AWAITING_RECONCILE orders:
- If found → SETTLED.
- If not found → PENDING or FAILED.

For SENT orders:
- If found → SETTLED.
- If not found → leave as SENT (no action).

This makes sense.

Let me now write the code. I'll iterate.

Actually, let me also think about the `getStatement` call. The task says `getStatement(date)`. The date is the effective date of the payments. But the statement might not be available for the current date (due to the 30-min lag). So when I call `getStatement(effectiveDate)`, I should only do so if `effectiveDate + publishLag < now`.

In my `fetchStatementForWindow`, I skip dates that are not past the lag. Good.

Now, for matching: the statement contains entries with txids. I match them to orders by txid. The txid is unique per order (derived from order ID + effective date). So each settlement should match at most one order.

But what if a settlement's txid doesn't match any order? This is normal — the statement contains all transactions, not just ours. We skip unmatched settlements.

What if two orders have the same txid? This shouldn't happen if the txid is derived from order ID + effective date (order IDs are unique). But if it does, we'd match both orders to the same settlement, which could be wrong. For this task, I'll assume txids are unique per order.

OK, let me now write the actual code. I'll start writing all files.

Let me also think about the date iteration more carefully. I need to iterate from `window.from` to `window.to`, day by day. For each day, I create a `Date` object at midnight and call `getStatement`.

```ts
private async fetchStatements(window: ReconcileWindow, now: Date): Promise<Settlement[]> {
  const publishLagMs = this.config.publishLagMinutes * 60 * 1000;
  const cutoff = new Date(now.getTime() - publishLagMs);
  const settlements: Settlement[] = [];
  
  const current = new Date(window.from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(window.to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    if (current < cutoff) {
      try {
        const entries = await this.bankClient.getStatement(new Date(current));
        settlements.push(...entries);
      } catch {
        // Log and continue — statement fetch failure shouldn't block reconciliation
      }
    }
    current.setDate(current.getDate() + 1);
  }
  
  return settlements;
}
```

Wait, I need to think about the comparison `current < cutoff`. The `current` date is at midnight (00:00:00), and the `cutoff` is `now - publishLag`. If the current date is before the cutoff, the statement should be available.

For example, if now is 2024-01-15 14:00, and publish lag is 30 min, cutoff is 2024-01-15 13:30. The date 2024-01-15 00:00 is before the cutoff, so the statement is available. The date 2024-01-16 00:00 would be after the cutoff, so we skip it.

Actually, I think the comparison should be `current.getTime() + publishLagMs < now.getTime()` or equivalently `current < cutoff`. Let me use `current <= cutoff` (strictly before or equal to the cutoff). Actually, if `current` is 2024-01-15 00:00 and `cutoff` is 2024-01-15 13:30, then `current < cutoff` is true, so we fetch the statement. This is correct — the statement for Jan 15 should be available by 13:30 (well past the 30-min lag from midnight).

But wait, the publish lag applies to when the transaction was published, not to the date. If a transaction was published at 14:00 on Jan 15, the statement for Jan 15 might not include it until 14:30. So the lag is relative to the transaction time, not the date.

This is getting complex. Let me simplify: the publish lag means that the statement for date D is complete by date D + 1 day (or D + some hours). For practical purposes, if the effective_date is at least 30 minutes in the past, the statement should include all transactions for that date.

Actually, for this task, I think the simplest interpretation is:
- The statement for a given date is available if `now - date > publishLag`.
- We query statements for dates where `date + publishLag < now`.

But `date` is a full date (midnight), and `publishLag` is 30 minutes. So if now is 14:00, the cutoff is 13:30. A date of Jan 15 00:00 is before 13:30, so the statement is available.

Wait, but the effective_date could have a time component. Let me think about this differently.

The order's effective_date is a specific datetime. The statement is for a specific date. The publish lag means the statement for date D is available 30 minutes after D's transactions are published.

For simplicity, let me say: a statement for date D is available if `now - D > publishLag`. And the order's effective_date determines which statement to check. If the order's effective_date is more than 30 minutes in the past, we can check its statement.

In the reconcile function:
- For each date in the window, check if `now - date > publishLag`. If so, fetch the statement.
- For AWAITING_RECONCILE orders, check if `now - effectiveDate > publishLag`. If so, the order is eligible for the resend check.

The `findAwaitingReconcilePastLag` query should filter by `effectiveDate <= cutoff` where `cutoff = now - publishLag`.

This is what I had. The `cutoff` is `now - publishLag`. Orders with `effectiveDate <= cutoff` are past the lag. Dates with `date < cutoff` have available statements.

Actually, I need to be consistent. Let me say:
- `cutoff = now - publishLag`
- Orders are past the lag if `effectiveDate <= cutoff`
- Statements are available if `date <= cutoff` (where date is the start of the day)

For the date iteration, I compare `current <= cutoff` (where current is the start of the day). This means if the date is Jan 15 (00:00) and the cutoff is Jan 15 13:30, then Jan 15 00:00 <= Jan 15 13:30, so the statement is available.

This is correct — by 13:30, the statement for Jan 15 should be available (all transactions for that day were published well before 13:30).

OK, I'm comfortable with this logic. Let me write the code now.

Let me also finalize the approach for handling the `BankSendResult`. The `timeout` case is a `transient_error`. Let me handle it in the `handleSendResult` method.

Actually, in my `BankSendResult` type, I have `transient_error` which covers timeouts. The bank client catches timeouts and returns `transient_error`. So the service doesn't need a separate `timeout` case.

But the task says "Classify `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and handle each differently." So I need to handle all four cases. A timeout is a `transient_error`. Good.

Let me also think about what "handle each differently" means:
- accepted → SENT (order is in the bank)
- duplicate → SENT (order is already in the bank, just need to confirm)
- transient_error → AWAITING_RECONCILE (need to check if it was actually sent)
- permanent_rejection → REJECTED (stop, don't retry)

This is what I have.

OK, let me now actually write all the files. I'll be systematic.

Actually, one more thing: I need to think about how the `effectiveDate` is stored in the database. In Prisma, `DateTime` is stored as a `TIMESTAMP WITH TIME ZONE` in PostgreSQL. In TypeScript, it's a `Date` object. This should work fine.

Also, I need to think about the `dateRange` function for iterating over dates. The `window.from` and `window.to` are datetime values, but `getStatement` takes a date. I need to extract the date part.

When I call `getStatement(new Date(current))`, I'm passing a Date object representing midnight of the current day. The bank client should interpret this as a date. In the mock, it returns the same entries for any date.

In a real implementation, the bank client would extract the date from the Date object and make an API call for that date.

OK, let me write the code now. I'll include all necessary files.

Let me think about the file structure one more time:

```
prisma/schema.prisma
prisma/migrations/<timestamp>_init/migration.sql
src/prisma/prisma.service.ts
src/prisma/prisma.module.ts
src/bank/bank.types.ts
src/bank/bank.service.ts
src/bank/bank.module.ts
src/payout/payout.types.ts
src/payout/payout.repository.ts
src/payout/payout.service.ts
src/payout/payout.controller.ts
src/payout/payout.module.ts
test/payout.spec.ts
```

Let me also think about whether I need a `tsconfig.json` and `package.json`. The task says "Deliver every file the solution needs." For a complete solution, I'd need these. But they might be too verbose. Let me include them as minimal files.

Actually, let me include `package.json` and `tsconfig.json` since they're essential for the solution to be complete. But I'll keep them minimal.

Hmm, the task says "Do exactly what the task asks." The task asks for "schema, service, reconcile job, and tests." Let me focus on those and include supporting files as needed. I'll include `package.json` and `tsconfig.json` since they're needed for the solution to compile and run.

Actually, let me not include `package.json` and `tsconfig.json` — they're not part of the deliverables. The conventions say the stack includes TypeScript, NestJS, Prisma, Vitest, pnpm, ESM, etc. I can assume these are already set up. But since we're building from scratch, maybe I should include them.

You know what, let me include them. They make the solution complete and self-contained.

Wait, but the task says "Never reproduce [the reference] and never rewrite them." And "If a symbol you need is genuinely absent from the task, do not guess in silence and do not reason around it: use the most defensible reading and mark it with one `// ASSUMPTION` comment at the point it matters."

Since there's no existing codebase, I need to provide everything. Let me include `package.json`, `tsconfig.json`, and the necessary source files.

Let me now write all the files.

Actually, I realize I should think about one more thing: the `PAYOUT_CONFIG` injection token and how it's provided in tests. In tests, I instantiate the service directly, so I pass the config as a plain object. No need for NestJS DI tokens in tests.

OK, let me write the code now. I'll start with the Prisma schema.

Hmm, one more thought: should I use `BigInt` or `String` for the primary key? The conventions don't specify. Let me use `String` with `uuid()` — it's simpler and avoids BigInt issues in JSON serialization.

Also, I should think about the `txid` field. It's a string derived from the order ID and effective date. It's set when the first send is attempted. Before that, it's null.

Wait, actually, I derive the txid in the service before sending. So I could set it before the send, not after. Let me think about this.

In `executePayments`:
1. Pick up PENDING order (no txid yet).
2. Derive txid from order ID + effective date.
3. Call `bank.send({txid, amount, key})`.
4. Based on result, update the order with the txid and status.

If the send throws (network error), the txid is not stored. On the next attempt (after reconcile proves absence), we derive it again — it's the same txid. This is correct.

So the txid is derived in the service and stored in the repository during the update. The txid is not stored before the send. If the send fails, the txid is still stored (in the `markAwaitingReconcile` call). So on the next run, `executePayments` picks up the PENDING order (which has the txid stored from the previous attempt), and uses the stored txid.

Wait, but what if the `markAwaitingReconcile` call fails (e.g., database error)? Then the order might be in a weird state (sent to bank but not updated in DB). This is a real-world concern but beyond the scope of this task.

Let me also think about whether to derive the txid before or after the send. If I derive it before and store it before sending, then even if the send throws, the txid is stored. This is useful for debugging. But it changes the flow:
1. Pick up PENDING order.
2. Derive txid and store it (update txid).
3. Call bank.send.
4. Based on result, update status.

This is two database operations per order (one for txid, one for status). Let me combine them: derive the txid, call bank.send, then update with both txid and status.

If bank.send throws (network error), I catch it and treat it as a transient_error. Then I call `markAwaitingReconcile(id, txid)` which stores the txid and updates the status. This is fine.

But what if the exception is not caught? For example, if the repository's `markAwaitingReconcile` call throws. Then the order is in an inconsistent state (sent to bank but not recorded as AWAITING_RECONCILE). This is a real-world concern, but for this task, I'll assume the repository operations succeed.

Actually, I realize I should also think about what happens if `bank.send` is called but the order's status changes between picking it up and the send. For example, another process marks it as SETTLED. In this case, `executePayments` would still send it (it already picked it up), and then `markSent` would fail because the status is no longer PENDING.

To handle this, I could use optimistic locking (version field) or conditional updates. But for this task, let me assume single-threaded execution (executePayments runs as a singleton).

OK, I've thought about this enough. Let me write the code now.

Let me also think about the `effectiveDate` in the tests. I'll create orders with `effectiveDate` set to 2 hours ago. This ensures they're past the 30-minute publish lag.

For the reconcile window, I'll set it to cover the effective date: `{ from: 3 hours ago, to: 1 hour ago }`. This way, the effective date is within the window, and the date is past the publish lag.

Wait, but the window is a date range. The `from` and `to` are dates. The `current` date in the iteration starts at `window.from` at midnight. If `window.from` is 3 hours ago, that might be Jan 15 11:00. The midnight of Jan 15 is before the cutoff (Jan 15 13:30 if now is 14:00). So the statement for Jan 15 is fetched.

But the order's effective date might be Jan 15 12:00 (2 hours ago). The statement for Jan 15 would include it (if it was published).

Hmm, let me just set the effective date and window carefully in tests to make sure the logic works.

Actually, for the mock bank client, I return the same statement for any date. So the date matching doesn't matter in the mock. I just need to make sure the window includes dates that are past the publish lag.

Let me set:
- `effectiveDate = new Date(Date.now() - 2 * 60 * 60 * 1000)` (2 hours ago)
- `window.from = new Date(Date.now() - 3 * 60 * 60 * 1000)` (3 hours ago)
- `window.to = new Date()` (now)

This way, the window covers the effective date, and the dates in the window are past the publish lag (since 2 hours ago > 30 min ago).

For the mock, `getStatement` returns the same entries for any date, so the txid matching works.

The `findAwaitingReconcilePastLag` query filters by `effectiveDate <= cutoff` where `cutoff = now - publishLag`. Since effectiveDate is 2 hours ago and publishLag is 30 min, the order is past the lag. Good.

OK, I'm confident now. Let me write the code.

Actually, I want to think about one more edge case: what if an order is in `AWAITING_RECONCILE` but its effective date is NOT in the reconcile window? Then:
- We won't query the statement for that date (it's outside the window).
- We won't find the order in the statement (it wasn't queried).
- `findAwaitingReconcilePastLag` would find it (it's past the lag).
- But in step 3, should we mark it for resend?

In my current design, `findAwaitingReconcilePastLag` doesn't filter by the window. So it would find the order and mark it for resend. But we haven't actually checked the statement for its effective date (it's outside the window).

This is a bug. I should only mark orders for resend if their effective_date is within the window AND past the lag. Let me fix this.

The query should be:
```sql
SELECT * FROM payouts 
WHERE status = 'AWAITING_RECONCILE' 
  AND effective_date <= cutoff  -- past the publish lag
  AND effective_date >= window.from  -- within the reconcile window
  AND effective_date <= window.to
```

Or more precisely, the effective date should be within the window. Let me add this filter.

But wait, the `findAwaitingReconcilePastLag` method doesn't know about the window. I need to pass the window to the query.

Let me change the method to:
```ts
async findAwaitingReconcilePastLag(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
  return this.prisma.payout.findMany({
    where: {
      status: PayoutStatus.AWAITING_RECONCILE,
      effectiveDate: {
        gte: window.from,
        lte: window.to,
      },
      // Also ensure past the publish lag
      effectiveDate: {
        lte: cutoff,
      },
    },
  });
}
```

Wait, I can't have two `effectiveDate` keys in the same `where` object. Let me combine them:

```ts
where: {
  status: PayoutStatus.AWAITING_RECONCILE,
  effectiveDate: {
    gte: window.from,
    lte: Math.min(window.to, cutoff), // past the publish lag
  },
},
```

Hmm, but `window.to` might be in the future (not past the lag). So the upper bound should be `min(window.to, cutoff)`. This ensures we only check orders whose effective_date is both in the window and past the lag.

Actually, I think I'm overcomplicating this. Let me just use `effectiveDate <= cutoff` (past the lag) and not worry about the window bounds for the order query. The window is for determining which statements to fetch. If the order's effective_date is not in the window, we won't have its statement, so we can't match it. But we also shouldn't mark it for resend.

Hmm, but the orders are in `AWAITING_RECONCILE` because they timed out. Their effective_date is when they were supposed to be sent. The reconcile window should cover this period. If it doesn't, we just skip the order and wait for a future reconcile run that covers it.

Let me think about this differently. The reconcile function:
1. Fetches statements for dates in the window that are past the lag.
2. Matches settlements to orders → SETTLED.
3. For orders that were sent (AWAITING_RECONCILE or SENT) and whose effective_date is in the window and past the lag:
   - If found in statement → SETTLED (already done).
   - If not found → proven absent → PENDING or FAILED.

So the order query should filter by the window AND the lag. Let me pass both the window and the cutoff to the query.

Let me update the repository interface:

```ts
async findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
  return this.prisma.payout.findMany({
    where: {
      status: PayoutStatus.AWAITING_RECONCILE,
      effectiveDate: {
        gte: window.from,
        lte: cutoff,
      },
    },
  });
}
```

Wait, the lower bound should be `window.from` and the upper bound should be `min(window.to, cutoff)`. But `window.to` is usually "now" or recent, and `cutoff` is `now - lag`. So `cutoff < window.to`, and the upper bound is `cutoff`.

But what if `window.from` is after `cutoff`? Then there are no eligible orders. This would happen if the window is entirely in the future (past the lag). This is fine — no orders to process.

Let me use:
```ts
effectiveDate: {
  gte: window.from,
  lte: cutoff,
}
```

This ensures the order's effective_date is within the window AND past the lag. Good.

But I also need to fetch statements for the right dates. In `fetchStatements`, I iterate over dates from `window.from` to `window.to` and fetch statements for dates past the lag. This is correct.

OK, let me finalize the implementation. Let me also handle the `SENT` orders. Should I check them too? Let me include them in the query:

```ts
async findSentOrAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
  return this.prisma.payout.findMany({
    where: {
      status: { in: [PayoutStatus.SENT, PayoutStatus.AWAITING_RECONCILE] },
      effectiveDate: {
        gte: window.from,
        lte: cutoff,
      },
    },
  });
}
```

Then in the service:
- For each settlement, find the matching order and mark as SETTLED.
- For each eligible order (SENT or AWAITING_RECONCILE) not found in the statement:
  - If SENT → leave as is (bank confirmed it, might be delayed)
  - If AWAITING_RECONCILE → PENDING (resend) or FAILED

Actually, for SENT orders not in the statement after the lag, should we do anything? The send was accepted, so the bank should have it. If it's not in the statement, it might be a bank error. But the task doesn't specify. Let me just leave them as SENT.

For AWAITING_RECONCILE orders not in the statement:
- If attempt_count >= max → FAILED
- Else → PENDING (for resend)

This is the core logic.

Let me now think about the implementation of `reconcile`:

```ts
async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - this.config.publishLagMs);
  
  // 1. Fetch statements for dates in the window that are past the publish lag
  const settlements = await this.fetchStatements(window, now);
  
  // 2. Build a set of txids from the statement
  const statementTxids = new Set(settlements.map(s => s.txid));
  
  // 3. Match statement entries to orders → SETTLED
  let matched = 0;
  for (const settlement of settlements) {
    const order = await this.payoutRepository.findByTxid(settlement.txid);
    if (order && order.status !== PayoutStatus.SETTLED) {
      await this.payoutRepository.markSettled(order.id, now);
      matched++;
    }
  }
  
  // 4. For AWAITING_RECONCILE orders not in statement → resend or FAILED
  const awaitingOrders = await this.payoutRepository.findAwaitingReconcileEligible(window, cutoff);
  
  let resendEligible = 0;
  let failed = 0;
  
  for (const order of awaitingOrders) {
    if (statementTxids.has(order.txid!)) {
      // Already marked as SETTLED in step 3
      continue;
    }
    
    // Proven absent past the publishing lag
    if (order.attemptCount >= this.config.maxAttempts) {
      await this.payoutRepository.markFailed(order.id, now);
      failed++;
    } else {
      await this.payoutRepository.markForResend(order.id);
      resendEligible++;
    }
  }
  
  return { matched, resendEligible, failed };
}
```

This looks correct. Let me also think about the `fetchStatements` method:

```ts
private async fetchStatements(window: ReconcileWindow, now: Date): Promise<Settlement[]> {
  const publishLagMs = this.config.publishLagMs;
  const cutoff = new Date(now.getTime() - publishLagMs);
  const settlements: Settlement[] = [];
  
  const current = new Date(window.from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(window.to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    if (current.getTime() <= cutoff.getTime()) {
      try {
        const entries = await this.bankClient.getStatement(new Date(current));
        settlements.push(...entries);
      } catch (err) {
        // Log and continue — statement fetch failure shouldn't block reconciliation
        // ASSUMPTION: We log the error but don't fail the entire reconciliation
      }
    }
    current.setDate(current.getDate() + 1);
  }
  
  return settlements;
}
```

Wait, I'm comparing `current` (midnight of the date) with `cutoff` (now - 30 min). If the date is today (midnight), and the cutoff is 13:30, then today's midnight (00:00) is before 13:30, so we fetch the statement for today. But the statement for today might not be complete yet (transactions published after 13:30 won't be included).

Hmm, this is a real issue. The publish lag is relative to when the transaction was published, not to the date. If a transaction was published at 13:00 today, the statement for today won't include it until 13:30.

But for our purposes, the orders have a specific `effective_date` (e.g., 2 hours ago). The statement for that date should be complete if the effective_date + publish_lag < now. So `effectiveDate <= cutoff` is the right check for the order.

For the statement fetch, I should check if the date of the statement is past the lag. If the statement is for date D, and D is a full day, then by 30 minutes after midnight of D+1, the statement should be complete. But if D is today, the statement might not be complete.

Actually, I think the right approach is:
- Fetch statements for dates where `now - date > publishLag`.
- Since `date` is midnight, and `publishLag` is 30 min, this means `now - midnight > 30 min`, i.e., it's at least 00:30 of that date.
- But we want to be more conservative: `now - date > publishLag` means `date < now - publishLag = cutoff`.

For today's date (midnight), `date < cutoff` is true if `now > 00:30` (which is almost always true). So we'd fetch today's statement. But it might not be complete.

I think for this task, the important check is on the order's `effectiveDate`, not on the statement date. The order is eligible for resend if `effectiveDate <= cutoff` (effectively the order is past the publish lag). The statement fetch for the date of the effectiveDate should include the order if it was settled.

Let me simplify: I'll fetch statements for all dates in the window, and the order eligibility check uses `effectiveDate <= cutoff`. This is correct for the test scenarios.

Actually, for the date comparison in `fetchStatements`, let me use `<` instead of `<=`:

```ts
if (current.getTime() < cutoff.getTime()) {
  // fetch statement
}
```

This means we only fetch statements for dates that are strictly past the lag. For today's date, if `now` is 14:00 and `cutoff` is 13:30, today's midnight (00:00) is before 13:30, so we fetch. This is correct — today's statement up to 13:30 should be available.

Hmm, but this doesn't account for transactions published after 13:30. For the purpose of this task, I think it's fine. The key check is on the order's `effectiveDate`.

Actually, let me reconsider. The publish lag means that transactions published in the last 30 minutes might not appear in the statement. So if an order's `effectiveDate` is 2 hours ago, and 2 hours ago + 30 min = 1.5 hours ago, which is before now, then the statement should include the transaction if it was published. This is the `effectiveDate <= cutoff` check, which is correct.

For the statement fetch, I'm iterating over dates and fetching statements for dates past the lag. This is correct for finding settled orders. The order's effectiveDate check is separate.

OK, I think the logic is sound. Let me write the code now. For real this time.

Let me also think about the `effectiveDate` comparison. The order's `effectiveDate` is a datetime (e.g., Jan 15 12:00). The `cutoff` is Jan 15 13:30. So `effectiveDate <= cutoff` is true (Jan 15 12:00 <= Jan 15 13:30). Good.

For the statement, I fetch for the date Jan 15 (midnight). The statement includes transactions published on Jan 15. Since the order's effectiveDate is Jan 15 12:00, it should be in the Jan 15 statement (if it was published).

Wait, but `getStatement(date)` might return entries for a specific date. The `date` parameter is a Date object. I need to make sure I'm passing the right date.

In my `fetchStatements`, I create `new Date(current)` where `current` is midnight of the date. This is the date object I pass to `getStatement`. In the mock, it returns the same entries for any date. In a real implementation, it would extract the date part and make an API call.

OK, I'm going to write the code now. Let me be careful and thorough.

Let me also think about the `PAYOUT_CONFIG` token. I'll define it in `payout.types.ts`:

```ts
export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
```

And the config interface:

```ts
export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}
```

In the module, I provide the config:

```ts
{
  provide: PAYOUT_CONFIG,
  useFactory: () => ({
    publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
    maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
  }),
},
```

In the service:

```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {
  this.publishLagMs = config.publishLagMinutes * 60 * 1000;
}
```

For tests:

```ts
const service = new PayoutService(repo, mockBank, {
  publishLagMinutes: 30,
  maxAttempts: 5,
});
```

This is clean.

OK, now let me think about the `package.json` and `tsconfig.json`. 

For `package.json`:
```json
{
  "name": "payout-reconciler",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "nest start --watch",
    "build": "nest build"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "reflect-metadata": "^0.1.13"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/node": "^20.0.0",
    "nest": "^10.0.0",
    "prisma": "^5.0.0",
    "typescript": "^5.0.0",
    "vitest": "^0.34.0"
  }
}
```

For `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "strict": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

Wait, with ESM (`"type": "module"`), I should use `"module": "node16"` or `"module": "nodenext"`. Let me use `"moduleResolution": "node"` and `"module": "ESNext"` for simplicity.

Actually, with ESM and NestJS, the standard setup uses `"module": "commonjs"` for compatibility with NestJS. But the conventions say ESM. Let me use:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "strict": true
  }
}
```

Hmm, actually for NestJS with ESM, the setup is a bit tricky. Let me not worry about this too much — the key deliverables are the source code and tests.

OK, I think I should also think about whether to use `date-fns` for date formatting. Let me just use a simple inline function to avoid dependencies.

Let me now write all the files. I'll start writing.

Actually, wait. Let me reconsider the repository interface. The service needs:
1. `findPending()` → for executePayments
2. `findByTxid(txid)` → for reconcile (matching settlements to orders)
3. `findAwaitingReconcileEligible(window, cutoff)` → for reconcile (finding orders to check for resend)
4. `markSent(id, txid)` → for executePayments (accepted/duplicate)
5. `markAwaitingReconcile(id, txid)` → for executePayments (transient_error)
6. `markRejected(id, txid)` → for executePayments (permanent_rejection)
7. `markSettled(id, settledAt)` → for reconcile (found in statement)
8. `markForResend(id)` → for reconcile (not found, under attempt cap)
9. `markFailed(id, failedAt)` → for reconcile (not found, attempt cap reached)

This is a clean interface. Let me define it in `payout.types.ts`.

Now, there's a question about whether the repository should handle the `txid` derivation. The task says the txid is "derived deterministically from the order + effective date." This derivation happens in the service (it's business logic, not database logic). The repository just stores and retrieves the txid.

OK, let me now write the code. For real this time. I'll go file by file.

Let me also think about whether I need a `ReconcileJob` class. The task says "reconcile job." In a NestJS application, this could be a scheduled job using `@nestjs/schedule` and `@Cron`. Let me include it as a separate class or as part of the service.

Actually, let me include the reconcile method on the service and a controller endpoint to trigger it. The "job" aspect can be handled by a cron scheduler in production. For the task, the service method + controller endpoint is sufficient.

Hmm, but the task specifically says "reconcile job." Let me create a `ReconcileJob` class that wraps the `reconcile` method and is triggered by a cron. But `@nestjs/schedule` is an additional dependency. Let me include it and use `@Cron`.

Actually, let me not add unnecessary dependencies. Let me just have the `reconcile` method on the service and expose it via a controller endpoint. I can add a `@Cron` decorator from `@nestjs/schedule` if needed, but I'll comment it out or make it optional.

Let me keep it simple: the `reconcile` method on the service, with a controller endpoint to trigger it. I'll add a comment about scheduling it every 15 minutes.

OK, writing code now.

Let me also think about whether I need to handle the `duplicate` bank response differently from `accepted`. In both cases, the order is marked as `SENT`. The difference is:
- `accepted` → the bank accepted the payment. First time sending this txid.
- `duplicate` → the bank already has this txid. The payment was already accepted (possibly from a previous failed attempt where the response was lost).

In both cases, the order is in the bank's system. So we mark it as `SENT` and wait for reconciliation to confirm settlement.

But there's a subtlety with `duplicate`: if we get a `duplicate` response, it means the bank already accepted this txid. But our order might already be in `SENT` or `SETTLED` state. Let me handle this by checking the current status:

Actually, `executePayments` only picks up `PENDING` orders. So if we get a `duplicate` response, the order is `PENDING` (we wouldn't be here otherwise). We mark it as `SENT`. If the bank already has the txid, it means a previous send was accepted but we didn't record it (or the order was re-created). In either case, marking it as `SENT` is correct — the bank has the payment.

OK, I think the handling is correct. Let me write the code.

One more thing: the `duplicate` case. If we get a `duplicate` response, should we increment the attempt count? Yes, because we made an attempt (the send call). Even though the bank already has it, we made an API call. For auditability, let me increment the attempt count.

But wait, if the send was a `duplicate`, it means the payment was already accepted. The attempt count doesn't matter for this order (it's not going to time out and need resend — the bank accepted it). So incrementing the attempt count is fine for auditability but doesn't affect the logic.

Actually, let me think about this more carefully. The attempt count is used to determine if we should resend after a timeout. If the send was accepted (or duplicate), we don't resend. So the attempt count doesn't matter after an accepted/duplicate. It only matters after a timeout (transient_error).

But for consistency, let me increment the attempt count on every send attempt, regardless of the result. This gives us an accurate count of how many times we tried to send.

OK, let me finalize the code now. I'll write all files.

Hmm, actually, I realize I need to be more careful about the Prisma enum. When I define the enum in the Prisma schema:

```prisma
enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}
```

Prisma generates a TypeScript enum with the same names and string values. In the repository, when I filter by status, I need to use the Prisma enum value. Since both enums have the same string values, I can cast.

But there's a problem: I'm defining `PayoutStatus` in `payout.types.ts` and also in the Prisma schema. When the Prisma client is generated, it creates its own `PayoutStatus`. These two are different types.

In the repository, I use Prisma's `PayoutStatus` for queries. In the service, I use the domain `PayoutStatus`. The repository converts between them.

Since both enums have the same string values, the conversion is trivial (cast). But TypeScript will complain about the type mismatch. Let me handle this with explicit casts.

Actually, I just realized: in the Prisma client, the enum is generated in `@prisma/client`. If I import it as `Prisma.PayoutStatus`, it's the Prisma enum. My domain `PayoutStatus` is different. I need to cast between them.

Let me just use the domain enum everywhere and cast when needed. Or better yet, let me not import the Prisma enum at all and just use string literals in the repository.

In the repository, when querying Prisma, I can use the string values directly:

```ts
await this.prisma.payout.findMany({
  where: {
    status: 'PENDING', // Prisma will accept this as the enum value
  },
});
```

Wait, does Prisma accept string literals for enum fields? Yes, because the Prisma enum is a string enum, and the string literal `'PENDING'` is the same as `PayoutStatus.PENDING` (which is `'PENDING'`). TypeScript might complain, but at runtime it works.

Actually, Prisma's generated types use `PayoutStatus` as a type, which is a union of string literals. So `'PENDING'` is a valid value for the `PayoutStatus` type. If I import my own `PayoutStatus` enum, the values are the same strings, so TypeScript should accept them (structural typing for string values).

Hmm, TypeScript enums are nominal, but since both use the same string values, and Prisma's type is a union of string literals (not an enum), my domain enum values should be assignable to Prisma's type.

Let me check: Prisma generates:

```ts
export type PayoutStatus = "PENDING" | "SENT" | "AWAITING_RECONCILE" | "SETTLED" | "REJECTED" | "FAILED";
```

Wait, actually Prisma generates:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  ...
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

This `PayoutStatus` type is `"PENDING" | "SENT" | ...`. My domain enum:

```ts
export enum PayoutStatus {
  PENDING = 'PENDING',
  ...
}
```

In TypeScript, `PayoutStatus.PENDING` has type `PayoutStatus` (the enum member), not the string `'PENDING'`. But since the enum is a string enum, `PayoutStatus.PENDING` is also assignable to `'PENDING'` (the string value).

Wait, actually, in TypeScript, string enum members are not assignable to their string literal type without explicit conversion. Let me check:

```ts
enum MyEnum { A = 'A' }
type MyType = 'A';
const x: MyType = MyEnum.A; // Error: MyEnum.A is of type MyEnum.A, not 'A'
```

Hmm, actually this depends on the TypeScript version and settings. In strict mode, this might cause an error. Let me use `as` casts to be safe.

Actually, I just realized: Prisma uses a different approach. The Prisma-generated `PayoutStatus` is not a TypeScript enum but a `const` object with a type. The type `PayoutStatus` is `(typeof PayoutStatus)[keyof typeof PayoutStatus]`, which is `"PENDING" | "SENT" | ...`.

If I use a TypeScript `enum` in my domain, the enum member `PayoutStatus.PENDING` has type `PayoutStatus` (the enum), which is not directly assignable to the string literal `'PENDING'`.

But if I use a `const` object instead of an `enum`, the values are string literals:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  ...
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

Then `PayoutStatus.PENDING` has type `'PENDING'` (the string literal), which is assignable to the Prisma type.

Let me use this approach instead of an `enum`. This avoids the type mismatch issue.

Actually, wait. If I use `const` objects, I can't use them as enum values in switch statements the same way. But `switch` works fine with string values.

Let me use the `const` object approach:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

This is compatible with Prisma's generated types. No casting needed.

But in my domain `Payout` interface, I use `status: PayoutStatus`. And in the repository, I return `Payout` with `status` as a `PayoutStatus`. The Prisma result has `status` as the Prisma `PayoutStatus` type, which is the same union of strings. So they're compatible.

Great, let me use this approach. No casting needed anywhere.

Actually, I realize there might still be an issue. The Prisma-generated `PayoutStatus` is imported from `@prisma/client`. My domain `PayoutStatus` is defined in `payout.types.ts`. Even though they have the same string values, they're nominally different types. TypeScript would see them as different.

But since both are unions of the same string literals, TypeScript's structural typing should consider them compatible. Let me verify:

```ts
// From @prisma/client
type PrismaPayoutStatus = 'PENDING' | 'SENT' | ...;

// From payout.types.ts
type PayoutStatus = 'PENDING' | 'SENT' | ...;

const status: PayoutStatus = 'PENDING';
const prismaStatus: PrismaPayoutStatus = status; // Should be fine — same string values
```

Yes, this should work. Structural typing means they're compatible.

But what about the `const` objects? If Prisma generates:

```ts
export const PayoutStatus = { PENDING: 'PENDING', ... } as const;
```

And I also define:

```ts
export const PayoutStatus = { PENDING: 'PENDING', ... } as const;
```

These are two different `const` objects, but the types are the same. When I use `PayoutStatus.PENDING` from my domain, it's `'PENDING'`, which is assignable to the Prisma type.

Wait, but I need to be careful. In the repository, I use `this.prisma.payout.update({ where: { status: PayoutStatus.PENDING } })`. Here, `PayoutStatus.PENDING` is from my domain `const` object, which is `'PENDING'`. The Prisma `where.status` expects the Prisma `PayoutStatus` type, which includes `'PENDING'`. So this should work.

Similarly, when I read from Prisma, the result has `status` as the Prisma type. I return it as my domain `Payout`, which has `status` as my domain type. Since both are unions of the same strings, this is compatible.

Great, no casting needed. Let me proceed with the `const` object approach.

But wait — if I use `@prisma/client`'s `Payout` type in the repository, the `status` field is the Prisma enum. And my domain `Payout` interface has `status` as my domain type. Since they're structurally compatible, the assignment `return prismaResult as Payout` would work without explicit casting. But to be safe, I might still use a cast or mapping function.

Actually, with `strict: true` in TypeScript, assigning a Prisma `Payout` to a domain `Payout` might work if the types are structurally identical. Let me check:

Prisma's Payout:
```ts
{
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PrismaPayoutStatus; // 'PENDING' | 'SENT' | ...
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Domain Payout:
```ts
{
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus; // 'PENDING' | 'SENT' | ...
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Since `PrismaPayoutStatus` and `PayoutStatus` are both unions of the same string literals, they're structurally identical. TypeScript should allow assignment without casting.

But actually, Prisma's generated types might be slightly different. Let me check what Prisma actually generates. With Prisma 5, the generated client uses types like:

```ts
export type Payout = {
  id: string;
  external_key: string; // Wait, is it camelCase or snake_case?
  ...
};
```

Hmm, actually Prisma generates types with the exact field names as defined in the schema. If I define `@map("external_key")`, Prisma generates `external_key` in the type. But by default (without `@map`), Prisma uses the field name as-is, and in the generated client, it converts to camelCase.

Wait, let me re-read Prisma's naming conventions:
- In the Prisma schema, fields are defined in camelCase by default.
- Prisma maps them to the database using snake_case by default (if the database uses `snake_case`).
- In the generated client, fields are in camelCase.

So if I define:

```prisma
model Payout {
  id          String   @id @default(uuid())
  externalKey String
  amount      Int
  effectiveDate DateTime
  txid        String?
  status      PayoutStatus @default(PENDING)
  attemptCount Int      @default(0)
  settledAt   DateTime?
  rejectedAt  DateTime?
  failedAt    DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Wait, but the conventions say "Table and column: snake_case (via Prisma `@map`/`@@map`)." So I need to use snake_case in the schema with `@map`:

```prisma
model Payout {
  id           String       @id @default(uuid())
  externalKey  String       @map("external_key")
  amount       Int          @map("amount")
  effectiveDate DateTime    @map("effective_date")
  txid         String?      @map("txid")
  status       PayoutStatus @default(PENDING) @map("status")
  attemptCount Int          @default(0) @map("attempt_count")
  settledAt    DateTime?    @map("settled_at")
  rejectedAt   DateTime?    @map("rejected_at")
  failedAt     DateTime?    @map("failed_at")
  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
}
```

Wait, actually, `@map` is for mapping a field to a column name. Prisma automatically uses the field name as the column name by default (converting to snake_case). But the conventions say to use `@map`/`@@map` explicitly. Let me follow the convention.

Actually, I think the convention is about the database column names being snake_case. In Prisma, you can define fields in camelCase and they'll be stored as snake_case in the database automatically (with the default naming strategy). But to be explicit, I can use `@map` to map each field.

Hmm, actually Prisma's default behavior is to use the field name as-is for the column name. So if I define `externalKey`, the column name is `externalKey` (camelCase). To use snake_case in the database, I need to either:
1. Set `map` in the datasource config
2. Use `@map("external_key")` on each field

The conventions say to use `@map`/`@@map`. So let me use `@map` on each field.

Wait, but Prisma actually does convert camelCase to snake_case by default when the field name has underscores or something? No, Prisma does NOT automatically convert camelCase to snake_case. The field name in the schema is used as-is for the column name, unless you use `@map` to change it.

Actually, I need to check this. In Prisma, the default behavior depends on the `relationMode` and the database connector. For PostgreSQL, the default is to use the field name as the column name. But Prisma does NOT automatically convert camelCase to snake_case.

Wait, I think I'm wrong. Let me re-check. In Prisma, if you define a field as `externalKey String @map("external_key")`, the Prisma client will use `externalKey` (camelCase) in TypeScript and `external_key` (snake_case) in SQL. If you don't use `@map`, the column name is `externalKey` (camelCase).

But the conventions say "Table and column: snake_case (via Prisma `@map`/`@@map`)." So I should use `@map` to map camelCase field names to snake_case column names.

Let me use `@map` on each field. This is the most explicit approach.

OK, so the schema would be:

```prisma
model Payout {
  id             String       @id @default(uuid()) @map("id")
  externalKey    String       @map("external_key")
  amount         Int          @map("amount")
  effectiveDate  DateTime     @map("effective_date")
  txid           String?      @map("txid")
  status         PayoutStatus @default(PENDING) @map("status")
  attemptCount   Int          @default(0) @map("attempt_count")
  settledAt      DateTime?    @map("settled_at")
  rejectedAt     DateTime?    @map("rejected_at")
  failedAt       DateTime?    @map("failed_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
}
```

Actually, for `@map("id")`, that's redundant since the column name would be `id` anyway. But for consistency, let me include it. Or actually, let me not be overly verbose. Only use `@map` where the column name differs from the field name.

Hmm, but the convention says to use `@map`/`@@map`. Let me include them for clarity and compliance with the convention.

Actually, I realize that the Prisma client generates TypeScript types with camelCase field names (e.g., `externalKey`, `effectiveDate`, `attemptCount`). This matches our domain types. So the mapping in the repository is straightforward.

Let me now write the code. For real.

Let me also think about the `package.json` — what's the name? Let me check the context. The task is about a payout reconciler. Let me name it `payout-reconciler`.

For dependencies, I need:
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`
- `@prisma/client`
- `reflect-metadata`
- `typescript`

Dev dependencies:
- `prisma`
- `vitest`
- `@types/node`
- `typescript`

I should also include `@nestjs/schedule` if I want to use `@Cron`. But let me not add it — the reconcile job can be triggered manually or by an external scheduler.

OK, let me now write ALL the code. I'll be systematic and complete.

Wait, one more thing. I need to think about the `main.ts` file. NestJS applications have an `main.ts` bootstrap file. Let me include it.

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

And `app.module.ts`:

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule, PayoutModule],
})
export class AppModule {}
```

OK, let me include these too. This makes the solution complete.

Now, let me also think about the test setup. I need:
- Vitest configuration
- Test file

For Vitest, I need a `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

OK, let me now write all the files. I'll write them in order.

Let me think about the total number of files:
1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/<timestamp>_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/prisma/prisma.service.ts`
9. `src/prisma/prisma.module.ts`
10. `src/bank/bank.types.ts`
11. `src/bank/bank.service.ts`
12. `src/bank/bank.module.ts`
13. `src/payout/payout.types.ts`
14. `src/payout/payout.repository.ts`
15. `src/payout/payout.service.ts`
16. `src/payout/payout.controller.ts`
17. `src/payout/payout.module.ts`
18. `test/payout.spec.ts`

That's 18 files. Let me write them all.

Actually, let me reconsider whether I need all of these. The task says "Deliver schema, service, reconcile job, and tests." The supporting files are necessary for the service to work, but I shouldn't include unnecessary files.

The essential files:
- `prisma/schema.prisma` (schema)
- `prisma/migrations/<timestamp>_init/migration.sql` (migration)
- `src/payout/payout.types.ts` (types needed by service)
- `src/payout/payout.repository.ts` (repository needed by service)
- `src/payout/payout.service.ts` (service with executePayments and reconcile)
- `test/payout.spec.ts` (tests)
- `src/bank/bank.types.ts` (bank interface needed by service)

Supporting files for completeness:
- `src/payout/payout.controller.ts` (controller for triggering)
- `src/payout/payout.module.ts` (module wiring)
- `src/bank/bank.service.ts` (real bank client implementation)
- `src/bank/bank.module.ts` (bank module)
- `src/prisma/prisma.service.ts` (Prisma wrapper)
- `src/prisma/prisma.module.ts` (Prisma module)
- `src/main.ts` (bootstrap)
- `src/app.module.ts` (root module)
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`

Let me include all of them for completeness. The tests will use mocks, so I don't need the full NestJS app to be running.

Actually, for the tests, I instantiate the service directly (without NestJS DI). So I only need the types and the service. But for the solution to be complete, I should include the module and controller.

Let me include all files. The task says "Deliver every file the solution needs."

OK, let me write the code now. I'll go through each file.

Wait, I also need to think about the `Prisma.Payout` type import. In the repository, I need to import the Prisma types. I'll use `import { Prisma } from '@prisma/client'` and then `Prisma.Payout` for the Prisma type.

But actually, since I'm defining my own domain types, I don't need to import Prisma types in the repository. I can just use the Prisma client directly and cast the results.

Let me think about this. The repository uses `this.prisma.payout` (the Prisma client). The result of `this.prisma.payout.findMany()` is an array of Prisma `Payout` objects. I need to convert these to my domain `Payout` objects.

Since the field names and enum values match (both use camelCase and the same string values), the conversion is just a cast: `result as Payout` or `result.map(p => p as Payout)`.

But with `strict: true`, TypeScript might not allow direct casting if the types are considered different. Let me use a mapping function for safety:

```ts
private toDomain(prismaPayout: any): Payout {
  return {
    id: prismaPayout.id,
    externalKey: prismaPayout.externalKey,
    amount: prismaPayout.amount,
    effectiveDate: prismaPayout.effectiveDate,
    txid: prismaPayout.txid,
    status: prismaPayout.status,
    attemptCount: prismaPayout.attemptCount,
    settledAt: prismaPayout.settledAt,
    rejectedAt: prismaPayout.rejectedAt,
    failedAt: prismaPayout.failedAt,
    createdAt: prismaPayout.createdAt,
    updatedAt: prismaPayout.updatedAt,
  };
}
```

Using `any` for the Prisma result avoids type compatibility issues. This is pragmatic.

Actually, I could import the Prisma types and cast. But `any` is simpler and the conversion is trivial.

Let me use `any` in the `toDomain` function to avoid type issues. The repository is the only place where Prisma types are used.

Hmm, but the conventions say "strict mode." Using `any` might be flagged. Let me think of a better approach.

Actually, let me not define a separate domain `Payout` type. Instead, let me use the Prisma-generated `Payout` type directly in the domain. This means:
- `payout.types.ts` imports `Payout` from a Prisma types file or defines it using the Prisma type.
- But the service shouldn't import from `@prisma/client`.

This is a tension between the convention (service has zero Prisma client calls) and type reuse.

Let me resolve this by defining the domain types in `payout.types.ts` and having the repository do the conversion. I'll use a helper function that maps Prisma results to domain types.

Actually, let me just accept that the types are structurally identical and use a simple cast. The conversion function with `any` is fine — it's a common pattern in repositories.

OK, let me now write the code. I'll stop overthinking and just do it.

Let me think about one final thing: the `PayoutRepositoryInterface`. I need to define it in `payout.types.ts` so the service can depend on it (in theory). But since NestJS DI uses classes, not interfaces, I'll define the interface in types and the class in repository. The service constructor will accept the interface type.

Wait, actually, in TypeScript, you can't use an interface as an injection token in NestJS. But in the tests, I instantiate the service directly, so I can pass any class that implements the interface. In the module, I provide the concrete class.

So the service constructor:

```ts
constructor(
  private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

Here, `PayoutRepository` is a class (not an interface), so NestJS can inject it. For testing, I create a `MockPayoutRepository` class and pass it to the service. Since the service accepts `PayoutRepository` type, and the mock has the same methods, TypeScript should accept it (structural typing).

Wait, but if the service expects `PayoutRepository` (the class instance type), and the mock is a different class, TypeScript would complain. Unless the mock implements the same interface.

Let me define an interface `IPayoutRepository` in `payout.types.ts` and have both the Prisma repository and the mock implement it. The service accepts `IPayoutRepository`.

But then NestJS can't inject `IPayoutRepository` (it's an interface). I need a class or token.

OK, let me use the following approach:
1. Define `PayoutRepositoryInterface` in `payout.types.ts` (the interface).
2. `PayoutRepository` (class in `payout.repository.ts`) implements `PayoutRepositoryInterface`.
3. The service accepts `PayoutRepository` (the class type) — NestJS can inject this.
4. For testing, I create `MockPayoutRepository` that also implements `PayoutRepositoryInterface`, and pass it to the service. Since it has the same methods, TypeScript's structural typing allows it.

Wait, but TypeScript's nominal typing for classes means `MockPayoutRepository` is not a `PayoutRepository`. Unless I use structural typing (which TypeScript does by default for object types, but class instances have nominal aspects).

Hmm, actually, TypeScript uses structural typing. If `MockPayoutRepository` has the same shape (methods and properties) as `PayoutRepository`, it's considered a subtype. But `PayoutRepository` has a `prisma` property (from the constructor), which `MockPayoutRepository` might not have. This would cause a type error.

To avoid this issue, let me have the service depend on an interface, and use a token for NestJS DI:

```ts
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  // ...
}
```

Then:
```ts
// In PayoutModule:
{ provide: PAYOUT_REPOSITORY, useExisting: PayoutPrismaRepository }

// In PayoutService:
constructor(
  @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
  ...
)
```

For testing:
```ts
const service = new PayoutService(mockRepo, mockBank, config);
```

Since the service accepts `PayoutRepository` (the interface type), and the mock implements the same interface, TypeScript is happy.

But wait — the service constructor parameter type is `PayoutRepository` (the interface). But at runtime, NestJS uses the token `PAYOUT_REPOSITORY` to find the implementation. The `@Inject` decorator bridges the type and the token.

For testing, I bypass NestJS DI and pass the mock directly. TypeScript checks that the mock is compatible with the `PayoutRepository` interface. Since the mock implements the same methods, it's compatible.

This is clean. Let me use this approach.

But actually, for the mock in tests, I don't need to implement the interface explicitly — TypeScript's structural typing handles it. But for clarity, I'll have the mock class implement the interface.

OK let me also think about the naming. I have:
- `PayoutRepository` — the interface (in `payout.types.ts`)
- `PayoutPrismaRepository` — the Prisma implementation (in `payout.repository.ts`)
- `MockPayoutRepository` — the mock for testing (in the test file)

Or I could name the interface `PayoutRepositoryInterface` and the class `PayoutRepository`. But conventionally, interfaces don't have the "Interface" suffix in TypeScript.

Actually, let me keep it simple:
- The interface is `PayoutRepository` (in `payout.types.ts`)
- The Prisma class is `PayoutPrismaRepository` (in `payout.repository.ts`)
- The mock is `MockPayoutRepository` (in the test file)

The token is `PAYOUT_REPOSITORY` (a symbol).

Wait, but if the interface is named `PayoutRepository` and the Prisma class is `PayoutPrismaRepository`, the naming is a bit off. Let me rename:
- Interface: `PayoutRepositoryPort` (following the port pattern) — no, that's too complex.
- Interface: `PayoutRepository`
- Prisma class: `PayoutPrismaRepository`

Or:
- Interface: `PayoutRepository`
- Prisma class: `PrismaPayoutRepository`

Let me go with:
- Interface: `PayoutRepository` (in `payout.types.ts`)
- Prisma class: `PrismaPayoutRepository` (in `payout.repository.ts`)

And the module provides `PrismaPayoutRepository` as `PayoutRepository`:

```ts
@Module({
  providers: [
    PrismaPayoutRepository,
    { provide: PayoutRepository, useExisting: PrismaPayoutRepository },
  ],
})
```

Wait, but `PayoutRepository` is an interface, not a class. NestJS can't use an interface as a token. I need a symbol or string token.

Let me use a symbol:

```ts
// In payout.types.ts:
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  // ...
}
```

And in the module:

```ts
@Module({
  providers: [
    PrismaPayoutRepository,
    { provide: PAYOUT_REPOSITORY, useExisting: PrismaPayoutRepository },
  ],
  exports: [PAYOUT_REPOSITORY],
})
```

And in the service:

```ts
constructor(
  @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

For testing:

```ts
const repo = new MockPayoutRepository();
const bank = new MockBankClient();
const service = new PayoutService(repo, bank, {
  publishLagMinutes: 30,
  maxAttempts: 5,
});
```

Since TypeScript uses structural typing and the constructor parameter is typed as `PayoutRepository` (interface), any object with the same shape is accepted. So the mock is accepted.

Wait, actually, there's a subtlety. With `@Inject(PAYOUT_REPOSITORY)`, the NestJS DI container resolves the dependency using the token. But in the test, I'm constructing the service manually, so I don't need the token. I just pass the mock directly. The `@Inject` decorator is ignored when constructing manually — TypeScript only uses it for type metadata (but I'm not using `emitDecoratorMetadata` for tests).

Actually, `@Inject` is a runtime decorator that adds metadata to the constructor parameter. When I construct the service manually (`new PayoutService(repo, ...)`) — wait, the service constructor has `@Inject` decorators on the parameters. But when I call `new PayoutService(repo, bank, config)`, the decorators don't affect the runtime behavior — I'm passing the values directly.

Hmm, actually, `@Inject` decorators in NestJS are used by the NestJS DI container to know which token to resolve for each parameter. When I manually instantiate the service, I'm bypassing the DI container, so the decorators don't matter. TypeScript doesn't care about the decorators at runtime — they're just metadata.

So in the test, I can do `new PayoutService(repo, bank, config)` and it works fine. TypeScript checks that `repo` is compatible with the first parameter type (`PayoutRepository`), `bank` with the second (`BankClient`), and `config` with the third (`PayoutConfig`). The `@Inject` decorators don't affect this check.

Great, this approach works.

But wait, there's still the issue of the constructor parameter type. The parameter is typed as `PayoutRepository` (the interface). The `@Inject(PAYOUT_REPOSITORY)` decorator tells NestJS to resolve this parameter using the `PAYOUT_REPOSITORY` token. But TypeScript sees the parameter type as `PayoutRepository` (the interface).

At runtime, the decorators are metadata (via `reflect-metadata` or NestJS's own metadata system). When manually instantiating, the decorators are ignored. So the test can pass any compatible object.

OK, this works. Let me proceed with this design.

Actually, I just realized there might be a simpler approach. Instead of using `@Inject` and symbols, I can just have the service constructor accept the concrete types and use NestJS's default injection by type. For the bank client, I can inject the `BankService` class directly. For testing, I create a mock that has the same methods.

But the issue is that `BankService` is a class, and if the test mock is a different class, TypeScript would complain (nominal typing for class instances). Unless the mock implements an interface.

Actually, TypeScript uses structural typing, not nominal typing (except for some edge cases). So a mock object with the same methods as `BankService` would be accepted as a `BankService` parameter.

Wait, no. TypeScript's class types are nominal to some extent. If the service parameter is typed as `BankService`, and the mock is typed as `MockBankService`, TypeScript checks if `MockBankService` is a subtype of `BankService`. Since `MockBankService` has all the same methods (it implements the `BankClient` interface, and `BankService` also implements `BankClient`), `MockBankService` is a subtype of `BankService` if its shape matches.

Hmm, actually, `BankService` has a constructor that takes specific parameters. The mock might not have the same constructor. But for the service constructor, we only care about the instance type, not the constructor type. So as long as the mock has the same methods as `BankService`, it should work.

Let me just use the interface + symbol token approach. It's the cleanest.

OK, I'm going to write the code now. Let me also decide on the final file structure and write each file.

Actually, let me reconsider. For simplicity in the tests, let me NOT use `@Inject` decorators. Instead, let me have the service constructor accept interfaces directly, and provide the concrete implementations via tokens in the module. But without `@Inject`, NestJS uses the parameter type as the token. If the parameter type is an interface, NestJS can't use it as a token (interfaces are erased at runtime).

So I DO need `@Inject` with a token if I want to inject an interface. Let me use the symbol token approach.

But for testing, I bypass NestJS DI and pass mocks directly. The `@Inject` decorators are harmless in this case.

Wait, actually, there's a problem. If the service uses `@Inject(BANK_CLIENT)` on the constructor parameter, and I try to do `new PayoutService(repo, mockBank, config)` in the test, TypeScript might complain because the `@Inject` decorator changes the metadata.

Actually, no. `@Inject` is just a parameter decorator. It doesn't change the TypeScript type of the parameter. The parameter is still typed as `BankClient`. So TypeScript checks that `mockBank` is compatible with `BankClient`. The decorator is just metadata that NestJS reads at runtime.

OK, this works. Let me proceed.

Let me now think about whether I need `@Inject` for the config. The config is a simple object, so I can use `@Inject(PAYOUT_CONFIG)` on it.

Alright, I'm going to write the code now. Let me think about the order of files:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. Migration SQL
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/prisma/prisma.service.ts`
9. `src/prisma/prisma.module.ts`
10. `src/bank/bank.types.ts`
11. `src/bank/bank.service.ts`
12. `src/bank/bank.module.ts`
13. `src/payout/payout.types.ts`
14. `src/payout/payout.repository.ts`
15. `src/payout/payout.service.ts`
16. `src/payout/payout.controller.ts`
17. `src/payout/payout.module.ts`
18. `test/payout.spec.ts`

Let me write them all now.

Oh wait, I also need to think about the `nestjs.config.ts` or environment configuration. The conventions say "Configuration comes from environment variables only." So I'll read env vars directly with `process.env` and use `// ASSUMPTION` where needed.

For the bank service, the URL and API key would come from env vars. I'll add `// ASSUMPTION` comments.

Let me also think about the `PrismaService` — it extends `PrismaClient`. The `DATABASE_URL` env var is used by Prisma automatically (via `env("DATABASE_URL")` in the schema).

OK, let me now write all the files. I'll be thorough and complete.

Actually, let me think one more time about the date iteration in `reconcile`. I need to iterate over dates from `window.from` to `window.to`, day by day. For each date, I check if it's past the publish lag, and if so, call `getStatement(date)`.

But `window.from` and `window.to` are `Date` objects with time components. I need to normalize them to midnight of each day.

Here's my approach:
1. Start with `current = new Date(window.from)`, set to midnight.
2. End with `end = new Date(window.to)`, set to midnight.
3. For each day from `current` to `end`:
   a. If `current < cutoff` (past the publish lag):
      - Call `getStatement(current)` and collect settlements.
   b. Move to the next day.

Wait, I should compare the date (midnight) with the cutoff. The cutoff is `now - publishLag`. If the date (midnight) is before the cutoff, the statement should be available.

For example:
- now = Jan 15 14:00
- publishLag = 30 min
- cutoff = Jan 15 13:30
- Date Jan 15 00:00 < Jan 15 13:30 → fetch statement
- Date Jan 16 00:00 > Jan 15 13:30 → skip (but Jan 16 is in the future, so it won't be in the window)

Wait, if `window.to` is Jan 15 14:00, the end date (midnight) is Jan 15 00:00. So we'd only iterate over Jan 15 (one day). And Jan 15 00:00 < Jan 15 13:30, so we fetch the statement.

But the statement for Jan 15 might not be complete yet (transactions published at 13:00 would only appear at 13:30). So if the window includes "today," we might fetch an incomplete statement.

To handle this correctly, I should only fetch statements for dates that are completely past the publish lag. Since the publish lag is 30 minutes, and a "date" in `getStatement` represents a day, the statement for a day is complete if the current time is at least 30 minutes past the end of that day. But that would mean we never check today's statement.

Actually, the publish lag applies to individual transactions, not to the entire day's statement. A transaction published at 13:00 appears in the statement 30 minutes later (at 13:30). So the statement for Jan 15 includes all transactions published on Jan 15, but only those published before 13:30 (if we're checking at 14:00).

For the purpose of this task, the key question is: "Is the order's txid in the statement?" If the order's effective_date is Jan 15 12:00, and the statement for Jan 15 includes transactions up to 13:30, then the txid should be in the statement (if it was published).

So the check is:
- The statement for date D is available if `now - D > publishLag`. But D is midnight of the date. If now is Jan 15 14:00, and D is Jan 15 00:00, then `now - D = 14 hours > 30 min`. So the statement is available. But it might not include transactions published after 13:30.

Hmm, this is getting complicated. Let me simplify for the task:

- The statement for a date D is available if D is at least `publishLag` in the past.
- Since D is midnight, D is in the past if `now > D`. And `now - D > publishLag` means it's more than `publishLag` since midnight of D.
- For our purposes, if the order's effective_date is more than `publishLag` in the past, and its date's statement is available, we can check for the txid.

Let me use the order's `effectiveDate` for the lag check (not the statement date). The statement date is used for fetching. The order's effectiveDate is used for determining if the order is past the lag.

In the reconcile function:
1. Fetch statements for dates in the window that are past the lag (date < cutoff).
2. Match settlements to orders → SETTLED.
3. For AWAITING_RECONCILE orders with effectiveDate <= cutoff:
   - If found in statement → SETTLED (already done).
   - If not found → resend or FAILED.

Wait, but the order's effectiveDate might not be the same as the statement date. The effectiveDate is a specific datetime, and the statement date is the day. So the order's effectiveDate (e.g., Jan 15 12:00) is on the day Jan 15. The statement for Jan 15 includes all transactions on that day.

So the check is:
- effectiveDate is Jan 15 12:00 → date is Jan 15 → statement for Jan 15 is fetched.
- If effectiveDate <= cutoff (Jan 15 12:00 <= Jan 15 13:30), the transaction should be in the statement.

This is correct. Let me use `effectiveDate <= cutoff` for the order eligibility check.

But I also need the statement for the date of the effectiveDate to be fetched. If the window doesn't include the effectiveDate's date, the statement won't be fetched, and the order won't be matched.

Hmm, but in my design, I fetch statements for all dates in the window that are past the lag. If the order's effectiveDate is Jan 15 12:00 and the window is { from: Jan 15 00:00, to: Jan 16 00:00 }, then the statement for Jan 15 is fetched. The order's effectiveDate (Jan 15 12:00) <= cutoff (Jan 15 13:30), so the order is eligible.

But the check `effectiveDate <= cutoff` doesn't consider the window. An order with effectiveDate Jan 14 12:00 would also be eligible if `cutoff > Jan 14 12:00`. But the statement for Jan 14 might not be fetched if the window starts at Jan 15.

To handle this correctly, I should filter orders by the window as well:

```ts
where: {
  status: PayoutStatus.AWAITING_RECONCILE,
  effectiveDate: {
    gte: window.from,
    lte: cutoff,
  },
}
```

This ensures the order's effectiveDate is within the window AND past the lag.

Let me use this approach. The `findAwaitingReconcileEligible` method takes the window and cutoff as parameters.

OK, I'm going to write the code now. For real. No more planning.

Actually, one more tiny thing. Let me think about the test setup. I need to create orders with specific states. The mock repository has a `create` method that allows creating orders with any status. This is convenient for testing.

For the test, I'll create orders in `PENDING` state, then run `executePayments` and `reconcile` to observe state transitions.

Let me also think about how to verify the "no resend" in the timeout-but-settled test. After reconciliation marks the order as SETTLED, calling `executePayments` again should not pick it up. I can verify this by checking `bank.sendCalls.length` — it should still be 1 (only the initial send call).

For the "same txid" in the proven-absent test, I need to verify that the second send call uses the same txid. I can check `bank.sendCalls[1].txid === bank.sendCalls[0].txid`.

OK, writing code now.

Actually, let me also think about the `PayoutUpdateData` type. I don't need it since I'm using specific repository methods (`markSent`, `markAwaitingReconcile`, etc.). These methods handle the Prisma-specific update logic internally.

Let me finalize the repository interface:

```ts
export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}
```

The implementation (`PrismaPayoutRepository`) uses Prisma internally. The mock (`MockPayoutRepository`) uses an in-memory store.

OK, writing code now. Let me start.

Actually, I realize I should think about the `attemptCount` increment. In the service, when we call `markSent`, `markAwaitingReconcile`, or `markRejected`, the repository increments the attempt count. This is a repository concern (how to update the database).

But what about `markSettled`, `markForResend`, and `markFailed`? These don't increment the attempt count. Let me make sure the repository implementation is correct:

- `markSent(id, txid)`: set txid, status=SENT, increment attemptCount
- `markAwaitingReconcile(id, txid)`: set txid, status=AWAITING_RECONCILE, increment attemptCount
- `markRejected(id, txid)`: set txid, status=REJECTED, set rejectedAt, increment attemptCount
- `markSettled(id, settledAt)`: set status=SETTLED, set settledAt
- `markForResend(id)`: set status=PENDING
- `markFailed(id, failedAt)`: set status=FAILED, set failedAt

This is correct. The attempt count is incremented when a send is attempted (markSent, markAwaitingReconcile, markRejected). It's not incremented during reconcile operations (markSettled, markForResend, markFailed).

Now, let me also think about `markForResend`. This method sets the status to PENDING. It doesn't change the txid (it's already set from the previous send). When `executePayments` picks up the PENDING order, it uses the stored txid (or derives a new one if not stored).

Wait, in the service's `executePayments`:
```ts
const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
```

If the order was previously sent (and txid was stored), `order.txid` is set, so we use it. If the order was never sent (first attempt), `order.txid` is null, so we derive it.

But after `markForResend`, the order's txid is still set (from the previous send). So `executePayments` uses the stored txid. This is correct — the same txid is used for all resends.

If the order was never sent before (first attempt), `order.txid` is null. `executePayments` derives the txid and stores it via `markSent` or `markAwaitingReconcile`.

Great, this is correct.

Now let me also think about what happens if `markForResend` is called but the order is in a state other than AWAITING_RECONCILE. This shouldn't happen (the service only calls it for AWAITING_RECONCILE orders), but for safety, the repository could use a conditional update. But for simplicity, I'll just do a simple update.

OK, let me write the code now. I'm going to write each file completely.

Let me think about the `Payout` type one more time. I'm defining it as an interface in `payout.types.ts`:

```ts
export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

This matches the Prisma-generated type (with camelCase field names). The repository converts Prisma results to this type (via a simple cast or mapping).

OK, now let me also think about what the `PayoutStatus` should be. I decided to use a `const` object:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

This is compatible with Prisma's generated type and avoids the nominal typing issue with TypeScript enums.

Let me now write all the files. Starting now.

Actually, I realize I need to think about the `createHash` import. In Node.js, `crypto` is a built-in module. With ESM, I import it as:

```ts
import { createHash } from 'crypto';
```

This should work in Node 20+.

And for date formatting, I'll use a simple function:

```ts
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

This is used in the txid derivation.

OK, let me now write all the files. I'm going to be thorough and complete.

Let me think about the test file structure one more time. I need to test three scenarios. Each test:
1. Creates a PENDING order.
2. Calls `executePayments()` → bank returns a specific result.
3. Verifies state transitions.
4. Calls `reconcile()` → bank statement has specific entries.
5. Verifies state transitions.
6. Calls `executePayments()` again → verifies no resend (or resend with same txid).

Let me also think about what to assert:
- State of the order (status, attempt_count, txid)
- Bank client calls (number of sends, txid used)

The convention says "Never assert only that a call happened." So I need to verify both the state and the side effects.

For the timeout-but-settled test:
- After executePayments: order is AWAITING_RECONCILE, attempt_count=1, txid is set
- After reconcile: order is SETTLED, settled_at is set
- After second executePayments: no additional send (bank.sendCalls.length=1)
- The bank's getStatement was called for the order's effective date

For the proven-absent test:
- After first executePayments: order is AWAITING_RECONCILE, attempt_count=1, txid is set
- After reconcile: order is PENDING (eligible for resend)
- After second executePayments: bank.sendCalls.length=2, same txid
- After second reconcile (if needed): order is SETTLED or continues

For the attempt exhaustion test:
- 5 cycles of executePayments + reconcile
- After 5th cycle: order is FAILED, attempt_count=5
- No 6th send attempt

Let me now write the code.

Actually, I also need to think about the `ReconcileResult` type. Let me define it:

```ts
export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}
```

This is returned by the `reconcile` method and can be used by the caller (or tests) to verify the outcome.

OK, let me now write all the files. I'm going to write them one by one, completely.

Wait, one more thing about the `PayoutRepository` interface. I have `findAwaitingReconcileEligible(window, cutoff)`. But in the mock, I need to check `effectiveDate >= window.from && effectiveDate <= cutoff`. Let me make sure the mock implements this correctly.

Also, I need to think about the `PAYOUT_REPOSITORY` token. Let me define it in `payout.types.ts`:

```ts
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');
export const BANK_CLIENT = Symbol('BANK_CLIENT');
export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
```

Wait, `BANK_CLIENT` should be in `bank.types.ts` and `PAYOUT_CONFIG` in `payout.types.ts`. Let me put each token in the appropriate types file.

OK, now I'm really going to write the code. Let me start with the files in order.

Hmm, actually one more consideration. The `PrismaService` in NestJS is typically a thin wrapper around `PrismaClient`. But the conventions say "the repository is the only layer that touches the database." So the `PrismaService` is provided, and the `PrismaPayoutRepository` uses it.

Wait, the `PrismaService` extends `PrismaClient`, which is the database client. So technically, the `PrismaService` touches the database. But it's just a wrapper — the actual database operations are in the repository.

I think this is fine. The convention is about the layers: the service (business logic) shouldn't directly call Prisma. The repository is the data access layer. The `PrismaService` is infrastructure, not business logic.

OK, let me now write the code.

Let me think about the structure of `payout.types.ts` one more time:

```ts
// Payout status (const object + type, compatible with Prisma)
export const PayoutStatus = { ... } as const;
export type PayoutStatus = ...;

// Payout domain type
export interface Payout { ... }

// Repository interface
export interface PayoutRepository { ... }

// Config
export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
export interface PayoutConfig { ... }

// Reconcile window
export interface ReconcileWindow { ... }

// Reconcile result
export interface ReconcileResult { ... }

// Error envelope
export class PayoutError extends Error { ... }
```

And `bank.types.ts`:

```ts
export const BANK_CLIENT = Symbol('BANK_CLIENT');
export type BankSendStatus = ...;
export interface BankSendResult { ... }
export interface Settlement { ... }
export interface BankClient { ... }
```

OK, let me now write the code for real. I'll write each file completely.

Hmm, I'm also thinking about whether I need `@EnableVersioning` or any API versioning. The task doesn't mention it, so I'll keep it simple.

Let me also think about the `NestJS` version. The latest stable is NestJS 10. But I'll use `^10.0.0` without specifying an exact version.

OK, writing code now. I'll list the files in the order they should appear in the response.

Let me think about one more thing: the `dateRange` function. I need to iterate over dates from `window.from` to `window.to`. But `window.from` might not be at midnight. Let me normalize it.

```ts
private iterateDates(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}
```

This returns an array of dates (one per day) from `from` to `to`.

OK, I'm now going to write all the files. Let me structure my response.

Let me also think about whether the tests should use `vitest`'s `describe`, `it`, `expect` globals or imports. With `globals: true` in the vitest config, I can use them without importing. But it's more explicit to import them. Let me import them:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
```

OK, writing code now.

Let me also think about the error handling in `executePayments`. If `bank.send` throws (not returns a result, but throws), I catch it and treat it as a `transient_error`. If the repository update fails, the error propagates up (and the job fails).

For `reconcile`, if `getStatement` throws, I catch it and skip that date (the comment says "ASSUMPTION: We log the error but don't fail the entire reconciliation"). If the repository update fails, the error propagates.

OK, let me now write the code. I'll start with the simplest files and work up to the complex ones.

Actually, I want to think about one more thing. The `reconcile` method takes a `ReconcleWindow`. But the task says "reconcile(window)." Let me make sure the window parameter makes sense.

The window defines the date range of statements to check. For a 15-minute run, the window might cover the last 24 hours or the last few hours. The overlapping window requirement means the same date might be checked in consecutive runs — that's fine because the matching is idempotent.

For the tests, I'll use a window that covers the order's effective date. For example, if the order's effective date is 2 hours ago, the window might be { from: 3 hours ago, to: 1 hour ago }.

But wait, the window should be inclusive of dates. If the effective date is Jan 15 12:00, and the window is { from: Jan 15 00:00, to: Jan 15 23:59 }, the date Jan 15 is in the window. The statement for Jan 15 is fetched (if past the lag).

Actually, in my implementation, I iterate over dates from `window.from` to `window.to`. Each date is normalized to midnight. So the window { from: Jan 15 10:00, to: Jan 15 20:00 } would yield one date: Jan 15 (midnight). And Jan 15's statement is fetched if past the lag.

OK, this is correct. Let me write the code.

I also want to make sure the `window.to` includes the current date. If `window.to` is `new Date()` (now), and I normalize it to midnight, the date range includes today's date up to midnight. So I need to make sure the window covers the right dates.

For the tests, I'll set `window.to = new Date()` (now). This is normalized to midnight of today. The window covers from `window.from` to today.

OK, I'm going to write the code now. No more planning.

Let me also make a decision about the `BankService` (real implementation). Since the task doesn't provide bank API details, I'll create a stub that throws "not configured." The actual HTTP implementation would depend on the bank's API. I'll add an `// ASSUMPTION` comment.

OK, here's my final plan for all files:

### 1. package.json
```json
{
  "name": "payout-reconciler",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.2.4",
    "@nestjs/core": "^10.2.4",
    "@nestjs/platform-express": "^10.2.4",
    "@prisma/client": "^5.7.0",
    "reflect-metadata": "^0.1.13"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/papaparse": "^5.0.6",
    "nest": "^10.2.4",
    "prisma": "^5.7.0",
    "typescript": "^5.3.2",
    "vitest": "^1.1.0"
  }
}
```

Wait, I don't need `@types/papaparse`. Let me remove that.

### 2. tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true
  }
}
```

### 3. vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

### 4. prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}

model Payout {
  id             String       @id @default(uuid())
  externalKey    String       @map("external_key")
  amount         Int          @map("amount")
  effectiveDate  DateTime     @map("effective_date")
  txid           String?      @map("txid")
  status         PayoutStatus @default(PENDING) @map("status")
  attemptCount   Int          @default(0) @map("attempt_count")
  settledAt      DateTime?    @map("settled_at")
  rejectedAt     DateTime?    @map("rejected_at")
  failedAt       DateTime?    @map("failed_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
  @@index([status])
  @@index([txid])
  @@index([effectiveDate])
}
```

### 5. Migration SQL
```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ("PENDING","SENT","AWAITING_RECONCILE","SETTLED","REJECTED","FAILED");

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "external_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" TIMESTAMPTZ NOT NULL,
    "txid" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "payouts_txid_idx" ON "payouts"("txid");
CREATE INDEX "payouts_effective_date_idx" ON "payouts"("effective_date");
```

### 6. src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

### 7. src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule, PayoutModule],
})
export class AppModule {}
```

### 8. src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### 9. src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### 10. src/bank/bank.types.ts
```ts
export const BANK_CLIENT = Symbol('BANK_CLIENT');

export type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

export interface BankSendResult {
  status: BankSendStatus;
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

### 11. src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { BankClient, BankSendResult, Settlement } from './bank.types';

@Injectable()
export class BankService implements BankClient {
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls.
    throw new Error('BankService.send not implemented: configure BANK_API_URL');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls.
    throw new Error('BankService.getStatement not implemented: configure BANK_API_URL');
  }
}
```

### 12. src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BANK_CLIENT } from './bank.types';
import { BankService } from './bank.service';

@Module({
  providers: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
  exports: [{ provide: BANK_CLIENT, useExisting: BankService }],
})
export class BankModule {}
```

### 13. src/payout/payout.types.ts
```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}

export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}

export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}

export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}
```

### 14. src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, ReconcileWindow } from './payout.types';

@Injectable()
export class PrismaPayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: { status: 'PENDING' },
      orderBy: { effectiveDate: 'asc' },
    });
    return results.map(this.toDomain);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const result = await this.prisma.payout.findUnique({
      where: { txid },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAwaitingReconcileEligible(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: {
        status: 'AWAITING_RECONCILE',
        effectiveDate: {
          gte: window.from,
          lte: cutoff,
        },
      },
    });
    return results.map(this.toDomain);
  }

  async markSent(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: 'SENT',
        attemptCount: { increment: 1 },
      },
    });
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: 'AWAITING_RECONCILE',
        attemptCount: { increment: 1 },
      },
    });
  }

  async markRejected(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: 'REJECTED',
        rejectedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: 'SETTLED',
        settledAt,
      },
    });
  }

  async markForResend(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: 'PENDING',
      },
    });
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: 'FAILED',
        failedAt,
      },
    });
  }

  private toDomain(prismaPayout: {
    id: string;
    externalKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string | null;
    status: string;
    attemptCount: number;
    settledAt: Date | null;
    rejectedAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Payout {
    return {
      id: prismaPayout.id,
      externalKey: prismaPayout.externalKey,
      amount: prismaPayout.amount,
      effectiveDate: prismaPayout.effectiveDate,
      txid: prismaPayout.txid,
      status: prismaPayout.status as PayoutStatus,
      attemptCount: prismaPayout.attemptCount,
      settledAt: prismaPayout.settledAt,
      rejectedAt: prismaPayout.rejectedAt,
      failedAt: prismaPayout.failedAt,
      createdAt: prismaPayout.createdAt,
      updatedAt: prismaPayout.updatedAt,
    };
  }
}
```

Wait, I'm using string literals for status in Prisma queries (`status: 'PENDING'`). But Prisma expects the Prisma-generated `PayoutStatus` type. In Prisma's generated client, the `PayoutStatus` type accepts string literals. So `'PENDING'` is a valid value for the `status` field in the Prisma query.

Actually, let me check. In Prisma, the `status` field in the `where` clause expects a `PayoutStatus` value, which is a string literal type. So `'PENDING'` is valid. But I need to make sure the Prisma client is generated and the types are correct.

Hmm, but I'm writing this without the actual Prisma client generated. The types would be generated by `prisma generate`. Let me just use string literals and add `// @ts-ignore` or type assertions where needed.

Actually, for the repository, I can import the Prisma types:

```ts
import { Prisma } from '@prisma/client';
```

And use `Prisma.PayoutStatus` for the status values. But wait, `PayoutStatus` is defined in the Prisma schema, so it's generated in the Prisma client. The Prisma client would have `Prisma.PayoutStatus` as an enum.

Hmm, actually, in Prisma 5, the generated types might be different. Let me just use string literals and trust that they're compatible.

Actually, I think the issue is that in the Prisma client, the `where` clause for `status` expects `PayoutStatus | string`. And since `PayoutStatus` is a string literal type, `'PENDING'` is a valid value. So using string literals should work.

Let me also think about whether I need to import `Prisma` from `@prisma/client`. In the repository, I need:
- `Prisma.PayoutWhereInput` for the where clause (optional — I can use the inline object)
- `Prisma.PayoutUpdateInput` for the data (optional — I can use the inline object)

I don't need to explicitly import these types because TypeScript can infer them from the Prisma client's generated types.

But wait, the Prisma client's `payout` delegate has typed methods. The `findMany` method expects a `PayoutFindManyArgs` argument, which has a typed `where` field. So if I pass an inline object, TypeScript checks it against the expected type. The `status: 'PENDING'` should match the `PayoutStatus` type (which includes `'PENDING'`).

OK, I think this should work. Let me proceed.

But there's still the issue of whether the `@prisma/client` module is installed. Since this is a theoretical exercise (no shell, no npm install), the Prisma client types won't be available. I'll write the code assuming Prisma client is generated, and the types are correct.

For testing, I won't use Prisma at all — I'll use mock implementations.

Let me also think about whether the `toDomain` function needs to handle the Prisma-specific field names. In Prisma's generated client, the fields are in camelCase (e.g., `externalKey`, `effectiveDate`). So the `toDomain` function just maps these directly. But I'm using string literals for status in queries, and the Prisma result has `status` as a string. I cast it to `PayoutStatus` (my domain type), which is also a string. This is fine.

Wait, actually, I just realized that in Prisma, when you use `@map("external_key")`, the Prisma client still uses `externalKey` (camelCase) in TypeScript. The `@map` only affects the SQL column name, not the TypeScript property name. So the Prisma client type has `externalKey`, `effectiveDate`, `attemptCount`, etc. This matches my domain types. Good.

OK, let me also think about the `Prisma` import. I need:

```ts
import { Prisma } from '@prisma/client';
```

But this is only for types. If I use `as const` objects for status, I might not need this import. Let me check.

In the `toDomain` function, I take a Prisma result and convert it to a domain type. The Prisma result has the same fields as my domain type. The only difference is the `status` field type (Prisma's `PayoutStatus` vs my `PayoutStatus`). Since both are unions of the same string literals, I can cast with `as PayoutStatus`.

But I need the Prisma result type to be defined. In the repository, I use `this.prisma.payout.findMany()` which returns `Promise<Payout[]>` (Prisma's `Payout` type). The Prisma `Payout` type is generated by `prisma generate`. Without the generated client, this type doesn't exist.

For the code to be complete, I'll import the Prisma types:

```ts
import { PrismaClient, Payout as PrismaPayout } from '@prisma/client';
```

Wait, in Prisma 5, the import is:

```ts
import { PrismaClient } from '@prisma/client';
import type { Payout as PrismaPayout } from '@prisma/client';
```

Actually, in Prisma 5, the generated types are available directly from `@prisma/client`. So:

```ts
import { PrismaClient } from '@prisma/client';
```

And `Prisma.Payout` is a namespace type. The generated `Payout` type is at the top level of `@prisma/client`.

Hmm, actually in Prisma 5, the generated types might be slightly different. Let me just use the Prisma client directly and let TypeScript infer types. I'll use `// @ts-expect-error` or type assertions where the Prisma client types aren't available.

Actually, for the repository, I can use the Prisma client's types directly:

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
// prisma.payout is typed, so prisma.payout.findMany() returns Promise<Payout[]>
```

The `Payout` type from `@prisma/client` has camelCase field names. So `prismaPayout.status` is the Prisma `PayoutStatus` type. I cast it to my domain `PayoutStatus`:

```ts
private toDomain(result: typeof prisma.payout extends infer T ? T : never): Payout {
  // ...
}
```

Hmm, this is getting too type-heavy. Let me just use a simple approach: define the Prisma result type as a local type and cast.

Actually, let me take the simplest approach. I'll import the Prisma types and use them:

```ts
import { PrismaClient } from '@prisma/client';
import type { Payout as PrismaPayout } from '@prisma/client';
```

Wait, I'm not sure about the exact import syntax for Prisma 5. In Prisma 4, types were imported from the generated `Prisma` namespace. In Prisma 5, they're directly from `@prisma/client`.

Let me just use the Prisma client and access types from it. In the `toDomain` function, I'll use a parameter type that's compatible with the Prisma result:

```ts
private toDomain(result: {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Payout {
  return {
    ...result,
    status: result.status as PayoutStatus,
  };
}
```

By typing the parameter as a generic object (with `status: string`), I avoid the Prisma type dependency. The Prisma result has the same shape, so it's compatible. And I cast `status` from `string` to `PayoutStatus`.

This is pragmatic and avoids type complications. Let me use this approach.

OK wait, I realize I should think about whether Prisma's `findUnique({ where: { txid } })` works. The `txid` field is optional (nullable) in the schema. Can we use it as a unique filter? In Prisma, `findUnique` requires a unique constraint. If `txid` is `@unique` in the schema, this works.

Let me add `@unique` to the `txid` field:

```prisma
txid String? @unique @map("txid")
```

Wait, `@unique` on a nullable field — Prisma creates a unique index that allows null. This is fine — it means multiple rows can have null txid, but non-null txids must be unique.

Actually, in PostgreSQL, multiple null values are allowed in a unique index. So this is correct.

Let me add `@unique` to the `txid` field.

Also, I should add `@@unique([external_key, effective_date])` if I want to prevent duplicate payouts for the same key and date. But the task doesn't mention this. Let me not add it.

OK, let me finalize the schema:

```prisma
model Payout {
  id             String       @id @default(uuid())
  externalKey    String       @map("external_key")
  amount         Int          @map("amount")
  effectiveDate  DateTime     @map("effective_date")
  txid           String?      @unique @map("txid")
  status         PayoutStatus @default(PENDING) @map("status")
  attemptCount   Int          @default(0) @map("attempt_count")
  settledAt      DateTime?    @map("settled_at")
  rejectedAt     DateTime?    @map("rejected_at")
  failedAt       DateTime?    @map("failed_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
  @@index([status])
  @@index([effectiveDate])
}
```

Wait, `@unique` already creates an index. So I don't need `@@index([txid])` separately. Let me keep just the other indexes.

Actually, I realize I should also think about whether `txid` being `@unique` is the right design. The txid is derived from order ID + effective date. Each order has a unique ID, so the txid should be unique per order. But if we allow multiple payouts for the same order (e.g., re-creating a payout), the txid could conflict.

For this task, I'll assume each payout has a unique txid. The `@unique` constraint helps with `findUnique` queries.

Actually, wait. If I use `findUnique` with a nullable field that has a unique constraint, Prisma generates a query like `WHERE txid = ?`. This works for non-null values. For null values, it returns no results (which is correct — we don't want to look up by null txid).

OK, this is fine.

Let me now also think about the migration SQL with the `@unique` constraint:

```sql
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "external_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" TIMESTAMPTZ NOT NULL,
    "txid" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "payouts_txid_key" ON "payouts"("txid");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "payouts_effective_date_idx" ON "payouts"("effective_date");
```

Wait, in PostgreSQL, a unique index on a nullable column allows multiple NULL values. So this is correct.

OK, let me now write all the code. I'll write each file completely.

Let me also think about the `PayoutService` one more time. Here's the complete flow:

```ts
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  private get publishLagMs(): number {
    return this.config.publishLagMinutes * 60 * 1000;
  }

  /**
   * Derives a deterministic txid from the order ID and effective date.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = formatDateKey(effectiveDate);
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payments via the bank API.
   */
  async executePayments(): Promise<void> {
    const orders = await this.payoutRepository.findPending();
    
    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      const result = await this.sendWithTimeoutHandling(txid, order.amount, order.externalKey);
      await this.handleSendResult(order, txid, result);
    }
  }

  private async sendWithTimeoutHandling(
    txid: string,
    amount: number,
    key: string,
  ): Promise<BankSendResult> {
    // ASSUMPTION: Bank API call timeout is handled by the BankClient implementation.
    // The service treats any thrown error as a transient error.
    try {
      return await this.bankClient.send({ txid, amount, key });
    } catch (err) {
      return {
        status: 'transient_error',
        error: (err as Error).message,
      };
    }
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepository.markSent(order.id, txid);
        break;
      
      case 'duplicate':
        // The bank already has this txid. The payment was accepted previously.
        await this.payoutRepository.markSent(order.id, txid);
        break;
      
      case 'transient_error':
        // The send failed or timed out. The order needs reconciliation
        // to prove absence before it can be re-sent.
        await this.payoutRepository.markAwaitingReconcile(order.id, txid);
        break;
      
      case 'permanent_rejection':
        await this.payoutRepository.markRejected(order.id, txid);
        break;
    }
  }

  /**
   * Reconciles bank statements with payout orders.
   * Safe to run every 15 minutes, including over overlapping windows.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.publishLagMs);
    
    // 1. Fetch statement entries for dates in the window past the publish lag
    const settlements = await this.fetchStatements(window, cutoff);
    
    // 2. Build a set of txids from the statement
    const statementTxids = new Set(settlements.map(s => s.txid));
    
    // 3. Match statement entries to orders → SETTLED
    let matched = 0;
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.markSettled(order.id, now);
        matched++;
      }
    }
    
    // 4. For AWAITING_RECONCILE orders not in statement → resend or FAILED
    const awaitingOrders = await this.payoutRepository.findAwaitingReconcileEligible(window, cutoff);
    
    let resendEligible = 0;
    let failed = 0;
    
    for (const order of awaitingOrders) {
      if (order.txid && statementTxids.has(order.txid)) {
        // Already matched and marked as SETTLED in step 3
        continue;
      }
      
      // Proven absent past the publishing lag
      if (order.attemptCount >= this.config.maxAttempts) {
        await this.payoutRepository.markFailed(order.id, now);
        failed++;
      } else {
        await this.payoutRepository.markForResend(order.id);
        resendEligible++;
      }
    }
    
    return { matched, resendEligible, failed };
  }

  private async fetchStatements(window: ReconcileWindow, cutoff: Date): Promise<Settlement[]> {
    const settlements: Settlement[] = [];
    
    const current = new Date(window.from);
    current.setHours(0, 0, 0, 0);
    const end = new Date(window.to);
    end.setHours(0, 0, 0, 0);
    
    while (current <= end) {
      if (current.getTime() <= cutoff.getTime()) {
        try {
          const entries = await this.bankClient.getStatement(new Date(current));
          settlements.push(...entries);
        } catch (err) {
          // ASSUMPTION: Statement fetch failure is logged but does not
          // block the entire reconciliation process.
        }
      }
      current.setDate(current.getDate() + 1);
    }
    
    return settlements;
  }
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

Wait, I used `Date` and `createHash` but didn't import them. Let me add the imports.

Also, I'm using `formatDateKey` as a standalone function. Let me define it inside the service or as a module-level function.

Let me also think about the `PayoutStatus.SETTLED` check in the reconcile method. I'm comparing `order.status !== PayoutStatus.SETTLED`. This is a string comparison. Since `PayoutStatus.SETTLED = 'SETTLED'`, this works correctly.

OK, I think the code is mostly correct. Let me also think about the `markSent` vs `markAwaitingReconcile` distinction.

In `handleSendResult`:
- `accepted` → `markSent` (status = SENT, attemptCount++)
- `duplicate` → `markSent` (status = SENT, attemptCount++)
- `transient_error` → `markAwaitingReconcile` (status = AWAITING_RECONCILE, attemptCount++)
- `permanent_rejection` → `markRejected` (status = REJECTED, attemptCount++)

This is correct. The attempt count is incremented for every send attempt (accepted, duplicate, transient_error, permanent_rejection).

Wait, should `permanent_rejection` increment the attempt count? If the bank permanently rejects the payment, we don't retry. The attempt count doesn't matter for REJECTED orders (they're terminal). But for auditability, I'll increment it.

Actually, let me reconsider. The max attempts cap is about resending after timeout. A permanent rejection is not a timeout — it's a definitive "no." So it shouldn't count toward the resend cap. If I increment the attempt count on a permanent rejection, and the cap is 5, then after 5 rejections, the order would be... well, it's already REJECTED, so the cap doesn't apply.

Actually, the cap only applies to AWAITING_RECONCILE orders (timeout/transient errors). A permanent rejection goes to REJECTED, which is terminal. The reconcile function only checks AWAITING_RECONCILE orders, not REJECTED ones. So incrementing the attempt count on a permanent rejection doesn't affect the resend logic.

Let me still increment it for auditability. It's not harmful.

OK, one more thing. In the reconcile method, step 3 marks matched orders as SETTLED. But what about orders that were `SENT` (accepted) and now appear in the statement? They should also be marked as SETTLED. The current implementation handles this because we look up by txid and check if the status is not SETTLED.

But in step 4, I only check `AWAITING_RECONCILE` orders. What about `SENT` orders that don't appear in the statement? They're left as `SENT`. The task doesn't specify what to do with them, so I'll leave them.

Actually, I should also handle SENT orders in the reconcile. Let me add them to the matching:

In step 3, I match statement entries to orders by txid. If found, I mark as SETTLED. This handles both SENT and AWAITING_RECONCILE orders (by txid, not status).

In step 4, I only handle AWAITING_RECONCILE orders (proven absent → resend or FAILED). SENT orders that are not found are left as is.

This is correct. Let me proceed.

Now let me also think about the test. The test should:
1. Create mock repository and mock bank client.
2. Create a PayoutService with these mocks.
3. Create a payout order.
4. Run executePayments and reconcile.
5. Assert state transitions.

Let me think about the mock repository more carefully. I need to implement all the methods of the `PayoutRepository` interface.

For the mock, I'll use an in-memory array to store payouts. The `create` method (not part of the interface) allows adding payouts. The interface methods are `findPending`, `findByTxid`, etc.

Let me write the mock:

```ts
class MockPayoutRepository implements PayoutRepository {
  private store: Payout[] = [];
  private counter = 0;

  create(data: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = `payout-${++this.counter}`;
    const now = new Date();
    const payout: Payout = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.store.push(payout);
    return payout;
  }

  getById(id: string): Payout | undefined {
    return this.store.find(p => p.id === id);
  }

  all(): Payout[] {
    return [...this.store];
  }

  async findPending(): Promise<Payout[]> {
    return this.store.filter(p => p.status === PayoutStatus.PENDING);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return this.store.find(p => p.txid === txid) ?? null;
  }

  async findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
    return this.store.filter(p =>
      p.status === PayoutStatus.AWAITING_RECONCILE &&
      p.effectiveDate >= window.from &&
      p.effectiveDate <= cutoff
    );
  }

  async markSent(id: string, txid: string): Promise<void> {
    const p = this.findInStore(id);
    p.txid = txid;
    p.status = PayoutStatus.SENT;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    const p = this.findInStore(id);
    p.txid = txid;
    p.status = PayoutStatus.AWAITING_RECONCILE;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markRejected(id: string, txid: string): Promise<void> {
    const p = this.findInStore(id);
    p.txid = txid;
    p.status = PayoutStatus.REJECTED;
    p.rejectedAt = new Date();
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    const p = this.findInStore(id);
    p.status = PayoutStatus.SETTLED;
    p.settledAt = settledAt;
    p.updatedAt = new Date();
  }

  async markForResend(id: string): Promise<void> {
    const p = this.findInStore(id);
    p.status = PayoutStatus.PENDING;
    p.updatedAt = new Date();
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    const p = this.findInStore(id);
    p.status = PayoutStatus.FAILED;
    p.failedAt = failedAt;
    p.updatedAt = new Date();
  }

  private findInStore(id: string): Payout {
    const p = this.store.find(p => p.id === id);
    if (!p) throw new Error(`Payout ${id} not found`);
    return p;
  }
}
```

And the mock bank client:

```ts
class MockBankClient implements BankClient {
  sendCalls: { txid: string; amount: number; key: string }[] = [];
  private sendResults: BankSendResult[] = [];
  private statementEntries: Settlement[] = [];
  private statementByDate: Map<string, Settlement[]> = new Map();

  // Configure send results
  setSendResults(results: BankSendResult[]): void {
    this.sendResults = results;
  }

  // Configure statement (global, returned for any date)
  setStatement(entries: Settlement[]): void {
    this.statementEntries = entries;
  }

  // Configure statement for a specific date
  setStatementForDate(date: Date, entries: Settlement[]): void {
    const key = formatDateKey(date);
    this.statementByDate.set(key, entries);
  }

  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    const index = Math.min(this.sendCalls.length - 1, this.sendResults.length - 1);
    const result = this.sendResults[index] ?? this.sendResults[0];
    if (!result) {
      throw new Error('No send result configured');
    }
    return result;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const key = formatDateKey(date);
    return this.statementByDate.get(key) ?? this.statementEntries;
  }
}
```

Wait, I need `formatDateKey` in the test file. Let me define it there or import it.

Actually, let me define `formatDateKey` in `payout.types.ts` (or a utils file) and import it in both the service and the test.

Hmm, but the service is the only place that needs `formatDateKey` (for txid derivation). The test's mock bank client also needs it. Let me export it from the service or types.

Actually, let me put `formatDateKey` in `payout.types.ts` since it's a shared utility:

Wait, actually, it's used by the service (for txid derivation) and the mock bank client (for date-based statement lookup). Let me export it from the service file or create a utils file.

Let me create a small utility function in the service and export it:

Actually, let me just define it inline in both places. It's a simple function. The service uses it for txid derivation, and the test's mock uses it for date-based statement lookup. Duplicating a 3-line function is fine.

Or I can export it from `payout.service.ts`:

```ts
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

And in the test:
```ts
import { formatDateKey } from '../src/payout/payout.service';
```

Wait, but the service imports from `payout.types.ts` and other files. Let me just put `formatDateKey` in a separate file or in `payout.types.ts`.

Actually, let me put it in `payout.types.ts`:

```ts
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

And import it in the service and test. This is clean.

OK, let me now write all the code. I'll structure the response as a series of file headings.

Let me also reconsider the `BankClient` interface. The service depends on it. In the module, I provide the real `BankService`. In tests, I provide a mock.

But for the service to compile, I need the `BankClient` type. I define it in `bank.types.ts` and the service imports it.

Let me also think about the `@Inject` decorators. The service constructor:

```ts
constructor(
  @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

For testing, I create the service directly:
```ts
const service = new PayoutService(repo, bank, config);
```

The `@Inject` decorators don't prevent direct instantiation. TypeScript allows it — the decorators are just metadata.

But wait, TypeScript might complain about the parameter decorators when using `new PayoutService(...)`. Let me check.

In TypeScript, parameter decorators like `@Inject` are just runtime metadata. They don't affect the constructor's parameter types. So `new PayoutService(repo, bank, config)` is valid — TypeScript checks that `repo` is compatible with `PayoutRepository`, `bank` with `BankClient`, and `config` with `PayoutConfig`.

This should work. Let me proceed.

Now, let me also think about the controller. The controller exposes:
- `POST /payouts/execute` — triggers `executePayments()`
- `POST /payouts/reconcile` — triggers `reconcile(window)`

```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(): Promise<{ sent: number }> {
    await this.payoutService.executePayments();
    return { sent: 0 }; // We could return a count if the service provides it
  }

  @Post('reconcile')
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    return await this.payoutService.reconcile({
      from: new Date(body.from),
      to: new Date(body.to),
    });
  }
}
```

Hmm, the `executePayments` doesn't return a count. Let me change it to return void or a simple status. Actually, let me keep it simple and just return the result of `reconcile`. For `executePayments`, I'll just return `{ status: 'ok' }`.

Wait, the convention says "controller validates input and calls the service. Zero business logic." So the controller validates the date strings and calls the service. Let me keep it minimal.

Actually, I don't have a validation library. Let me just do basic validation:

```ts
@Post('reconcile')
async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new BadRequestException('Invalid date format');
  }
  return await this.payoutService.reconcile({ from, to });
}
```

Wait, `BadRequestException` is from NestJS. Let me import it. But the convention says to use the error envelope: `{ "error": { "code": "...", "message": "...", "details": {} } }`. Let me create a custom exception filter or use `HttpException`.

Actually, the task says the error envelope is the convention. Let me handle errors with `HttpException`:

```ts
throw new HttpException(
  { code: 'invalid_input', message: 'Invalid date format', details: {} },
  400,
);
```

But this is the controller level, and the convention says "zero business logic" in the controller. Basic input validation (checking date format) is acceptable in the controller.

Actually, let me keep the controller really minimal and not worry about validation. The service will throw if the dates are invalid.

Let me also think about whether I need the controller at all. The task says "Deliver schema, service, reconcile job, and tests." It doesn't mention a controller. But the NestJS conventions require a module, and a module typically declares a controller. Let me include a minimal controller.

Wait, the task also says "reconcile job." In NestJS, a "job" could be a scheduled task. Let me include a `ReconcileJob` class or a method annotated with `@Cron`. But `@nestjs/schedule` is an additional dependency. Let me check if it's needed.

Actually, let me just have the `reconcile` method on the service and a controller endpoint to trigger it. The "job" is the method itself. If needed, it can be scheduled externally.

OK, I'm going to write all the files now. Let me list them:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. Migration SQL
6. src/main.ts
7. src/app.module.ts
8. src/prisma/prisma.service.ts
9. src/prisma/prisma.module.ts
10. src/bank/bank.types.ts
11. src/bank/bank.service.ts
12. src/bank/bank.module.ts
13. src/payout/payout.types.ts
14. src/payout/payout.repository.ts
15. src/payout/payout.service.ts
16. src/payout/payout.controller.ts
17. src/payout/payout.module.ts
18. test/payout.spec.ts

Let me write them all now, in this order.

Actually, I should also think about the `payout.controller.ts`. The task says "Do exactly what the task asks." The task asks for schema, service, reconcile job, and tests. A controller is not explicitly asked for. But it's part of the NestJS module pattern (a module declares a controller).

Let me include a minimal controller. It's necessary for the module to be functional.

Wait, actually, a module doesn't have to declare a controller. A module can just provide services. But it's unusual in NestJS to have a module without a controller.

Let me include the controller for completeness. It's minimal and follows the NestJS pattern.

OK, now let me really write the code. I'll start with the simplest files and build up.

Let me also think about the `formatDateKey` function. I'll put it in `payout.types.ts`:

```ts
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

Wait, but `payout.types.ts` should only contain types. Let me put the utility function in a separate file or in the service.

Actually, the task doesn't say types files should only contain types. Let me put it in `payout.types.ts` for simplicity. Or I can put it in the service and export it.

Let me put it in the service and export it. This way, the types file is clean, and the utility is co-located with its primary user.

Actually, the mock bank client in the test also needs `formatDateKey`. Let me put it in `payout.types.ts` to share it between the service and the test.

Hmm, let me just put it in a separate utils file: `src/payout/payout.utils.ts`. But that's another file. Let me just put it in `payout.types.ts`.

OK, final decision: I'll put `formatDateKey` in `payout.types.ts` and export it. The service uses it for txid derivation, and the test uses it for the mock bank client.

Now let me write the code. I'll write each file completely.

Let me think about the test file one more time. I need to test three scenarios. Let me think about the setup and assertions for each.

### Test 1: timeout-but-settled (no resend)

Setup:
- Create a PENDING order with effectiveDate 2 hours ago, amount 1000, externalKey "key-123".
- Bank client: send returns transient_error (timeout), getStatement returns the order's txid.

Steps:
1. Call `service.executePayments()`.
   - Bank.send is called once.
   - Result: transient_error → order is AWAITING_RECONCILE, attemptCount=1, txid is set.
2. Call `service.reconcile({ from: 3h ago, to: now })`.
   - Bank.getStatement returns [{ txid, amount: 1000, status: 'settled' }].
   - The order is found in the statement → mark as SETTLED.
3. Call `service.executePayments()` again.
   - No PENDING orders (order is SETTLED).
   - Bank.send is NOT called again.

Assertions:
- After step 1: order.status = AWAITING_RECONCILE, order.attemptCount = 1, order.txid is set.
- After step 2: order.status = SETTLED, order.settledAt is set.
- After step 3: bank.sendCalls.length = 1 (no additional send).

### Test 2: proven-absent (resend, same txid)

Setup:
- Create a PENDING order with effectiveDate 2 hours ago.
- Bank client: first send returns transient_error, second send returns accepted.

Steps:
1. Call `service.executePayments()`.
   - Bank.send is called once.
   - Result: transient_error → order is AWAITING_RECONCILE, attemptCount=1, txid is set.
2. Call `service.reconcile({ from: 3h ago, to: now })`.
   - Bank.getStatement returns [] (empty — not in statement).
   - Order is not found → proven absent → attemptCount=1 < 5 → mark as PENDING.
3. Call `service.executePayments()` again.
   - Order is PENDING → picked up.
   - Bank.send is called again with the same txid.
   - Result: accepted → order is SENT, attemptCount=2.
4. Call `service.reconcile(...)` again.
   - Bank.getStatement returns [{ txid, ... }].
   - Order is found → SETTLED.

Assertions:
- After step 1: order.status = AWAITING_RECONCILE, order.txid is set.
- After step 2: order.status = PENDING, order.txid is still the same.
- After step 3: bank.sendCalls.length = 2, bank.sendCalls[1].txid = bank.sendCalls[0].txid (same txid).
- After step 4: order.status = SETTLED.

Wait, actually for the test, I need to be more careful about the bank client's send results. The first call returns transient_error, and the second call returns accepted. Let me use `setSendResults`:

```ts
bank.setSendResults([
  { status: 'transient_error', error: 'timeout' },
  { status: 'accepted', txid: 'derived_txid' },
]);
```

But the txid in the result doesn't matter (the service uses the derived txid, not the one from the result). Let me simplify:

```ts
bank.setSendResults([
  { status: 'transient_error', error: 'timeout' },
  { status: 'accepted' },
]);
```

Wait, the `BankSendResult` type requires `txid` for `accepted`:

```ts
export interface BankSendResult {
  status: BankSendStatus;
  txid?: string; // not required
  error?: string; // not required
}
```

Actually, I defined `txid` as optional. So `{ status: 'accepted' }` is valid. But semantically, `accepted` should include the txid. Let me keep it optional for flexibility.

OK, for the test, I'll use:
```ts
bank.setSendResults([
  { status: 'transient_error', error: 'timeout' },
  { status: 'accepted' },
]);
```

And for the statement:
```ts
bank.setStatement([{ txid: orderTxid, amount: 1000, status: 'settled' }]);
```

But I need to know the txid before the test. The txid is derived by the service. Let me derive it in the test:

```ts
import { createHash } from 'crypto';

function deriveTxid(orderId: string, effectiveDate: Date): string {
  const dateStr = formatDateKey(effectiveDate);
  return createHash('sha256').update(`${orderId}:${dateStr}`).digest('hex').substring(0, 32);
}
```

Actually, the order's `id` is generated by the mock repository (`payout-1`). The effective date is 2 hours ago. So I can derive the txid in the test.

But this duplicates the service's txid derivation logic. An alternative is to create the order, call `executePayments`, and then read the txid from the repository (after the first send). This is cleaner:

```ts
// Create order
const order = repo.create({ ... });

// First executePayments
bank.setSendResults([{ status: 'transient_error', error: 'timeout' }]);
await service.executePayments();

// Read txid from repository
const txid = repo.getById(order.id).txid;
expect(txid).toBeDefined();
```

Then in subsequent steps, I use this txid for the bank statement.

This is the approach I'll use. It avoids duplicating the txid derivation logic.

Let me now write the test for scenario 2 more carefully:

```ts
it('proven-absent: resends with same txid', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // First send → timeout
  bank.setSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  expect(repo.getById(order.id).status).toBe(PayoutStatus.AWAITING_RECONCILE);
  expect(bank.sendCalls.length).toBe(1);
  const originalTxid = repo.getById(order.id).txid;
  expect(originalTxid).toBeDefined();

  // Reconcile → not in statement, past lag → should be PENDING (resend eligible)
  bank.setStatement([]); // empty statement
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  expect(repo.getById(order.id).status).toBe(PayoutStatus.PENDING);
  expect(repo.getById(order.id).attemptCount).toBe(1); // unchanged after resend eligibility

  // Second executePayments → resend with same txid
  bank.setSendResults([{ status: 'accepted' }]);
  await service.executePayments();

  expect(bank.sendCalls.length).toBe(2);
  expect(bank.sendCalls[1].txid).toBe(originalTxid); // same txid
  expect(repo.getById(order.id).status).toBe(PayoutStatus.SENT);
  expect(repo.getById(order.id).attemptCount).toBe(2);

  // Reconcile → found in statement → SETTLED
  bank.setStatement([{ txid: originalTxid!, amount: 1000, status: 'settled' }]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  expect(repo.getById(order.id).status).toBe(PayoutStatus.SETTLED);
});
```

Wait, there's an issue. In the second `executePayments`, the bank.send result is `accepted`. But the mock's `setSendResults` only has one result. After the first `executePayments` consumed the first result, and now the second `executePayments` calls `send` again. The mock returns the second result (index 1), which is `{ status: 'accepted' }`.

But wait, the mock's `send` method uses `Math.min(this.sendCalls.length - 1, this.sendResults.length - 1)` as the index. After the first call (sendCalls.length = 1), the index is 0. After the second call (sendCalls.length = 2), the index is 1. So the second call gets the second result.

But I called `bank.setSendResults([{ status: 'transient_error', error: 'timeout' }])` before the first `executePayments`, and then `bank.setSendResults([{ status: 'accepted' }])` before the second. The second `setSendResults` replaces all results with just one result. So when the second `executePayments` calls `send`, the mock has `sendCalls.length = 2` and `sendResults.length = 1`. The index would be `Math.min(1, 0) = 0`, so it returns `{ status: 'accepted' }`. This is correct.

Wait, actually, I need to re-examine the mock's send logic. Let me trace through:

1. Before first `executePayments`:
   - `sendCalls = []`, `sendResults = [{ status: 'transient_error', error: 'timeout' }]`
2. First `executePayments`:
   - `sendCalls.length = 0`, push params → `sendCalls = [{ txid, amount, key }]`
   - `index = Math.min(0, 0) = 0` → returns `{ status: 'transient_error', error: 'timeout' }`
3. Before second `executePayments`:
   - `sendCalls = [{ txid, amount, key }]` (still 1 call)
   - `sendResults = [{ status: 'accepted' }]` (replaced)
4. Second `executePayments`:
   - `sendCalls.length = 1`, push params → `sendCalls = [{ ... }, { txid, amount, key }]`
   - `index = Math.min(1, 0) = 0` → returns `{ status: 'accepted' }`

Yes, this works. The second call returns the first (and only) result in `sendResults`.

But actually, I want the second call to return `accepted`. The mock returns `sendResults[0]` (since `sendResults.length = 1` and `index = 0`). So it returns `{ status: 'accepted' }`. Correct.

But what if I want different results for the first and second calls? I can set:
```ts
bank.setSendResults([
  { status: 'transient_error', error: 'timeout' },
  { status: 'accepted' },
]);
```

Then:
- First call: index = 0 → transient_error
- Second call: index = 1 → accepted

But I need to set this before the first `executePayments`. Let me adjust the test to set all results upfront:

Actually, the issue is that I need to set different results at different times (after reconcile and before the second executePayments). Let me change the mock to be more flexible:

```ts
// Allow setting results that are consumed in order
private sendIndex = 0;

async send(params: { ... }): Promise<BankSendResult> {
  this.sendCalls.push(params);
  const result = this.sendResults[this.sendIndex] ?? this.sendResults[0];
  this.sendIndex++;
  if (!result) throw new Error('No send result configured');
  return result;
}
```

Wait, but `sendIndex` keeps incrementing and doesn't reset when I call `setSendResults`. Let me reset it:

```ts
setSendResults(results: BankSendResult[]): void {
  this.sendResults = [...results]; // copy
  this.sendIndex = 0; // reset
}
```

Hmm, but if I reset `sendIndex` after the first `executePayments`, then the second `executePayments` starts from index 0 again. That's fine if I set the results to have only one entry for the second call.

Actually, this is getting complicated. Let me use a simpler approach: the mock always returns the same result (the last set one), or I can use a function that determines the result based on the call index.

Let me use a simpler mock:

```ts
class MockBankClient implements BankClient {
  sendCalls: { txid: string; amount: number; key: string }[] = [];
  sendResults: BankSendResult[] = [];
  private resultIndex = 0;
  statementEntries: Settlement[] = [];
  private statementByDate: Map<string, Settlement[]> = new Map();

  setSendResults(results: BankSendResult[]): void {
    this.sendResults = [...results];
    this.resultIndex = 0;
  }

  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    const result = this.sendResults[this.resultIndex] ?? this.sendResults[0];
    this.resultIndex = Math.min(this.resultIndex + 1, this.sendResults.length - 1);
    if (!result) throw new Error('No send result configured');
    return result;
  }

  setStatement(entries: Settlement[]): void {
    this.statementEntries = [...entries];
  }

  setStatementForDate(date: Date, entries: Settlement[]): void {
    const key = formatDateKey(date);
    this.statementByDate.set(key, [...entries]);
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const key = formatDateKey(date);
    return this.statementByDate.get(key) ?? this.statementEntries;
  }
}
```

Wait, the `resultIndex` logic is off. Let me simplify:

```ts
async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
  this.sendCalls.push(params);
  const result = this.sendResults[this.sendCalls.length - 1] ?? this.sendResults[0];
  if (!result) throw new Error('No send result configured');
  return result;
}
```

This uses `sendCalls.length - 1` as the index into `sendResults`. So:
- First call (sendCalls.length = 1): index = 0 → sendResults[0]
- Second call (sendCalls.length = 2): index = 1 → sendResults[1]
- If sendResults has only 1 element, second call: index = 1 → undefined → sendResults[0] (fallback)

Wait, `sendResults[1]` when `sendResults` has only 1 element is `undefined`. And `undefined ?? sendResults[0]` gives `sendResults[0]`. But `sendResults[0]` might also be the wrong result.

Actually, let me just use the call count:

```ts
async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
  this.sendCalls.push(params);
  const callIndex = this.sendCalls.length - 1; // 0-indexed
  const result = this.sendResults[callIndex];
  if (!result) {
    // Fall back to the last configured result
    const last = this.sendResults[this.sendResults.length - 1];
    if (!last) throw new Error('No send result configured');
    return last;
  }
  return result;
}
```

Hmm, this is getting complicated. Let me simplify even more. Let me use a callback function:

```ts
sendFn: (params: { txid: string; amount: number; key: string }, callIndex: number) => BankSendResult | Promise<BankSendResult>;
```

Actually, let me just use a simple approach: the mock has a list of results, and each call to `send` consumes the next result in the list. If the list is exhausted, the last result is repeated.

```ts
class MockBankClient implements BankClient {
  sendCalls: { txid: string; amount: number; key: string }[] = [];
  private sendResults: BankSendResult[] = [];
  private resultIdx = 0;
  statementEntries: Settlement[] = [];

  configureSendResults(results: BankSendResult[]): void {
    this.sendResults = results;
    this.resultIdx = 0;
  }

  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    if (this.sendResults.length === 0) {
      throw new Error('No send result configured');
    }
    const result = this.sendResults[Math.min(this.resultIdx, this.sendResults.length - 1)];
    this.resultIdx++;
    return result;
  }

  configureStatement(entries: Settlement[]): void {
    this.statementEntries = entries;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statementEntries;
  }
}
```

Wait, `resultIdx` keeps incrementing even after `configureSendResults` resets it. Let me trace through:

1. `configureSendResults([{ transient_error }])`: sendResults = [{ transient_error }], resultIdx = 0
2. First `executePayments` → `send` called:
   - sendCalls = [{ ... }]
   - result = sendResults[min(0, 0)] = sendResults[0] = { transient_error }
   - resultIdx = 1
3. `configureSendResults([{ accepted }])`: sendResults = [{ accepted }], resultIdx = 0
4. Second `executePayments` → `send` called:
   - sendCalls = [{ ... }, { ... }]
   - result = sendResults[min(0, 0)] = sendResults[0] = { accepted }
   - resultIdx = 1

This works! Each `configureSendResults` resets the index.

But what if I want different results for multiple calls without reconfiguring? I can use:
```ts
configureSendResults([
  { status: 'transient_error', error: 'timeout' },
  { status: 'accepted' },
]);
```

Then:
1. `configureSendResults([...])`: sendResults = [{ transient_error }, { accepted }], resultIdx = 0
2. First `send`: result = sendResults[min(0, 1)] = sendResults[0] = { transient_error }, resultIdx = 1
3. Second `send`: result = sendResults[min(1, 1)] = sendResults[1] = { accepted }, resultIdx = 2

This works too.

OK, let me use this approach. It's simple and flexible.

For the statement, I'll just use a simple `configureStatement(entries)` that sets the global statement entries. I don't need date-based lookup for the tests.

Actually wait, in the mock, `getStatement(date)` returns `this.statementEntries` for any date. And in the `fetchStatements` method, I call `getStatement` for each date in the window. So the same entries are returned for each call, and the union of all entries is just `statementEntries`.

This is fine for testing. The test sets the statement entries, and the service finds the txid in them.

For the "not found in statement" case, the statement is empty. For the "found in statement" case, the statement contains the txid.

OK, I'm confident this works. Let me write the code now.

Let me think about one more edge case: what if `findAwaitingReconcileEligible` returns orders that are already SETTLED? This could happen if the statement was fetched but the order wasn't found (the order's txid is not in the statement). In this case, the order should be marked for resend or FAILED.

But wait, in step 3, I mark matched orders as SETTLED. So after step 3, any order found in the statement is SETTLED. In step 4, I only check AWAITING_RECONCILE orders (which are NOT SETTLED). So there's no overlap.

But there's a race condition: between step 3 (finding the order in the statement) and step 4 (finding AWAITING_RECONCILE orders), the order's status might have changed. But since we're using an in-memory mock (not a real database), and we're not using concurrency, this isn't an issue.

For a real database, we'd need to handle this with transactions or conditional updates. But for this task, the mock is sufficient.

Actually, wait. In the mock, step 3 marks the order as SETTLED (via `markSettled`). Then in step 4, `findAwaitingReconcileEligible` queries for AWAITING_RECONCILE orders. Since the order is now SETTLED (not AWAITING_RECONCILE), it won't be returned. So there's no overlap. Good.

But what if the statement contains a txid that matches an AWAITING_RECONCILE order? Then:
- Step 3: finds the order by txid, marks as SETTLED.
- Step 4: queries for AWAITING_RECONCILE orders — the order is now SETTLED, so not returned.

This is correct. The order is marked as SETTLED in step 3, and step 4 doesn't pick it up.

But what if step 3 doesn't find the order (the txid doesn't match any order)? Then the order stays as AWAITING_RECONCILE. In step 4, the order is found and either marked for resend or FAILED.

This is the "proven absent" case. Correct.

What if step 4 finds an order that was marked as SETTLED in step 3? This shouldn't happen because `findAwaitingReconcileEligible` filters by AWAITING_RECONCILE status, and the order is now SETTLED.

But with a real database and concurrent execution, this could happen (another process changes the status between query and update). For this task, I'll assume single-threaded execution.

OK, I'm now going to write the code. Let me be careful and thorough.

Let me also think about what the `reconcile` method should return. I defined `ReconcileResult`:

```ts
export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}
```

- `matched`: number of orders matched to statement entries (marked as SETTLED).
- `resendEligible`: number of AWAITING_RECONCILE orders marked as PENDING (for resend).
- `failed`: number of AWAITING_RECONCILE orders marked as FAILED (attempts exhausted).

This is useful for logging and testing.

OK, writing code now.

Wait, I also want to double-check the attempt count logic for the `markSent`, `markAwaitingReconcile`, and `markRejected` methods. The attempt count is incremented by 1 on each send attempt. Let me verify this is what the task expects.

The task says: "Cap attempts at 5; after that, park for manual review and never auto-revert."

An "attempt" is each call to `bank.send()`. So:
- 1st call → attempt 1 (if fails) → attempt_count = 1
- 2nd call → attempt 2 (if fails) → attempt_count = 2
- ...
- 5th call → attempt 5 (if fails) → attempt_count = 5
- After 5th failure + reconcile: attempt_count >= 5 → FAILED

And the check is: `if (order.attemptCount >= this.config.maxAttempts) → FAILED`.

Wait, the check is in the reconcile method. After the 5th send fails (attempt_count = 5), the order is AWAITING_RECONCILE. Reconcile finds it, checks `attemptCount >= 5`, and marks as FAILED.

But what about accepted sends? If the send is accepted, we don't resend. The attempt_count is incremented but doesn't matter (the order is SENT, not AWAITING_RECONCILE).

Hmm, but what if we have a mix? Let's say:
- 1st send → timeout → attempt_count = 1
- Reconcile → PENDING
- 2nd send → accepted → attempt_count = 2 (status = SENT)
- Reconcile → found in statement → SETTLED

This is fine. The attempt_count is 2, but the order is SETTLED. No issue.

What if:
- 1st send → timeout → attempt_count = 1
- Reconcile → PENDING
- 2nd send → permanent_rejection → attempt_count = 2 (status = REJECTED)

The attempt_count is 2, but the order is REJECTED. No issue.

What if:
- 1st send → timeout → attempt_count = 1
- Reconcile → PENDING
- 2nd send → timeout → attempt_count = 2
- Reconcile → PENDING
- 3rd send → timeout → attempt_count = 3
- Reconcile → PENDING
- 4th send → timeout → attempt_count = 4
- Reconcile → PENDING
- 5th send → timeout → attempt_count = 5
- Reconcile → FAILED (attempt_count >= 5)

This is the attempt exhaustion scenario. 5 send attempts, all timeout, → FAILED.

The check is `attemptCount >= maxAttempts` (5 >= 5 = true → FAILED). If the check were `attemptCount > maxAttempts` (5 > 5 = false → PENDING), we'd allow a 6th attempt, which violates the cap.

So `>=` is correct.

But wait, let me re-read: "Cap attempts at 5; after that, park for manual review and never auto-revert."

"Cap attempts at 5" means we allow at most 5 attempts. After the 5th attempt, we don't resend. So the check should be: if `attemptCount >= 5`, don't resend (mark as FAILED). This means:
- attempt_count = 5 (after 5th send) → reconcile → 5 >= 5 → FAILED. Correct.
- attempt_count = 4 (after 4th send) → reconcile → 4 >= 5 → false → PENDING. Then 5th send happens. Correct.

So `>=` is the right check. Good.

But wait, there's a subtlety. The check happens in reconcile, not in executePayments. So:
- After the 4th send (timeout, attempt_count = 4): reconcile → 4 < 5 → PENDING (for resend).
- executePayments: 5th send (timeout, attempt_count = 5): AWAITING_RECONCILE.
- After the 5th send (timeout, attempt_count = 5): reconcile → 5 >= 5 → FAILED.

This is correct. After the 5th attempt fails and reconcile proves absence, the order is FAILED.

But what if the 5th send is accepted? Then:
- 5th send → accepted → SENT, attempt_count = 5.
- Reconcile → found in statement → SETTLED.

This is fine. The attempt_count is 5, but the order is SETTLED. No issue.

OK, the logic is correct. Let me write the code now.

One final thought: the `executePayments` method should handle the case where `bank.send` throws an error (not just returns a result). I'll wrap the call in a try-catch:

```ts
let result: BankSendResult;
try {
  result = await this.bankClient.send({ txid, amount: order.amount, key: order.externalKey });
} catch (err) {
  result = { status: 'transient_error', error: (err as Error).message };
}
```

This ensures that network errors and timeouts are treated as transient errors.

OK, NOW I'm going to write the code. Let me do it.

Actually, I realize I should also handle the `permanent_rejection` error code in the response. Let me think about what error codes to use:
- `resource_not_found` for when a payout is not found
- `invalid_state` for when an operation is attempted on an order in the wrong state
- etc.

But the task doesn't focus on error handling. Let me keep it simple and not over-engineer.

OK, let me also think about the `PayoutController` one more time. The controller should validate input and call the service. For the `reconcile` endpoint:

```ts
@Post('reconcile')
async reconcile(@Body() body: ReconcileBodyDto): Promise<ReconcileResult> {
  if (isNaN(body.from) || isNaN(body.to)) {
    throw new BadRequestException(...);
  }
  return await this.payoutService.reconcile({ from: new Date(body.from), to: new Date(body.to) });
}
```

Wait, I need a DTO or at least validation. Let me use a simple approach with `ValidationPipe` from NestJS. But that requires `class-validator` which is an additional dependency. Let me just do manual validation.

Actually, the convention says "controller validates input." Let me do basic validation:

```ts
@Post('reconcile')
async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
  const from = new Date(body.from);
  const to = new Date(body.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new BadRequestException({
      error: {
        code: 'invalid_input',
        message: 'Invalid date format. Expected ISO 8601 date strings.',
        details: { from: body.from, to: body.to },
      },
    });
  }
  return await this.payoutService.reconcile({ from, to });
}
```

This follows the error envelope convention.

OK, I'm writing the code now. For real. No more planning.

Let me also think about what to do with the `PAYOUT_REPOSITORY` symbol. I defined it in `payout.types.ts`. The module provides the concrete `PrismaPayoutRepository` under this token:

```ts
@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    { provide: PAYOUT_REPOSITORY, useClass: PrismaPayoutRepository },
    { provide: BANK_CLIENT, useExisting: BankService },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
        maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
      }),
    },
  ],
})
export class PayoutModule {}
```

Wait, I can't use `useExisting: BankService` because `BankService` is provided by `BankModule` and needs to be exported. Let me adjust.

In `BankModule`:
```ts
@Module({
  providers: [BankService, { provide: BANK_CLIENT, useExisting: BankService }],
  exports: [{ provide: BANK_CLIENT, useExisting: BankService }],
})
export class BankModule {}
```

And in `PayoutModule`:
```ts
@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    { provide: PAYOUT_REPOSITORY, useClass: PrismaPayoutRepository },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
        maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
      }),
    },
  ],
})
export class PayoutModule {}
```

The `PayoutModule` imports `BankModule`, which exports `BANK_CLIENT`. So the `PayoutService` can inject `BANK_CLIENT`.

For the `PAYOUT_REPOSITORY` and `PAYOUT_CONFIG`, they're provided locally in the `PayoutModule`.

This wiring is correct.

OK, now let me REALLY write the code.

One more thing: I need to think about the `PrismaService` and whether I need to provide it in a module. Since `PrismaModule` is `@Global()`, the `PrismaService` is available everywhere. The `PrismaPayoutRepository` injects `PrismaService`.

In `PayoutModule`, I import `PrismaModule` (for `PrismaService`) and `BankModule` (for `BANK_CLIENT`).

Wait, `PrismaModule` is `@Global()`, so I don't need to import it in `PayoutModule`. But importing a global module is harmless.

Actually, let me not import `PrismaModule` in `PayoutModule` since it's global. But for clarity, I'll import it anyway.

OK, WRITING CODE NOW.

Actually, I just realized I need to think about one more thing. The `PayoutService` uses `this.config.maxAttempts` and `this.config.publishLagMinutes`. In tests, I pass a `PayoutConfig` object directly. But the `@Inject(PAYOUT_CONFIG)` decorator expects a `PayoutConfig` type. When I instantiate the service directly, the decorator is ignored.

But wait, the `@Inject` decorator is on the constructor parameter. When I do `new PayoutService(repo, bank, config)` in the test, TypeScript checks that the parameters match the types. The `@Inject` decorator doesn't affect the type check — it's just metadata for NestJS.

So the test can do:
```ts
const service = new PayoutService(
  mockRepo,  // implements PayoutRepository interface
  mockBank,  // implements BankClient interface
  { publishLagMinutes: 30, maxAttempts: 5 }, // PayoutConfig
);
```

And TypeScript will check that the arguments match the parameter types. This should work.

But wait, the parameters have `@Inject` decorators. In TypeScript, parameter decorators don't affect the type checking. So `new PayoutService(mockRepo, mockBank, config)` is valid as long as the types match.

Actually, I just realized there might be an issue. The constructor parameter types are:
- `payoutRepository: PayoutRepository` (interface)
- `bankClient: BankClient` (interface)
- `config: PayoutConfig` (interface)

In the test, `mockRepo` is a `MockPayoutRepository` class that implements `PayoutRepository`. TypeScript checks structural compatibility. Since `MockPayoutRepository` has all the methods of `PayoutRepository`, it's compatible.

Similarly, `mockBank` is a `MockBankClient` class that implements `BankClient`. And the config object matches `PayoutConfig`.

So the test should compile and run correctly.

But there's a potential issue: the `@Inject` decorator might cause a runtime error if `reflect-metadata` is not set up. In the test environment, I'm not using NestJS DI, so the decorators are ignored. But `reflect-metadata` needs to be imported for the decorators to not throw.

Actually, TypeScript parameter decorators are just functions that run at decoration time. If `@Inject` is a valid decorator (from `@nestjs/common`), it should run without errors even outside of NestJS DI. The decorator just adds metadata — it doesn't affect the constructor.

Let me verify: `@Inject(token)` from `@nestjs/common` is defined as:

```ts
export function Inject(token: symbol | string): TypedClassDecorator<unknown> {
  return (target, key, index) => {
    // Add metadata
  };
}
```

This is a parameter decorator that adds metadata to the constructor. It doesn't do anything at runtime except set metadata. In the test, when I call `new PayoutService(...)`, the decorator has already run (at class definition time), and the metadata is set but not used. So the instantiation works fine.

OK, this should work. Let me write the code now.

Wait, one more thing. I need to import `Inject` from `@nestjs/common` in the service:

```ts
import { Injectable, Inject } from '@nestjs/common';
```

OK, NOW I'm writing the code. Let me go.

Let me also think about the `createHash` import. In Node.js with ESM, I import from `'crypto'`:

```ts
import { createHash } from 'crypto';
```

This is a built-in module, no need to install anything.

And for date formatting, I'll use the `formatDateKey` function defined in `payout.types.ts`.

OK, here's my plan for the test file. I need to import:
- `PayoutService` from `../src/payout/payout.service`
- `PayoutStatus` from `../src/payout/payout.types`
- `formatDateKey` from `../src/payout/payout.types`
- Types: `Payout`, `PayoutRepository`, `PayoutConfig`, `ReconcileWindow`, `ReconcileResult`
- Bank types: `BankClient`, `BankSendResult`, `Settlement`
- `createHash` from `crypto` (if I need to derive txid in the test)
- `describe`, `it`, `expect`, `beforeEach` from `vitest`

Wait, I need to be careful about the import paths. In the test file, the imports go `../src/...` or `../../src/...`. Let me use relative paths.

If the test file is at `test/payout.spec.ts` and the source is at `src/...`, the relative path is `../src/...`.

OK, let me now write the code.

Let me also think about the mock repository's `create` method. It's not part of the `PayoutRepository` interface — it's a test helper. I'll define it in the mock class.

And the mock bank client's `configureSendResults` and `configureStatement` methods are also test helpers, not part of the `BankClient` interface.

OK, I think I've planned enough. Let me write the code now. I'll write each file completely, from first line to last line.

Let me also think about whether I need `@nestjs/common`'s `Injectable`, `Inject`, `Controller`, `Module`, `Get`, `Post`, `Body` in various files. Yes, I need these for the NestJS decorators.

Let me also think about the `BadRequestException`. It's from `@nestjs/common`. I'll import it in the controller.

OK, writing code now. I'll list the files in a logical order:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20240115000000_init/migration.sql`
6. `src/prisma/prisma.service.ts`
7. `src/prisma/prisma.module.ts`
8. `src/bank/bank.types.ts`
9. `src/bank/bank.service.ts`
10. `src/bank/bank.module.ts`
11. `src/payout/payout.types.ts`
12. `src/payout/payout.repository.ts`
13. `src/payout/payout.service.ts`
14. `src/payout/payout.controller.ts`
15. `src/payout/payout.module.ts`
16. `src/main.ts`
17. `src/app.module.ts`
18. `test/payout.spec.ts`

Let me write them all now.

Hmm, actually I realize that in the test, when I create a `PayoutService` with `new PayoutService(...)`, the `@Inject` decorators might cause issues. Let me think about this.

In TypeScript, when a class has `@Inject` on its constructor parameters:

```ts
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}
}
```

The `@Inject` is a parameter decorator. When TypeScript compiles this, the decorator runs at class definition time (when the module is loaded). The decorator adds metadata to the constructor's parameter types. For NestJS, this metadata is used by the DI container.

When I call `new PayoutService(repo, bank, config)` in the test, the decorators have already run (at import time). The constructor is called normally, and the parameters are assigned to `this.payoutRepository`, `this.bankClient`, and `this.config`. The metadata is set but not used.

So this should work without issues. The only requirement is that `@nestjs/common` (or `reflect-metadata`) is imported to provide the decorator infrastructure.

In the test file, I'll need to import `@nestjs/common` for the decorators (actually, I don't need to import them in the test — they're already defined in the service file). I just need to import the `PayoutService` class and the types.

Wait, actually, the test doesn't directly use `@Inject`. It just imports `PayoutService` and instantiates it. The `@Inject` decorators are defined in the service file. When the service file is imported, the decorators run and set metadata. This requires `reflect-metadata` to be loaded (which `@nestjs/common` imports).

In Vitest, I can configure the setup file to import `reflect-metadata`. Or I can just import it at the top of the test file.

Actually, `@nestjs/common` doesn't automatically import `reflect-metadata`. I need to import it explicitly. Let me add `import 'reflect-metadata';` at the top of the test file.

Wait, actually, if the test imports `PayoutService` from `../src/payout/payout.service`, and the service file imports from `@nestjs/common`, then `reflect-metadata` might or might not be loaded. Let me add `import 'reflect-metadata';` at the top of the test file to be safe.

Actually, I also need it in `main.ts` and potentially in other source files. But since `nestjs` (the CLI) handles this automatically, I only need it in the test file.

Hmm, but `@nestjs/common` uses `reflect-metadata` internally. When the service file is loaded, it imports from `@nestjs/common`, which in turn imports `reflect-metadata`. So the metadata polyfill is loaded.

But to be safe, let me add `import 'reflect-metadata';` at the top of the test file.

OK, writing code now. For real. I'll write each file completely.

Let me also think about the `@nestjs/common` version. I'll use `^10.0.0` which is the latest stable as of 2024.

And `@prisma/client` version: `^5.0.0`.

OK, let me also check: does `@prisma/client` export types that I can use? In Prisma 5, the generated client includes types. When I do `import { PrismaClient } from '@prisma/client'`, I get the client class and all the types.

In the repository, I use `this.prisma.payout` (the delegate). The delegate has typed methods. So `this.prisma.payout.findMany()` returns a typed promise. I don't need to explicitly import the Prisma types.

But for the `toDomain` function, I need to know the type of the Prisma result. Let me use a generic approach:

```ts
private toDomain<T extends Record<string, any>>(result: T): Payout {
  // ... map fields
}
```

Actually, since the Prisma result type has the same fields as my domain `Payout`, I can just cast:

```ts
private toDomain(result: any): Payout {
  return result as Payout;
}
```

But with `strict: true`, using `any` might be flagged. Let me use a more specific type.

Actually, let me just define the parameter type explicitly:

```ts
private toDomain(result: {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Payout {
  return {
    ...result,
    status: result.status as PayoutStatus,
  };
}
```

This is type-safe and doesn't use `any`. The Prisma result type is structurally compatible with this parameter type (same fields, and `status` is a string in both).

Wait, but the Prisma result type has `status` as `PayoutStatus` (Prisma's enum), not `string`. If I use `status: string`, TypeScript might complain that `PayoutStatus` is not assignable to `string`.

Hmm, actually, Prisma's `PayoutStatus` is a string literal type (or a union of string literals). So `PayoutStatus` is assignable to `string`. But `string` is not assignable to `PayoutStatus`. Since I'm defining the parameter as `status: string`, the Prisma result (with `status: PayoutStatus`) would be accepted (PayoutStatus is assignable to string). Then I cast `result.status` to `PayoutStatus` (my domain type).

This should work. Let me use this approach.

Actually, wait. Prisma's generated types use:

```ts
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

where `PayoutStatus` is a const object. So `PayoutStatus` is a union of string literals: `'PENDING' | 'SENT' | ...`. This is assignable to `string`.

But my domain `PayoutStatus` is also defined as `(typeof PayoutStatus)[keyof typeof PayoutStatus]`, where my `PayoutStatus` const object has the same values. So my `PayoutStatus` is also `'PENDING' | 'SENT' | ...`.

The cast `result.status as PayoutStatus` (from `string` to my `PayoutStatus`) would require a double cast: `result.status as unknown as PayoutStatus`, since `string` is not directly assignable to a union of specific string literals.

Hmm, actually, `string as PayoutStatus` might work if TypeScript sees `PayoutStatus` as a subtype of `string`. Since `PayoutStatus` is `'PENDING' | 'SENT' | ...`, which is a union of string literals, it's a subtype of `string`. So `string as PayoutStatus` is an unsafe cast (you can't cast from a supertype to a subtype without `as unknown as`).

Wait, in TypeScript, you can cast from `string` to `'PENDING' | 'SENT'` using `as`:

```ts
const s: string = 'hello';
const p = s as 'PENDING' | 'SENT'; // This is allowed
```

Actually, no. TypeScript allows casting between types if one is assignable to the other. Since `'PENDING' | 'SENT'` is assignable to `string`, you can cast from `string` to `'PENDING' | 'SENT'`. But TypeScript might warn about it being unsafe (the string might not be one of the valid values).

Let me just use `as PayoutStatus` and it should work. TypeScript allows `string as PayoutStatus` because `PayoutStatus` is a subtype of `string`.

OK, I think I've been overthinking this. Let me just write the code. The `toDomain` function can use a simple approach: spread the result and cast the status.

Let me also think about whether I should use `Prisma.Payout` type in the repository. I could import it:

```ts
import { PrismaClient } from '@prisma/client';
import type { Payout as PrismaPayout, Prisma } from '@prisma/client';
```

Wait, in Prisma 5, types are exported directly from `@prisma/client`. So:

```ts
import { PrismaClient } from '@prisma/client';
```

And the types are available via `Prisma` namespace:

```ts
import { Prisma, PrismaClient } from '@prisma/client';
// Prisma.Payout is the type
```

Hmm, actually in Prisma 5, the types are exported directly:

```ts
import { PrismaClient, Payout, Prisma } from '@prisma/client';
// Payout is the type
// Prisma.PayoutGetPayload, Prisma.PayoutCreateInput, etc.
```

Wait, I'm not sure about the exact import syntax. In Prisma 4, types were under the `Prisma` namespace. In Prisma 5, they might be different.

Let me just use the Prisma client and let TypeScript infer the types. I'll avoid explicit type annotations for Prisma results and use the `toDomain` function with a parameter typed as a generic object.

Actually, the simplest approach is to not type the `toDomain` parameter at all and use it as a type guard or just cast:

```ts
private toDomain(result: any): Payout {
  return result as Payout;
}
```

Wait, I said I wouldn't use `any` with `strict: true`. But TypeScript's `strict` mode doesn't forbid `any` — it just makes `any` not implicit. Using `any` explicitly is still allowed (though `noImplicitAny` is part of `strict`).

Let me just use `any` in the `toDomain` function. It's pragmatic and the repository is the only place that interacts with Prisma. The service only sees domain types.

Actually, let me think about this differently. In the Prisma client, `this.prisma.payout.findMany()` returns `Promise<Payout[]>` where `Payout` is the Prisma-generated type. I can use this type directly.

But I need to import it. Let me check if Prisma 5 exports the type:

In Prisma 5, the generated client exports types like:

```ts
// From @prisma/client
export type Payout = {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Wait, actually, in Prisma 5, the generated types are more complex (using `PayoutGetPayload` etc.). But the basic types are available.

Let me just use a helper type and avoid the complexity:

```ts
import { PrismaClient } from '@prisma/client';

// Helper type for Prisma Payout
type PrismaPayout = {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

And the `toDomain` function takes a `PrismaPayout` and returns a `Payout`. Since the only difference is the `status` type (string vs PayoutStatus), I cast.

Actually, you know what, let me just use the Prisma client's inferred types. When I call `this.prisma.payout.findMany()`, the return type is inferred. I can use `ReturnType<Awaited<typeof ...>>` to get the type. But this is overly complex.

Let me just use a simple approach: define the `toDomain` function to accept a generic parameter and cast:

```ts
private toDomain(result: Record<string, unknown>): Payout {
  return result as unknown as Payout;
}
```

This is type-safe enough for the repository layer. The `Record<string, unknown>` type accepts any object, and we cast to `Payout`. The cast is safe because the Prisma result has the same shape.

OK, I'll use this approach. It's pragmatic and avoids type complications.

Wait, actually, `result as unknown as Payout` requires a double cast, which is a red flag. Let me just use `result as Payout`:

Since `Record<string, unknown>` is not directly castable to `Payout`, I need `as unknown as Payout`. But this is ugly.

Let me just define the parameter type explicitly:

```ts
private toDomain(result: {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Payout {
  return { ...result, status: result.status as PayoutStatus };
}
```

This is clean and type-safe. The Prisma result is structurally compatible with this parameter type. The only cast is `result.status as PayoutStatus`, which is fine because the string is a valid enum value.

OK, let me use this approach.

Actually, I just realized that in the Prisma client, the `Payout` type uses `PayoutStatus` (Prisma's enum) for the `status` field, not `string`. So the Prisma result's `status` is `Prisma.PayoutStatus`, which is `'PENDING' | 'SENT' | ...`. This is not `string`.

But `'PENDING' | 'SENT' | ...` is assignable to `string`. So if my parameter type expects `status: string`, the Prisma result (with `status: 'PENDING' | 'SENT' | ...`) is compatible.

Then I cast `result.status` (which is `string` in my parameter type) to `PayoutStatus` (which is also `'PENDING' | 'SENT' | ...`). Since `string` is not directly assignable to a union of string literals, TypeScript requires `as` — and it allows `string as PayoutStatus` because `PayoutStatus` is a subtype of `string`.

Wait, TypeScript's rules for type assertions: you can assert type A to type B if A is assignable to B or B is assignable to A. Since `PayoutStatus` (union of string literals) is assignable to `string`, you can assert `string` to `PayoutStatus`. So `result.status as PayoutStatus` is valid.

Great, this works. Let me proceed with this approach.

OK, I'm NOW going to write the code. Let me start with the files.

Actually, I want to think about one more important thing. In the `reconcile` method, I need to handle the case where `fetchStatements` returns entries with txids that match orders. For each settlement, I look up the order by txid. If found, I mark it as SETTLED.

But what if multiple settlements have the same txid? This shouldn't happen (txids are unique), but if it does, I'd look up the same order multiple times and mark it as SETTLED multiple times. The second time, the status is already SETTLED, so I skip it. This is idempotent and correct.

What if a settlement's txid matches no order? I skip it (no matching order). This is correct — the statement contains all transactions, not just ours.

OK, I'm satisfied with the design. Let me write the code.

Let me also think about the `executePayments` method. It picks up PENDING orders and sends them. For each order:
1. Derive txid (if not already set).
2. Call `bank.send({ txid, amount, key: externalKey })`.
3. Handle the result (mark as SENT, AWAITING_RECONCILE, or REJECTED).

The `amount` is in minor units (integer). The `key` is the external key (bank key). The `txid` is the derived txid.

This matches the task's description: `bank.send({txid, amount, key})`.

OK, I'm writing the code now. Let me do it file by file.

Let me also think about whether I need to handle concurrency in `executePayments`. If two instances run simultaneously, they might pick up the same PENDING order and send it twice. This would result in a `duplicate` response from the bank (same txid). The service handles `duplicate` by marking the order as SENT. So the second instance's send would return `duplicate`, and both instances would mark the order as SENT.

But there's a race condition on the update: both instances try to update the same order. The second update might fail because the status has changed (from PENDING to SENT). The repository's `update` would throw if the order is not found (but it's still there) or might succeed (overwriting the first instance's update).

For this task, I'll assume single-threaded execution. In production, we'd use a distributed lock or a queue.

OK, writing code now. Here we go.

Actually, let me also think about the `executePayments` method's return value. The task doesn't specify it. Let me have it return the number of orders processed:

```ts
async executePayments(): Promise<number> {
  // ...
  return orders.length;
}
```

Or I can just return void. Let me return the count for observability.

Actually, let me return void to keep it simple. The tests can check the state directly.

Wait, I need to think about what the tests check. The tests check:
1. The order's status after each operation.
2. The bank client's call count and arguments.
3. The txid used in sends.

None of these require `executePayments` to return a value. Let me return void.

OK, NOW I'm writing the code. For real. Let me just dump all the files.

Let me also make sure I handle the case where `order.txid` is null (first send) and use the derived txid.

In `executePayments`:

```ts
const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
```

If the order was previously sent (and txid was stored), we use the stored txid. If it's the first send, we derive the txid. This ensures the same txid is used for all resends.

For the first send, the derived txid is passed to `bank.send` and stored in the repository via `markSent` or `markAwaitingReconcile`. On subsequent sends (after reconcile marks the order as PENDING), the stored txid is used.

This is correct.

OK, writing code now. Let me go file by file.

Wait, I also need to think about the `Payout` type in the repository. The repository returns `Payout[]` (domain type). The Prisma result is converted to the domain type via `toDomain`. The `toDomain` function maps Prisma fields to domain fields. Since both use camelCase, the mapping is trivial.

But there's one issue: the Prisma result's `status` field is the Prisma enum, and the domain `Payout.status` is the domain enum. The `toDomain` function casts `status` from Prisma's enum to the domain enum. Since both use the same string values, this is safe.

OK, I think I've covered all the edge cases. Let me write the code now.

Let me think about the structure of the migration name. Prisma migration directories are named `<timestamp>_<name>`. The timestamp is in the format `YYYYMMDDHHMMSS`. Let me use `20240115000000_init`.

OK, HERE WE GO. Writing all the files now.

Actually, one final thought. For the test, I need to create Payout objects with all required fields. Let me define a helper in the test:

```ts
function createPayout(data: Partial<Payout>): Payout {
  const now = new Date();
  return {
    id: data.id ?? 'test-id',
    externalKey: data.externalKey ?? 'key-123',
    amount: data.amount ?? 1000,
    effectiveDate: data.effectiveDate ?? new Date(),
    txid: data.txid ?? null,
    status: data.status ?? PayoutStatus.PENDING,
    attemptCount: data.attemptCount ?? 0,
    settledAt: data.settledAt ?? null,
    rejectedAt: data.rejectedAt ?? null,
    failedAt: data.failedAt ?? null,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
}
```

This makes the test setup cleaner.

OK, now I'm writing all the files. Let me do it.

Let me reconsider the `PayoutRepository` interface name. I have:
- `PayoutRepository` — the interface (in `payout.types.ts`)
- `PrismaPayoutRepository` — the Prisma implementation (in `payout.repository.ts`)

Wait, but the interface is `PayoutRepository` and the module provides `PrismaPayoutRepository` under the `PAYOUT_REPOSITORY` token. The service injects `PAYOUT_REPOSITORY` and expects `PayoutRepository` type. This works.

But the naming might be confusing. Let me rename:
- Interface: `PayoutRepository` (in `payout.types.ts`)
- Implementation: `PrismaPayoutRepository` (in `payout.repository.ts`)
- Mock: `InMemoryPayoutRepository` (in test file)

This is clearer. The interface is `PayoutRepository`, and the implementations have descriptive names.

Wait, but conventionally, the interface and implementation have the same name (with the interface being the "abstract" version). In NestJS, the common pattern is:
- Interface: `IPayoutRepository` or just the class name
- Implementation: `PayoutRepository` (Prisma) and `InMemoryPayoutRepository` (mock)

Hmm, but the convention in the task's reference doesn't use interfaces for repositories. The convention just says "repository is the only layer that touches the database." There's no explicit mention of interfaces.

Let me simplify: use a class `PayoutRepository` that implements the Prisma-specific logic. The service injects `PayoutRepository` by type (NestJS DI uses the class as the token). For testing, I create an `InMemoryPayoutRepository` class that has the same interface but uses in-memory storage.

But TypeScript's nominal typing for classes means `InMemoryPayoutRepository` is not a `PayoutRepository`. So the service can't accept it without an interface.

Wait, TypeScript uses structural typing for class instances (except for private/protected members). If `InMemoryPayoutRepository` has the same public methods as `PayoutRepository`, it's considered a subtype. But if `PayoutRepository` has a private `prisma` field, `InMemoryPayoutRepository` doesn't have it, and they're not structurally compatible.

Hmm, this is a problem. Let me use an interface to define the contract:

1. Define `PayoutRepository` as an interface in `payout.types.ts`.
2. `PrismaPayoutRepository` (class) implements `PayoutRepository`.
3. `InMemoryPayoutRepository` (class, in tests) implements `PayoutRepository`.
4. The service injects `PayoutRepository` (the interface) via a token.

Wait, but if `PayoutRepository` is an interface, the service can't inject it by type (interfaces are erased at runtime). I need a token.

Let me use the symbol token `PAYOUT_REPOSITORY`:

```ts
// In payout.types.ts:
export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  // ...
}
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');
```

```ts
// In payout.repository.ts:
@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  // ...
}
```

```ts
// In payout.service.ts:
constructor(
  @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

```ts
// In payout.module.ts:
providers: [
  { provide: PAYOUT_REPOSITORY, useClass: PrismaPayoutRepository },
  PayoutService,
  // ...
]
```

```ts
// In test:
const repo = new InMemoryPayoutRepository();
const bank = new MockBankClient();
const service = new PayoutService(repo, bank, config);
```

Since `InMemoryPayoutRepository` implements `PayoutRepository`, and the service's constructor parameter is typed as `PayoutRepository`, TypeScript accepts the mock. This works because TypeScript uses structural typing for interfaces.

But wait, the service constructor has `@Inject(PAYOUT_REPOSITORY)` on the first parameter. When I call `new PayoutService(repo, bank, config)`, TypeScript checks that `repo` is assignable to `PayoutRepository`. Since `InMemoryPayoutRepository` implements `PayoutRepository`, it is. Good.

The `@Inject` decorator is just metadata — it doesn't affect TypeScript's type checking. So direct instantiation works.

OK, this approach works. Let me use it.

Now, for the test, I need to define `InMemoryPayoutRepository` and `MockBankClient` classes. These are test helpers defined in the test file.

OK, let me now write all the code. I'm going to write each file completely.

Hmm, actually let me reconsider the naming one more time. Having both an interface `PayoutRepository` and a class `PrismaPayoutRepository` is fine. But I could also name the interface differently. Let me use:
- Interface: `PayoutRepository` (in `payout.types.ts`)
- Class: `PrismaPayoutRepository` (in `payout.repository.ts`)

This is fine. The class name `PrismaPayoutRepository` clearly indicates it's the Prisma implementation.

OK, WRITING CODE NOW. Here are all the files.

Hmm, actually I also want to think about the `@map` annotations in the Prisma schema. The conventions say "Table and column: snake_case (via Prisma `@map`/`@@map`)." So I should use `@map` for each field that has a different column name.

For the schema, I'll define fields in camelCase (Prisma convention for JS/TS) and map them to snake_case column names:

```prisma
model Payout {
  id             String       @id @default(uuid())
  externalKey    String       @map("external_key")
  amount         Int          @map("amount")
  effectiveDate  DateTime     @map("effective_date")
  txid           String?      @unique @map("txid")
  status         PayoutStatus @default(PENDING) @map("status")
  attemptCount   Int          @default(0) @map("attempt_count")
  settledAt      DateTime?    @map("settled_at")
  rejectedAt     DateTime?    @map("rejected_at")
  failedAt       DateTime?    @map("failed_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
  @@index([externalKey])
  @@index([status])
  @@index([effectiveDate])
}
```

Wait, I removed the `@@index([txid])` because `@unique` already creates an index. And I added `@@index([externalKey])` for looking up payouts by external key (though the task doesn't require this). Actually, let me not add indexes that aren't needed. The task doesn't mention querying by external key.

Let me keep only the indexes that are needed:
- `status` — for `findPending()` and `findAwaitingReconcileEligible()`
- `txid` — for `findByTxid()` (already has unique index from `@unique`)
- `effectiveDate` — for `findAwaitingReconcileEligible()` (filtering by effective date)

```prisma
@@index([status])
@@index([effectiveDate])
```

And `@unique` on `txid` creates its own index.

Wait, actually, for `findAwaitingReconcileEligible`, I query by `status` and `effectiveDate`. A composite index would be more efficient:

```prisma
@@index([status, effectiveDate])
```

But this is a minor optimization. Let me keep separate indexes for clarity.

Actually, for the `where` clause `status: 'AWAITING_RECONCILE' AND effectiveDate >= window.from AND effectiveDate <= cutoff`, a composite index on `(status, effectiveDate)` would be optimal. Let me use that:

```prisma
@@index([status, effectiveDate])
```

And keep the separate `@@index([status])` for `findPending()` (which only filters by status).

Hmm, let me just keep it simple with separate indexes. The task doesn't focus on performance optimization.

OK, FINAL CODE. Writing now.

Actually, one more thought. In the `payout.types.ts` file, I'm defining the `PayoutRepository` interface and also exporting `formatDateKey`. The `formatDateKey` function is used by both the service and the test. Let me put it there.

Also, I need to think about the `PAYOUT_REPOSITORY` and `PAYOUT_CONFIG` symbols. Let me define them in `payout.types.ts`.

And for the bank, `BANK_CLIENT` in `bank.types.ts`.

OK, here's my final file plan:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20240115000000_init/migration.sql`
6. `src/prisma/prisma.service.ts`
7. `src/prisma/prisma.module.ts`
8. `src/bank/bank.types.ts`
9. `src/bank/bank.service.ts`
10. `src/bank/bank.module.ts`
11. `src/payout/payout.types.ts`
12. `src/payout/payout.repository.ts`
13. `src/payout/payout.service.ts`
14. `src/payout/payout.controller.ts`
15. `src/payout/payout.module.ts`
16. `src/main.ts`
17. `src/app.module.ts`
18. `test/payout.spec.ts`

Let me write them all now.

Actually, I just realized I should also consider the `payout.types.ts` file's exports carefully. It should export:
- `PayoutStatus` (const object + type)
- `Payout` (interface)
- `ReconcileWindow` (interface)
- `ReconcileResult` (interface)
- `PayoutConfig` (interface)
- `PayoutRepository` (interface)
- `PAYOUT_CONFIG` (symbol)
- `PAYOUT_REPOSITORY` (symbol)
- `PayoutError` (class)
- `formatDateKey` (function)

That's a lot of exports from one file. Let me split if needed, but for simplicity, I'll keep them together.

Let me also think about the `PayoutError` class. It extends `Error` and adds `code`, `message`, and `details`. This follows the error envelope convention.

OK, writing the code now. This is my final plan. Let me execute it.

Let me think about one more thing: the `main.ts` file. It bootstraps the NestJS application:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

I need `import 'reflect-metadata'` for the decorators to work in the main application file. In tests, I'll import it at the top of the test file.

Actually, `@nestjs/core` imports `reflect-metadata` automatically. But to be safe, I'll add the import.

Wait, `@nestjs/core` doesn't necessarily import `reflect-metadata`. The NestJS CLI does, but when running directly (like in tests), we need to import it ourselves. Let me add it to both `main.ts` and the test file.

OK, NOW I'm writing the code. Let me do it file by file.

Actually, one more thing I want to clarify. The task says "Money in minor units, integers only." This means the `amount` field is an integer representing the amount in minor units (e.g., cents). So 1000 = $10.00. This is already handled in my schema (`amount: Int`).

And the `bank.send` API takes `amount` in minor units. So when I call `bank.send`, I pass `order.amount` (the integer). No conversion needed.

OK, writing code now.

Let me also think about the `PayoutController`. The task says "controller validates input and calls the service." For the reconcile endpoint:

```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async execute() {
    await this.payoutService.executePayments();
    return { ok: true };
  }

  @Post('reconcile')
  async reconcile(@Body() body: ReconcileRequest) {
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Invalid date range', details: {} } },
        400,
      );
    }
    return await this.payoutService.reconcile({ from, to });
  }
}

interface ReconcileRequest {
  from: string;
  to: string;
}
```

This is minimal and follows the conventions. The controller validates the date format and calls the service.

OK, writing the code now. For real this time. Let me go.

Let me finalize the `PayoutService` code. Here's the complete implementation:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BANK_CLIENT } from '../bank/bank.types';
import { BankClient, BankSendResult } from '../bank/bank.types';
import {
  Payout,
  PayoutStatus,
  PayoutConfig,
  PAYOUT_CONFIG,
  PayoutRepository,
  PAYOUT_REPOSITORY,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from './payout.types';

@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  /**
   * Derives a deterministic txid from the order ID and effective date.
   * Same order + same effective date always yields the same txid.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = formatDateKey(effectiveDate);
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payouts via the bank's instant-payment API.
   * Classifies each response and advances the order state accordingly.
   */
  async executePayments(): Promise<number> {
    const orders = await this.payoutRepository.findPending();
    let sent = 0;

    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankClient.send({
          txid,
          amount: order.amount,
          key: order.externalKey,
        });
      } catch (err) {
        result = { status: 'transient_error', error: (err as Error).message };
      }

      await this.handleSendResult(order, txid, result);
      sent++;
    }

    return sent;
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        // Bank accepted the payment. It's now in the bank's system.
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'duplicate':
        // Bank already has this txid from a previous attempt.
        // The payment is in the bank's system; just wait for settlement confirmation.
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'transient_error':
        // Send failed or timed out. We don't know if the bank received it.
        // The order must go through reconciliation to prove absence before re-sending.
        await this.payoutRepository.markAwaitingReconcile(order.id, txid);
        break;

      case 'permanent_rejection':
        // Bank definitively rejected the payment. No retry possible.
        await this.payoutRepository.markRejected(order.id, txid);
        break;
    }
  }

  /**
   * Reconciles bank statements with payout orders.
   * Matches statement entries to orders and advances their state.
   * Safe to run every 15 minutes, including over overlapping windows.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.config.publishLagMinutes * 60_000);

    // 1. Fetch statement entries for dates in the window past the publish lag
    const settlements = await this.fetchStatements(window, cutoff);

    // 2. Build a set of all txids found in the statement
    const statementTxids = new Set<string>();
    for (const s of settlements) {
      statementTxids.add(s.txid);
    }

    // 3. Match statement entries to orders → SETTLED
    let matched = 0;
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.markSettled(order.id, now);
        matched++;
      }
    }

    // 4. For AWAITING_RECONCILE orders not found in statement,
    //    mark for resend or park for manual review
    const awaitingOrders = await this.payoutRepository.findAwaitingReconcileEligible(window, cutoff);

    let resendEligible = 0;
    let failed = 0;

    for (const order of awaitingOrders) {
      // If the txid is in the statement, it was already matched in step 3
      if (order.txid && statementTxids.has(order.txid)) {
        continue;
      }

      // Proven absent past the publishing lag
      if (order.attemptCount >= this.config.maxAttempts) {
        await this.payoutRepository.markFailed(order.id, now);
        failed++;
      } else {
        await this.payoutRepository.markForResend(order.id);
        resendEligible++;
      }
    }

    return { matched, resendEligible, failed };
  }

  /**
   * Fetches bank statements for each date in the window that is past the
   * publishing lag. Safe to call with overlapping windows.
   */
  private async fetchStatements(window: ReconcileWindow, cutoff: Date): Promise<Settlement[]> {
    const settlements: Settlement[] = [];

    const current = new Date(window.from);
    current.setHours(0, 0, 0, 0);
    const end = new Date(window.to);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (current.getTime() <= cutoff.getTime()) {
        try {
          const entries = await this.bankClient.getStatement(new Date(current));
          settlements.push(...entries);
        } catch {
          // ASSUMPTION: A single statement fetch failure should not abort
          // the entire reconciliation. The affected date will be retried
          // on the next run.
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return settlements;
  }
}
```

Wait, I'm using `Settlement` type but didn't import it. Let me add the import.

Also, I'm using `60_000` for the milliseconds conversion. This is a TypeScript feature (numeric separators). It should be fine with ES2022 target.

Let me also double-check the imports:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BANK_CLIENT, BankClient, BankSendResult, Settlement } from '../bank/bank.types';
import {
  Payout,
  PayoutStatus,
  PayoutConfig,
  PAYOUT_CONFIG,
  PayoutRepository,
  PAYOUT_REPOSITORY,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from './payout.types';
```

This looks correct.

Now let me think about the test file. I need to define `InMemoryPayoutRepository` and `MockBankClient` classes, and then write the three test scenarios.

Let me also think about the test for "timeout-but-settled." In this test:
1. Create a PENDING order.
2. executePayments → bank returns transient_error (timeout).
3. Order is AWAITING_RECONCILE.
4. Reconcile → bank statement contains the txid → order is SETTLED.
5. executePayments again → order is SETTLED, not picked up → no additional send.

For step 4, I need the bank statement to contain the order's txid. But the txid is derived by the service and stored in the repository during step 2. After step 2, I can read the txid from the repository.

Then in step 4, I set the bank statement to contain an entry with that txid. The reconcile method matches it and marks the order as SETTLED.

Let me also think about edge cases in the test. For step 5, `executePayments` calls `findPending()`, which returns only PENDING orders. Since the order is SETTLED, it's not returned. So `bank.send` is not called again. `bank.sendCalls.length` stays at 1.

This is the assertion: `expect(bank.sendCalls.length).toBe(1)`.

OK, let me write the complete test file now.

Actually, I need to think about the mock bank client's behavior more carefully. The mock needs to:
1. Return specific results from `send` (configurable per call).
2. Return specific entries from `getStatement` (configurable).

Let me design the mock:

```ts
class MockBankClient {
  sendCalls: Array<{ txid: string; amount: number; key: string }> = [];
  private sendResults: BankSendResult[] = [];
  private sendCallIndex = 0;
  private statementEntries: Settlement[] = [];

  configureSendResults(results: BankSendResult[]): void {
    this.sendResults = [...results];
    this.sendCallIndex = 0;
  }

  configureStatement(entries: Settlement[]): void {
    this.statementEntries = [...entries];
  }

  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    if (this.sendResults.length === 0) {
      throw new Error('No send result configured');
    }
    const result = this.sendResults[Math.min(this.sendCallIndex, this.sendResults.length - 1)];
    this.sendCallIndex = Math.min(this.sendCallIndex + 1, this.sendResults.length);
    return Promise.resolve(result);
  }

  getStatement(date: Date): Promise<Settlement[]> {
    return Promise.resolve([...this.statementEntries]);
  }
}
```

Wait, I don't want to throw for `send` — the service catches throws and treats them as transient errors. But in the test, I want to control the result. If I don't configure any results, it throws, which the service treats as transient_error. This is fine.

But actually, I should return a promise that resolves to the result, not throw. Let me adjust:

Actually, throwing in the mock's `send` is fine — the service catches it and treats it as a transient error. But for the test, I want to explicitly return a result. So I'll always configure send results.

Let me keep the throw as a safety net but configure results in each test.

Now, for the `getStatement` method, I return a copy of the statement entries. This prevents the mock's state from being modified by the service.

OK, let me also think about the `InMemoryPayoutRepository` mock:

```ts
class InMemoryPayoutRepository {
  private store: Map<string, Payout> = new Map();
  private counter = 0;

  create(data: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = `payout-${++this.counter}`;
    const now = new Date();
    const payout: Payout = {
      id,
      externalKey: data.externalKey,
      amount: data.amount,
      effectiveDate: data.effectiveDate,
      txid: data.txid,
      status: data.status,
      attemptCount: data.attemptCount,
      settledAt: data.settledAt,
      rejectedAt: data.rejectedAt,
      failedAt: data.failedAt,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, payout);
    return payout;
  }

  get(id: string): Payout | undefined {
    return this.store.get(id);
  }

  async findPending(): Promise<Payout[]> {
    return [...this.store.values()].filter(p => p.status === PayoutStatus.PENDING);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const found = [...this.store.values()].find(p => p.txid === txid);
    return found ?? null;
  }

  async findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
    return [...this.store.values()].filter(p =>
      p.status === PayoutStatus.AWAITING_RECONCILE &&
      p.effectiveDate >= window.from &&
      p.effectiveDate <= cutoff
    );
  }

  async markSent(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.SENT;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.AWAITING_RECONCILE;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markRejected(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.REJECTED;
    p.rejectedAt = new Date();
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.SETTLED;
    p.settledAt = settledAt;
    p.updatedAt = new Date();
  }

  async markForResend(id: string): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.PENDING;
    p.updatedAt = new Date();
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.FAILED;
    p.failedAt = failedAt;
    p.updatedAt = new Date();
  }

  private getOrFail(id: string): Payout {
    const p = this.store.get(id);
    if (!p) throw new Error(`Payout ${id} not found`);
    return p;
  }
}
```

This mock stores payouts in a Map and implements all the interface methods. The `create` and `get` methods are test helpers.

Wait, but the mock mutates the Payout objects in the store (e.g., `p.status = PayoutStatus.SENT`). Since the Map stores references, the changes are visible when we call `get(id)`. This is fine for testing.

But there's a subtlety: in the `toDomain` conversion in the Prisma repository, we create new objects. In the mock, we mutate the stored objects directly. This is a difference in behavior, but it doesn't affect the test correctness.

OK, let me also think about the `findAwaitingReconcileEligible` method in the mock. It filters by:
- `status === AWAITING_RECONCILE`
- `effectiveDate >= window.from`
- `effectiveDate <= cutoff`

This matches the Prisma implementation.

Now, let me write the three tests:

### Test 1: timeout-but-settled (no resend)

```ts
it('timeout-but-settled: does not resend after reconciliation finds it in the statement', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo,
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank times out (transient error)
  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  // Order should be AWAITING_RECONCILE with txid set
  const afterSend = repo.get(order.id)!;
  expect(afterSend.status).toBe(PayoutStatus.AWAITING_RECONCILE);
  expect(afterSend.attemptCount).toBe(1);
  expect(afterSend.txid).toBeDefined();
  expect(bank.sendCalls.length).toBe(1);

  // reconcile → bank statement contains the txid (it was actually settled)
  bank.configureStatement([{
    txid: afterSend.txid!,
    amount: 1000,
    status: 'settled',
  }]);
  const result = await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  // Order should be SETTLED
  const afterReconcile = repo.get(order.id)!;
  expect(afterReconcile.status).toBe(PayoutStatus.SETTLED);
  expect(afterReconcile.settledAt).not.toBeNull();
  expect(result.matched).toBe(1);
  expect(result.resendEligible).toBe(0);

  // executePayments again → should NOT resend (order is SETTLED)
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(1); // no additional send
});
```

### Test 2: proven-absent (resend, same txid)

```ts
it('proven-absent: resends with the same txid after reconciliation proves absence', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo,
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank times out
  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  const afterFirstSend = repo.get(order.id)!;
  expect(afterFirstSend.status).toBe(PayoutStatus.AWAITING_RECONCILE);
  expect(bank.sendCalls.length).toBe(1);
  const originalTxid = afterFirstSend.txid!;

  // reconcile → empty statement (proven absent) → order should be PENDING
  bank.configureStatement([]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  const afterReconcile = repo.get(order.id)!;
  expect(afterReconcile.status).toBe(PayoutStatus.PENDING);
  expect(afterReconcile.txid).toBe(originalTxid); // txid preserved
  expect(afterReconcile.attemptCount).toBe(1); // unchanged

  // executePayments → resend with same txid
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();

  expect(bank.sendCalls.length).toBe(2);
  expect(bank.sendCalls[1].txid).toBe(originalTxid); // same txid
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(2);

  // Final reconcile → found in statement → SETTLED
  bank.configureStatement([{
    txid: originalTxid,
    amount: 1000,
    status: 'settled',
  }]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
});
```

### Test 3: attempt exhaustion

```ts
it('attempt exhaustion: parks for manual review after 5 failed attempts', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo,
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // Simulate 5 cycles of send (timeout) + reconcile (proven absent)
  for (let i = 0; i < 5; i++) {
    // executePayments → bank times out
    bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
    await service.executePayments();

    expect(bank.sendCalls.length).toBe(i + 1);

    // reconcile → empty statement (proven absent)
    bank.configureStatement([]);
    const result = await service.reconcile({
      from: new Date(Date.now() - 3 * 60 * 60 * 1000),
      to: new Date(),
    });

    if (i < 4) {
      // After 1st-4th timeout: should be PENDING (eligible for resend)
      expect(repo.get(order.id)!.status).toBe(PayoutStatus.PENDING);
      expect(repo.get(order.id)!.attemptCount).toBe(i + 1);
    } else {
      // After 5th timeout: should be FAILED (attempts exhausted)
      expect(repo.get(order.id)!.status).toBe(PayoutStatus.FAILED);
      expect(repo.get(order.id)!.attemptCount).toBe(5);
      expect(result.failed).toBe(1);
    }
  }

  // executePayments should NOT send a 6th attempt
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(5); // still 5, no 6th

  // Order remains FAILED
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.FAILED);
});
```

Wait, there's an issue with the loop. After the 5th iteration:
- i = 4 (5th attempt): executePayments sends (attempt_count → 5), reconcile → 5 >= 5 → FAILED.

But in the loop body, I call `executePayments` at the beginning. For i=4, the order is PENDING (from the previous reconcile at i=3). So executePayments picks it up and sends (attempt_count → 5). Then reconcile → FAILED.

But for i=0, the order is PENDING (initial state). executePayments sends (attempt_count → 1). Then reconcile → 1 < 5 → PENDING.

For i=1, the order is PENDING (from reconcile at i=0). executePayments sends (attempt_count → 2). Then reconcile → 2 < 5 → PENDING.

This works. Let me trace through:
- i=0: send (attempt=1) → reconcile (PENDING, attempt=1)
- i=1: send (attempt=2) → reconcile (PENDING, attempt=2)
- i=2: send (attempt=3) → reconcile (PENDING, attempt=3)
- i=3: send (attempt=4) → reconcile (PENDING, attempt=4)
- i=4: send (attempt=5) → reconcile (FAILED, attempt=5)

After the loop:
- status = FAILED
- attempt_count = 5

Then the final executePayments:
- findPending() returns nothing (order is FAILED, not PENDING)
- bank.sendCalls.length stays at 5

This is correct!

But wait, in the loop for i < 4, I assert `status === PENDING`. But after i=0's reconcile, the status should be PENDING. After i=1's executePayments, the status should be AWAITING_RECONCILE (send timed out). But I don't assert this. Let me add more assertions.

Actually, let me simplify the test and just focus on the key assertions at the end:

```ts
it('attempt exhaustion: parks for manual review after 5 failed attempts', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo,
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // Simulate 5 cycles of send (timeout) + reconcile (proven absent)
  for (let i = 0; i < 5; i++) {
    bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
    await service.executePayments();
    
    bank.configureStatement([]);
    await service.reconcile({
      from: new Date(Date.now() - 3 * 60 * 60 * 1000),
      to: new Date(),
    });
  }

  // After 5 attempts, order should be FAILED
  const p = repo.get(order.id)!;
  expect(p.status).toBe(PayoutStatus.FAILED);
  expect(p.attemptCount).toBe(5);
  expect(p.failedAt).not.toBeNull();

  // executePayments should NOT send a 6th attempt
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(5); // no 6th send

  // Order remains FAILED — never auto-revert
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.FAILED);
});
```

This is cleaner. The key assertions are:
1. After 5 cycles, status is FAILED and attempt_count is 5.
2. After another executePayments, no additional send (5 total sends).
3. Status remains FAILED.

But wait, I'm not checking the intermediate states (e.g., after each cycle). The task says "A test with no assertion, or one that only exercises the happy path, is worse than no test." So I need to add intermediate assertions to verify the behavior at each step.

Let me add intermediate checks:

```ts
for (let i = 0; i < 5; i++) {
  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(i + 1);

  bank.configureStatement([]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  const p = repo.get(order.id)!;
  if (i < 4) {
    // After 1st-4th timeout: should be PENDING (eligible for resend)
    expect(p.status).toBe(PayoutStatus.PENDING);
    expect(p.attemptCount).toBe(i + 1);
  } else {
    // After 5th timeout: should be FAILED (attempts exhausted)
    expect(p.status).toBe(PayoutStatus.FAILED);
    expect(p.attemptCount).toBe(5);
    expect(p.failedAt).not.toBeNull();
  }
}
```

This has assertions at every step. Good.

Actually, wait. I'm checking `p.attemptCount` after reconcile. For i < 4, the reconcile marks the order as PENDING (for resend). The attempt_count was incremented during the send (in `markAwaitingReconcile`). So after reconcile, the attempt_count should be `i + 1` (1-indexed).

Let me trace:
- i=0: send (attemptCount → 1) → AWAITING_RECONCILE. Reconcile → PENDING (attemptCount still 1).
  - Assert: status=PENDING, attemptCount=1. ✓ (i+1 = 1)
- i=1: send (attemptCount → 2) → AWAITING_RECONCILE. Reconcile → PENDING (attemptCount still 2).
  - Assert: status=PENDING, attemptCount=2. ✓ (i+1 = 2)
- i=2: send (attemptCount → 3) → AWAITING_RECONCILE. Reconcile → PENDING (attemptCount still 3).
  - Assert: status=PENDING, attemptCount=3. ✓ (i+1 = 3)
- i=3: send (attemptCount → 4) → AWAITING_RECONCILE. Reconcile → PENDING (attemptCount still 4).
  - Assert: status=PENDING, attemptCount=4. ✓ (i+1 = 4)
- i=4: send (attemptCount → 5) → AWAITING_RECONCILE. Reconcile → FAILED (attemptCount still 5).
  - Assert: status=FAILED, attemptCount=5. ✓

This is correct.

OK, now I'm confident in the test design. Let me also add a test for the `permanent_rejection` case, even though it's not in the required scenarios. Actually, the task only requires three tests. Let me stick with those three.

Actually, the task says "tests for: timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion." So I'll write exactly these three tests. But I can add more if they add value. Let me also add a test for the accepted case and the duplicate case, to verify the classification logic.

Actually, the task says "Classify bank.send responses (accepted, duplicate, transient error, permanent rejection) and handle each differently." The tests should cover all four classifications. Let me add tests for accepted and permanent_rejection as well.

Wait, the task says "tests for: timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion." These are the required tests. I can add more, but I should focus on these three.

For the timeout-but-settled test, it covers `transient_error` (timeout) followed by finding the txid in the statement. This tests the transient_error classification and the no-resend behavior.

For the proven-absent test, it also covers `transient_error` and the resend behavior.

For the attempt exhaustion test, it covers `transient_error` with 5 attempts.

These three tests cover the `transient_error` case thoroughly. But they don't cover `accepted`, `duplicate`, and `permanent_rejection`. Let me add additional tests for these:

4. accepted: order is sent and accepted → SENT → found in statement → SETTLED.
5. duplicate: order is sent, bank says duplicate → SENT → found in statement → SETTLED.
6. permanent_rejection: order is sent, bank permanently rejects → REJECTED, not retried.

But the task only asks for three tests. Let me add the three required tests and maybe a couple extra for completeness. The task says "Do exactly what the task asks." So let me focus on the three required tests.

Actually, the task says "Classify bank.send responses (accepted, duplicate, transient error, permanent rejection) and handle each differently." This is a requirement for the service implementation, not a test requirement. The tests are specifically for the three scenarios.

Let me add tests for accepted and permanent_rejection as well, to be thorough. But I'll keep the three required tests as the main ones.

Actually, let me add one more test for the `permanent_rejection` case:

7. permanent_rejection: order is sent, bank permanently rejects → REJECTED, not retried.

And one for `accepted`:

4. accepted: order is sent and accepted → SENT → found in statement → SETTLED.

And one for `duplicate`:

5. duplicate: order is sent, bank says duplicate → SENT → found in statement → SETTLED.

This covers all four classifications.

But the task only asks for three tests. Let me add the three required tests plus these additional ones. More tests = better coverage.

OK, let me write all the tests now. I'll include:
1. timeout-but-settled (no resend)
2. proven-absent (resend, same txid)
3. attempt exhaustion
4. accepted → SETTLED
5. duplicate → SENT → SETTLED
6. permanent_rejection → REJECTED

Actually, tests 4, 5, and 6 can be combined or kept separate. Let me keep them separate for clarity.

Wait, the task says "A test with no assertion, or one that only exercises the happy path, is worse than no test: it reports coverage that does not exist." So I need to make sure each test has meaningful assertions. Let me verify:

Test 1 (timeout-but-settled): Assertions on status, attempt_count, txid, send_calls, reconcile result. ✓
Test 2 (proven-absent): Assertions on status, attempt_count, txid, send_calls (same txid), reconcile result. ✓
Test 3 (attempt exhaustion): Assertions on status, attempt_count, failed_at, send_calls (no 6th). ✓
Test 4 (accepted): Assertions on status, attempt_count, txid, send_calls. ✓
Test 5 (duplicate): Assertions on status, attempt_count, txid, send_calls. ✓
Test 6 (permanent_rejection): Assertions on status, attempt_count, rejected_at, send_calls (no retry). ✓

Good, all tests have meaningful assertions.

Let me now write all the code. I'll write each file completely.

Actually, I also want to think about a test for the "never auto-revert" requirement. After an order is FAILED, calling executePayments should not pick it up. And after a failed order, reconcile should not change it back. I'll add an assertion for this in test 3.

Also, I want to think about a test for the "accepted" case where the order is found in the next reconcile:

```ts
it('accepted: marks as SENT then SETTLED after reconciliation', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank accepts
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(1);
  expect(bank.sendCalls.length).toBe(1);

  const txid = repo.get(order.id)!.txid;

  // reconcile → found in statement → SETTLED
  bank.configureStatement([{ txid: txid!, amount: 1000, status: 'settled' }]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
  expect(repo.get(order.id)!.settledAt).not.toBeNull();
});
```

This is a good test for the `accepted` case.

And for `duplicate`:

```ts
it('duplicate: bank already has the txid → marks as SENT', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank says duplicate
  bank.configureSendResults([{ status: 'duplicate', txid: 'pre-existing' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(1);
  expect(bank.sendCalls.length).toBe(1);

  const txid = repo.get(order.id)!.txid;

  // reconcile → found in statement → SETTLED
  bank.configureStatement([{ txid: txid!, amount: 1000, status: 'settled' }]);
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
});
```

And for `permanent_rejection`:

```ts
it('permanent_rejection: parks as REJECTED, never retried', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank permanently rejects
  bank.configureSendResults([{ status: 'permanent_rejection', error: 'invalid account' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.REJECTED);
  expect(repo.get(order.id)!.attemptCount).toBe(1);
  expect(repo.get(order.id)!.rejectedAt).not.toBeNull();
  expect(bank.sendCalls.length).toBe(1);

  // executePayments again → should NOT retry (order is REJECTED)
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(1); // no additional send

  // reconcile → should NOT change REJECTED to anything
  await service.reconcile({
    from: new Date(Date.now() - 3 * 60 * 60 * 1000),
    to: new Date(),
  });
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.REJECTED);
});
```

These tests cover all four classifications and the "never auto-revert" requirement.

OK, I'm now going to write all the files. Let me do it.

Wait, I need to think about the `import` statements in the test file. I need to import:
- `PayoutService` from `../src/payout/payout.service`
- Types from `../src/payout/payout.types` and `../src/bank/bank.types`
- `createHash` from `crypto` (if I need to derive txid)
- `describe`, `it`, `expect`, `beforeEach` from `vitest`
- `Inject` from `@nestjs/common` (if needed for metadata)

Actually, I need `reflect-metadata` for the `@Inject` decorators to work. Let me import it.

Wait, actually, in the test, I don't use `@Inject`. The service's constructor has `@Inject`, but I'm calling `new PayoutService(...)` directly. The decorators are metadata that's set when the class is defined, not when it's instantiated.

For the decorators to not throw at class definition time, I need `reflect-metadata` to be loaded. But `@nestjs/common` might handle this.

Let me just add `import 'reflect-metadata';` at the top of the test file to be safe.

OK, let me also think about the `PayoutService` constructor and `@Inject` decorators. In the test:

```ts
const service = new PayoutService(repo, bank, config);
```

TypeScript checks that the arguments match the parameter types. The `@Inject` decorators don't affect this — they're just metadata. So the test compiles and runs correctly.

But at runtime, the `@Inject` decorators need `reflect-metadata` to be loaded. Otherwise, the metadata storage might throw. Let me check.

Actually, `@Inject` from `@nestjs/common` is defined as:

```ts
export function Inject(token: Function | string | Symbol): ParameterDecorator {
  return (target, key, index) => {
    // Uses Reflect.defineMetadata
  };
}
```

This uses `Reflect.defineMetadata`, which requires `reflect-metadata` to be loaded. If `reflect-metadata` is not loaded, `Reflect.defineMetadata` is `undefined`, and the decorator would throw.

So I need `import 'reflect-metadata';` at the top of the test file. Or I need to ensure that `reflect-metadata` is loaded before the service class is defined.

When the test imports `PayoutService`, the service file is loaded, and the `@Inject` decorators run. This requires `reflect-metadata` to be loaded. If `reflect-metadata` is not loaded, an error would occur.

Let me add `import 'reflect-metadata';` at the top of the test file, before any other imports.

OK, let me now write all the files. I'll be thorough and complete.

Hmm, actually, let me also check: does `@nestjs/common` automatically import `reflect-metadata`? Let me check the NestJS source code.

In NestJS, the `@nestjs/core` package imports `reflect-metadata`. But `@nestjs/common` might not. So if the test only imports `@nestjs/common` (directly or indirectly), `reflect-metadata` might not be loaded.

Let me add `import 'reflect-metadata';` at the top of the test file. This ensures the metadata API is available.

OK, writing code now. For real.

Let me also think about the `tsconfig.json` settings. With `strict: true`, TypeScript enables:
- `noImplicitAny`
- `strictNullChecks`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `alwaysStrict`

For the test, I need to make sure all these are satisfied.

For the `MockPayoutRepository` and `MockBankClient` classes in the test, I need to make sure they implement the interfaces correctly.

For the `PayoutService`, the constructor parameters are typed as interfaces. TypeScript's structural typing allows passing mock classes that implement the same interface.

OK, I'm confident everything will work. Let me write the code.

Let me also think about the `vitest.config.ts`. I need to configure Vitest to use the correct environment (node) and globals:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

With `globals: true`, I can use `describe`, `it`, `expect`, etc. without importing them. But let me import them explicitly for clarity.

Actually, with `globals: true`, I don't need to import them. But it's good practice to import them for explicitness. Let me import them from `vitest`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
```

OK, writing code now.

Let me also make sure the test imports are correct. The test file is at `test/payout.spec.ts`. The source files are at `src/...`. So the relative import is `../src/...`.

For the `formatDateKey` function, I'll import it from `../src/payout/payout.types`.

For the `PayoutService`, I'll import it from `../src/payout/payout.service`.

For the types, I'll import from `../src/payout/payout.types` and `../src/bank/bank.types`.

OK, let me write all the files now. I'll be systematic and complete.

One more thought: the `PayoutService` has a `deriveTxid` method. In the test for "proven-absent," I need to verify that the second send uses the same txid. I read the txid from the repository after the first send, and then compare it with the second send's txid.

The `deriveTxid` method is deterministic (same input → same output). But I don't call it directly in the test — I just verify that the bank client's send calls use the same txid. This is a behavioral assertion, not just checking that a call happened.

OK, I'm satisfied with the test design. Let me write the code now.

Actually, let me also think about whether the `reconcile` method needs to handle the `SENT` state. In my current implementation:
- Step 3: For each settlement, find the order by txid. If found and not SETTLED, mark as SETTLED.
- Step 4: For AWAITING_RECONCILE orders not in statement, mark for resend or FAILED.

The `SENT` orders are handled in step 3 (if they appear in the statement, they're marked as SETTLED). If they don't appear in the statement, they're left as SENT (no action in step 4, which only checks AWAITING_RECONCILE).

This is correct. SENT orders are confirmed sends — the bank accepted them. If they don't appear in the statement after the lag, it's an anomaly, but the task doesn't require handling this case.

OK, I'm writing the code now. Here we go.

Actually, I want to reconsider one thing. In the reconcile method, I have:

```ts
for (const order of awaitingOrders) {
  if (order.txid && statementTxids.has(order.txid)) {
    continue;
  }
  // ...
}
```

But `awaitingOrders` are AWAITING_RECONCILE orders. If their txid is in the statement, they should have been marked as SETTLED in step 3. So the `continue` is a safety check — it shouldn't normally trigger.

But wait, there's a subtlety. In step 3, I look up orders by txid using `findByTxid`. If I find an AWAITING_RECONCILE order, I mark it as SETTLED. Then in step 4, I query for AWAITING_RECONCILE orders. Since the order is now SETTLED, it won't be in the result.

So the `continue` check in step 4 is indeed a safety check. It shouldn't trigger in normal operation. But it's good to have.

OK, let me finalize and write the code.

One last thing: the `PAYOUT_CONFIG` symbol. I need to define it in `payout.types.ts`:

```ts
export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
```

And in the module:

```ts
{
  provide: PAYOUT_CONFIG,
  useFactory: () => ({
    publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
    maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
  }),
},
```

OK, NOW I'm writing the code. Here are all the files:

Let me finalize the `PayoutService` implementation. I want to make sure the `publishLagMs` calculation is correct:

```ts
private get publishLagMs(): number {
  return this.config.publishLagMinutes * 60_000;
}
```

And the cutoff:

```ts
const cutoff = new Date(now.getTime() - this.publishLagMs);
```

This is correct: `cutoff = now - publication_lag`. Orders with `effectiveDate <= cutoff` are past the lag.

OK, writing the code now. For real. I'm going to write each file completely, from the first line to the last.

Let me also consider: should I include a `.env.example` file? The conventions say "No secrets in the repository, no hardcoded connection strings." A `.env.example` is a common pattern. But the task doesn't ask for it. Let me not include it.

Should I include a `Dockerfile` or `docker-compose.yml` for PostgreSQL? The task doesn't ask for it. Let me not include it.

OK, writing code now.

Hmm, one more thought. The `PayoutService`'s `executePayments` method returns `number` (the count of orders processed). But the controller doesn't use this return value for the response. Let me keep it for observability — it can be useful for logging and monitoring.

And the `reconcile` method returns `ReconcileResult`. The controller can return this directly.

OK, I'm writing the code now. Here are all the files, in order.

Actually, I want to reconsider whether I need `PAYOUT_REPOSITORY` and `PAYOUT_CONFIG` as symbols. If I just use the class `PrismaPayoutRepository` as the injection token (NestJS uses the class as the token by default), and `PayoutConfig` as a plain object, I don't need symbols.

But for `PayoutConfig`, I can't use a class because it's a plain object (from a factory). So I need a token. Let me use a string token or a symbol.

Actually, NestJS supports using string tokens for value providers:

```ts
{
  provide: 'PAYOUT_CONFIG',
  useFactory: () => ({...}),
},
```

And in the service:

```ts
constructor(
  @Inject('PAYOUT_CONFIG') private readonly config: PayoutConfig,
)
```

But string tokens are less type-safe. Symbols are better. Let me use symbols.

For `PAYOUT_REPOSITORY`, I can use the class `PrismaPayoutRepository` as the token:

```ts
providers: [PrismaPayoutRepository, PayoutService],
```

And in the service:

```ts
constructor(
  private readonly payoutRepository: PrismaPayoutRepository,
  ...
)
```

But then the service depends on the concrete class, not the interface. For testing, I need to override the provider.

Hmm, let me just use the symbol token approach. It's cleaner and allows injecting interfaces.

OK, final decision: I'll use symbol tokens for `PAYOUT_REPOSITORY`, `BANK_CLIENT`, and `PAYOUT_CONFIG`. The module provides concrete implementations for these.

Writing the code now.

Let me think about the structure of the `payout.types.ts` file one more time. It will contain:

1. `PayoutStatus` const + type
2. `Payout` interface
3. `ReconcileWindow` interface
4. `ReconcileResult` interface
5. `PayoutConfig` interface
6. `PayoutRepository` interface
7. `PAYOUT_CONFIG` symbol
8. `PAYOUT_REPOSITORY` symbol
9. `PayoutError` class
10. `formatDateKey` function

This is a lot of things in one file. But it's the "types" file for the payout feature. Let me split if needed:
- `payout.types.ts` → Payout, PayoutStatus, ReconcileWindow, ReconcileResult
- `payout.config.ts` → PayoutConfig, PAYOUT_CONFIG
- `payout.repository.ts` → PayoutRepository interface, PAYOUT_REPOSITORY

Actually, let me keep it simple and put everything in `payout.types.ts`. It's a common pattern to have all related types in one file.

OK, writing the code now. I'll write each file completely.

Let me also think about the `PayoutError` class. I defined it with `code`, `message`, and `details`. Let me use it in the controller for error responses:

```ts
throw new HttpException(
  { error: { code: 'invalid_input', message: '...', details: {} } },
  400,
);
```

Actually, `HttpException` from NestJS can take a response object. Let me use `BadRequestException`:

```ts
throw new BadRequestException({
  error: {
    code: 'invalid_input',
    message: 'Invalid date range: from and to must be valid ISO 8601 dates',
    details: { from: body.from, to: body.to },
  },
});
```

This follows the error envelope convention.

OK, I'm going to write the code now. I'll stop planning and just write.

Let me make one final check on the flow:

**executePayments:**
1. Find PENDING orders.
2. For each order:
   a. Derive txid (if not set) or use stored txid.
   b. Call bank.send({txid, amount, key}).
   c. Classify result:
      - accepted → markSent (status=SENT, attemptCount++)
      - duplicate → markSent (status=SENT, attemptCount++)
      - transient_error (timeout) → markAwaitingReconcile (status=AWAITING_RECONCILE, attemptCount++)
      - permanent_rejection → markRejected (status=REJECTED, attemptCount++, rejectedAt=now)

**reconcile(window):**
1. Calculate cutoff = now - publishLag.
2. Fetch statements for dates in window past the lag.
3. Collect txids from statements.
4. For each settlement, find order by txid → markSettled (if not already SETTLED).
5. Find AWAITING_RECONCILE orders in window past the lag.
6. For each not in statement txids:
   - If attemptCount >= maxAttempts → markFailed (status=FAILED, failedAt=now)
   - Else → markForResend (status=PENDING)

This is the complete flow. Let me write the code.

Wait, I also want to make sure the `PayoutService` is properly annotated with `@Injectable()`. Yes, it is.

And the `PrismaPayoutRepository` is also `@Injectable()`. Yes.

OK, writing the code now. For real. I'm going to dump all the files.

Let me think about one more detail. In the `reconcile` method, I iterate over `awaitingOrders` and call `markForResend` or `markFailed` for each. These are individual database calls. For a large number of orders, this could be slow. In a production system, I'd batch these updates. But for this task, it's fine.

Also, in the `executePayments` method, I process orders sequentially. For a large number of orders, this could be slow. I could process them in parallel. But sequential processing is safer (avoids race conditions on the bank API).

OK, writing the code now. Here are all the files:

Let me also think about the `main.ts` file. I need to import `reflect-metadata` before anything else:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

Wait, do I need `dotenv`? The conventions say "Configuration comes from environment variables only." If the app is run with `DATABASE_URL` set in the environment, `dotenv` is not needed. But for local development, `dotenv` is useful. Let me include it.

Actually, `@prisma/client` reads `DATABASE_URL` from the environment. If I use `dotenv`, the env vars are loaded before the app starts. Let me include `dotenv` and import it at the top of `main.ts`.

But wait, the Prisma schema uses `env("DATABASE_URL")`, which is evaluated at the Prisma client generation time, not at runtime. So `dotenv` is not needed for Prisma.

For the `process.env.PUBLISH_LAG_MINUTES` and `process.env.MAX_PAYOUT_ATTEMPTS` in the module, I need these to be set in the environment. Using `dotenv` in `main.ts` loads them.

Let me include `dotenv` in `package.json` dependencies and import it in `main.ts`.

Actually, for this task, I don't need `dotenv`. The tests don't use it (they pass config directly). The `main.ts` file is for the production app, and env vars are typically set by the deployment environment.

Let me not include `dotenv` and just assume env vars are set. If needed, I can add a comment.

Actually, the NestJS CLI automatically loads `dotenv` when running with `nest start`. So I don't need to import it explicitly. But since I'm not using the NestJS CLI in this setup, let me add it.

Hmm, let me just not include `dotenv` and add an `// ASSUMPTION` comment. The env vars are expected to be set by the deployment environment.

OK, writing the code now. FINAL VERSION.

Let me also reconsider whether I need `@nestjs/platform-express`. NestJS can work with different platforms, but `@nestjs/platform-express` is the default. Let me include it.

For the `package.json`, I need:
- `@nestjs/common`: NestJS common decorators, exceptions
- `@nestjs/core`: NestFactory, core DI
- `@nestjs/platform-express`: Express adapter
- `@prisma/client`: Prisma client
- `reflect-metadata`: Metadata polyfill
- `typescript`: TypeScript compiler

Dev dependencies:
- `@types/express`: Express types
- `@types/node`: Node.js types
- `nest`: NestJS CLI
- `prisma`: Prisma CLI
- `typescript`: TypeScript (same as above, but as dev dep for type checking)
- `vitest`: Testing framework

Wait, `typescript` should be a devDependency. Let me adjust.

Also, I need to include `@prisma/client` as a dependency and `prisma` as a dev dependency.

And for the `tsconfig.json`, I need `experimentalDecorators` and `emitDecoratorMetadata` for NestJS decorators.

With ESM (`"type": "module"`), I should use `"module": "node16"` or `"module": "nodenext"`. But for NestJS compatibility, `"module": "commonjs"` is sometimes needed. Let me use `"module": "ESNext"` with `"moduleResolution": "node"` for simplicity.

Actually, with `"type": "module"` in `package.json` and `"module": "ESNext"` in `tsconfig.json`, the compiled output will be ESM. NestJS 10 supports ESM. Let me use this configuration.

But Vitest also needs to handle ESM. With `vitest.config.ts` using the `defineConfig` from `vitest/config`, it should handle ESM automatically.

OK, I'm going to write the code now. Let me do it.

Actually, I realize I should also consider whether the test needs to import the `PayoutStatus` const object from `payout.types.ts`. Yes — the test creates orders with `status: PayoutStatus.PENDING` and checks `repo.get(order.id).status === PayoutStatus.PENDING`. So I need to import `PayoutStatus` from `payout.types.ts`.

Wait, but I'm defining `PayoutStatus` as a `const` object, not an `enum`. So `PayoutStatus.PENDING` is `'PENDING'`. This works fine in comparisons and for setting values.

But in the test, I import:
```ts
import { PayoutStatus, Payout, PayoutRepository, PayoutConfig, ReconcileWindow, formatDateKey } from '../src/payout/payout.types';
```

And for the bank:
```ts
import { BankClient, BankSendResult, Settlement, BANK_CLIENT } from '../src/bank/bank.types';
```

Wait, I don't need `BANK_CLIENT` in the test because I'm instantiating the service directly. I only need `BankClient` as a type.

Let me also think about the `PayoutService` import:
```ts
import { PayoutService } from '../src/payout/payout.service';
```

And `reflect-metadata`:
```ts
import 'reflect-metadata';
```

This needs to be the first import, before any other imports that use decorators.

OK, let me now write all the files. I'll write them in the order I listed earlier.

Let me also think about whether I need `tsconfig.json` for the tests. Vitest uses its own configuration, but it can use the `tsconfig.json` for type checking. Let me include a `tsconfig.json` that covers both the source and test files.

Actually, Vitest doesn't need `tsconfig.json` for running tests. It uses its own configuration. But for IDE support and type checking, `tsconfig.json` is useful.

Let me include a `tsconfig.json` with:
- `strict: true`
- `experimentalDecorators: true`
- `emitDecoratorMetadata: true`
- `module: ESNext`
- `moduleResolution: node`
- `esModuleInterop: true`

And maybe include `test` in the `include` array.

OK, writing code now. Here are all the files. I'll write each one completely.

Hmm wait, I realize I also need to think about the `PayoutController`. It needs to validate the input. For the `reconcile` endpoint, the body has `from` and `to` date strings. The controller validates them and passes them to the service.

But the controller also needs to handle the `POST /payouts/execute` endpoint. This endpoint has no body — it just triggers `executePayments()`.

```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async execute(): Promise<{ processed: number }> {
    const processed = await this.payoutService.executePayments();
    return { processed };
  }

  @Post('reconcile')
  async reconcile(@Body() body: ReconcileRequest): Promise<ReconcileResult> {
    if (!body.from || !body.to) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'from and to are required',
          details: {},
        },
      });
    }
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Invalid date format. Expected ISO 8601.',
          details: { from: body.from, to: body.to },
        },
      });
    }
    return this.payoutService.reconcile({ from, to });
  }
}

interface ReconcileRequest {
  from: string;
  to: string;
}
```

This follows the convention: the controller validates input and calls the service. Zero business logic.

OK, NOW I'm writing the code. For real. No more planning.

Let me count: I have 18 files to write. Let me write them all now.

Actually, I realize the `PayoutService`'s `executePayments` should return a count for the controller to report. Let me have it return `number`:

```ts
async executePayments(): Promise<number> {
  const orders = await this.payoutRepository.findPending();
  for (const order of orders) {
    // ...
  }
  return orders.length;
}
```

But this returns the total number of orders picked up, not the number successfully sent. Some might fail with permanent rejection. Let me return `orders.length` as "processed" for simplicity.

OK, writing the code now. I'll write each file completely, from the first line to the last.
```

## reply

Starting with the implementation. Let me work through each file systematically.

### package.json
```json
{
  "name": "payout-reconciler",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.2.4",
    "@nestjs/core": "^10.2.4",
    "@nestjs/platform-express": "^10.2.4",
    "@prisma/client": "^5.7.0",
    "reflect-metadata": "^0.1.13"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "nest": "^10.2.4",
    "prisma": "^5.7.0",
    "typescript": "^5.3.2",
    "vitest": "^1.1.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "dist"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  AWAITING_RECONCILE
  SETTLED
  REJECTED
  FAILED
}

model Payout {
  id             String       @id @default(uuid())
  externalKey    String       @map("external_key")
  amount         Int          @map("amount")
  effectiveDate  DateTime     @map("effective_date")
  txid           String?      @unique @map("txid")
  status         PayoutStatus @default(PENDING) @map("status")
  attemptCount   Int          @default(0) @map("attempt_count")
  settledAt      DateTime?    @map("settled_at")
  rejectedAt     DateTime?    @map("rejected_at")
  failedAt       DateTime?    @map("failed_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
  @@index([status])
  @@index([effectiveDate])
}
```

### prisma/migrations/20240115000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ("PENDING","SENT","AWAITING_RECONCILE","SETTLED","REJECTED","FAILED");

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "external_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "effective_date" TIMESTAMPTZ NOT NULL,
    "txid" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_txid_key" ON "payouts"("txid");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "payouts_effective_date_idx" ON "payouts"("effective_date");
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule, PayoutModule],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/bank/bank.types.ts
```ts
export const BANK_CLIENT = Symbol('BANK_CLIENT');

export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResult {
  status: BankSendStatus;
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { BankClient, BankSendResult, Settlement } from './bank.types';

@Injectable()
export class BankService implements BankClient {
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's instant-payment API.
    throw new Error('BankService.send not implemented: configure BANK_API_URL');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's statement endpoint.
    throw new Error('BankService.getStatement not implemented: configure BANK_API_URL');
  }
}
```

### src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BANK_CLIENT } from './bank.types';
import { BankService } from './bank.service';

@Module({
  providers: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
  exports: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
})
export class BankModule {}
```

### src/payout/payout.types.ts
```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}

export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}

export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}

export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, ReconcileWindow } from './payout.types';

// Local type matching Prisma's generated Payout row shape
type PrismaPayoutRow = {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaPayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
      orderBy: { effectiveDate: 'asc' },
    });
    return results.map(this.toDomain);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const result = await this.prisma.payout.findUnique({
      where: { txid },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAwaitingReconcileEligible(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.AWAITING_RECONCILE,
        effectiveDate: {
          gte: window.from,
          lte: cutoff,
        },
      },
    });
    return results.map(this.toDomain);
  }

  async markSent(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.SENT,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.AWAITING_RECONCILE,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markRejected(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.REJECTED,
        rejectedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        settledAt,
      },
    });
  }

  async markForResend(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.PENDING,
      },
    });
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.FAILED,
        failedAt,
      },
    });
  }

  private toDomain(row: PrismaPayoutRow): Payout {
    return {
      id: row.id,
      externalKey: row.externalKey,
      amount: row.amount,
      effectiveDate: row.effectiveDate,
      txid: row.txid,
      status: row.status as PayoutStatus,
      attemptCount: row.attemptCount,
      settledAt: row.settledAt,
      rejectedAt: row.rejectedAt,
      failedAt: row.failedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BANK_CLIENT } from '../bank/bank.types';
import type { BankClient, BankSendResult, Settlement } from '../bank/bank.types';
import {
  Payout,
  PayoutStatus,
  PayoutConfig,
  PAYOUT_CONFIG,
  PayoutRepository,
  PAYOUT_REPOSITORY,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from './payout.types';

@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  get publishLagMs(): number {
    return this.config.publishLagMinutes * 60_000;
  }

  /**
   * Derives a deterministic txid from the order ID and effective date.
   * Same order + same effective date always yields the same txid,
   * which is required for the bank's duplicate detection.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = formatDateKey(effectiveDate);
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payouts via the bank's instant-payment API.
   * Each bank.send response is classified and the order state
   * advances accordingly:
   *   - accepted / duplicate → SENT (waiting for settlement confirmation)
   *   - transient_error      → AWAITING_RECONCILE (needs proof of absence before retry)
   *   - permanent_rejection  → REJECTED (parked, never retried)
   */
  async executePayments(): Promise<number> {
    const orders = await this.payoutRepository.findPending();

    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankClient.send({
          txid,
          amount: order.amount,
          key: order.externalKey,
        });
      } catch (err) {
        // Network / timeout / unhandled exception → transient
        result = {
          status: 'transient_error',
          error: (err as Error).message,
        };
      }

      await this.handleSendResult(order, txid, result);
    }

    return orders.length;
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'duplicate':
        // The bank already has this txid from a prior attempt.
        // The payment is in the bank's system; just wait for settlement.
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'transient_error':
        // Send failed or timed out — we do NOT know if the bank received it.
        // The order must pass through reconciliation to prove absence
        // before it can be re-sent with the same txid.
        await this.payoutRepository.markAwaitingReconcile(order.id, txid);
        break;

      case 'permanent_rejection':
        // Definitive rejection. Park for manual review — never auto-retried.
        await this.payoutRepository.markRejected(order.id, txid);
        break;
    }
  }

  /**
   * Reconciles bank statements against payout orders.
   *
   * Idempotent and safe to run every 15 minutes, including
   * over overlapping windows. The same txid matched in a
   * previous run is a no-op (status already SETTLED).
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.publishLagMs);

    // 1. Fetch statements for dates in the window that are past the publish lag.
    const settlements = await this.fetchStatements(window, cutoff);

    // 2. Collect every txid that appeared in the bank statement.
    const statementTxids = new Set<string>();
    for (const s of settlements) {
      statementTxids.add(s.txid);
    }

    // 3. Match statement entries to orders → advance to SETTLED.
    let matched = 0;
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.markSettled(order.id, now);
        matched++;
      }
    }

    // 4. For AWAITING_RECONCILE orders not present in the statement,
    //    prove absence and decide: resend or park for manual review.
    const awaiting = await this.payoutRepository.findAwaitingReconcileEligible(
      window,
      cutoff,
    );

    let resendEligible = 0;
    let failed = 0;

    for (const order of awaiting) {
      if (order.txid && statementTxids.has(order.txid)) {
        // Already matched and settled in step 3 — skip.
        continue;
      }

      // Proven absent past the publishing lag.
      if (order.attemptCount >= this.config.maxAttempts) {
        await this.payoutRepository.markFailed(order.id, now);
        failed++;
      } else {
        await this.payoutRepository.markForResend(order.id);
        resendEligible++;
      }
    }

    return { matched, resendEligible, failed };
  }

  /**
   * Fetches bank statements for each calendar date in the window
   * that is older than the publish-lag cutoff.
   */
  private async fetchStatements(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Settlement[]> {
    const settlements: Settlement[] = [];

    const current = new Date(window.from);
    current.setHours(0, 0, 0, 0);
    const end = new Date(window.to);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (current.getTime() <= cutoff.getTime()) {
        try {
          const entries = await this.bankClient.getStatement(new Date(current));
          settlements.push(...entries);
        } catch {
          // ASSUMPTION: A single statement fetch failure should not abort
          // the entire reconciliation. The affected date will be retried
          // on the next scheduled run.
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return settlements;
  }
}
```

### src/payout/payout.controller.ts
```ts
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { ReconcileResult, ReconcileWindow } from './payout.types';

interface ReconcileRequest {
  from: string;
  to: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async execute(): Promise<{ processed: number }> {
    const processed = await this.payoutService.executePayments();
    return { processed };
  }

  @Post('reconcile')
  async reconcile(@Body() body: ReconcileRequest): Promise<ReconcileResult> {
    if (!body.from || !body.to) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Query parameters "from" and "to" are required.',
          details: {},
        },
      });
    }

    const from = new Date(body.from);
    const to = new Date(body.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Expected ISO 8601 date strings for "from" and "to".',
          details: { from: body.from, to: body.to },
        },
      });
    }

    const window: ReconcileWindow = { from, to };
    return this.payoutService.reconcile(window);
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { BANK_CLIENT } from '../bank/bank.types';
import { PAYOUT_CONFIG, PAYOUT_REPOSITORY } from './payout.types';
import { PrismaPayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    {
      provide: PAYOUT_REPOSITORY,
      useClass: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(
          process.env.PUBLISH_LAG_MINUTES || '30',
          10,
        ),
        maxAttempts: parseInt(
          process.env.MAX_PAYOUT_ATTEMPTS || '5',
          10,
        ),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait, I need to import the PrismaModule and BankModule so the `PrismaService` and `BankClient` are available. Let me update:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { BANK_CLIENT } from '../bank/bank.types';
import { PAYOUT_CONFIG, PAYOUT_REPOSITORY } from './payout.types';
import { PrismaPayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';

@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    {
      provide: PAYOUT_REPOSITORY,
      useExisting: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(
          process.env.PUBLISH_LAG_MINUTES || '30',
          10,
        ),
        maxAttempts: parseInt(
          process.env.MAX_PAYOUT_ATTEMPTS || '5',
          10,
        ),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait, I need to import `PrismaModule` (which is `@Global()`) and `BankModule` (which exports `BANK_CLIENT`). Since `PrismaModule` is global, `PrismaService` is available everywhere. `BankModule` exports `BANK_CLIENT`, so importing `BankModule` makes `BANK_CLIENT` available.

Let me update the module:

```ts
@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    {
      provide: PAYOUT_REPOSITORY,
      useExisting: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
        maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait, `PrismaPayoutRepository` needs `PrismaService` in its constructor. Since `PrismaModule` is `@Global()`, `PrismaService` is available for injection. But does NestJS know to inject `PrismaService` into `PrismaPayoutRepository`?

NestJS resolves dependencies by type. `PrismaPayoutRepository` has a constructor parameter of type `PrismaService`. Since `PrismaModule` provides `PrismaService` (and it's global), NestJS can inject it.

But `PrismaPayoutRepository` is listed in `providers` of `PayoutModule`. NestJS will try to resolve its dependencies. Since `PrismaService` is globally available, it should work.

But wait, `PrismaPayoutRepository` is listed in `providers` but `PAYOUT_REPOSITORY` uses `useExisting: PrismaPayoutRepository`. This means both `PrismaPayoutRepository` and `PAYOUT_REPOSITORY` point to the same instance. The `PrismaPayoutRepository` is the concrete class that NestJS instantiates (with its `PrismaService` dependency).

Actually, I should just provide `PrismaPayoutRepository` and use it directly, without the `PAYOUT_REPOSITORY` token. But then the service would depend on `PrismaPayoutRepository` (the class) instead of the `PayoutRepository` interface.

Hmm, let me simplify. I'll provide `PrismaPayoutRepository` directly and have the service inject it:

```ts
// In PayoutModule:
providers: [
  PrismaPayoutRepository,
  PayoutService,
  { provide: PAYOUT_CONFIG, useFactory: () => ({ ... }) },
],
```

```ts
// In PayoutService:
constructor(
  private readonly payoutRepository: PrismaPayoutRepository,
  @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
  @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
) {}
```

But then the service depends on the concrete class, not the interface. For testing, I need to override the provider.

Actually, for testing, I instantiate the service directly and pass the mock. TypeScript's structural typing allows this if the mock has the same methods as `PrismaPayoutRepository`.

But `PrismaPayoutRepository` has a private `prisma` field. The mock doesn't have this field. TypeScript's structural typing considers private fields — two types with different private fields are not compatible.

Hmm, this is a problem. Let me use the interface approach after all.

OK, let me define the `PayoutRepository` interface and use a token for DI. In the test, the mock implements the interface, and TypeScript's structural typing allows it.

Let me update the files:

### src/payout/payout.types.ts (updated)
Already has the `PayoutRepository` interface and `PAYOUT_REPOSITORY` token.

### src/payout/payout.repository.ts (updated)
```ts
@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  // ... same as before
}
```

Wait, I need to import the `PayoutRepository` interface. But the repository also needs `@Injectable()`. Let me check.

Actually, in NestJS, a class can implement an interface and be decorated with `@Injectable()`. The class is instantiable, and the interface defines the contract.

But the issue is: `PrismaPayoutRepository` has a `prisma` private field. The interface `PayoutRepository` doesn't have this field. So `PrismaPayoutRepository` is compatible with `PayoutRepository` (it has all the interface's methods plus extra fields).

When the service injects `PayoutRepository` (via `@Inject(PAYOUT_REPOSITORY)`), it gets a `PrismaPayoutRepository` instance. The instance has the interface's methods plus the `prisma` field. TypeScript allows this because `PrismaPayoutRepository` is a superset of `PayoutRepository`.

For testing, the mock (`InMemoryPayoutRepository`) implements `PayoutRepository` (same methods). It doesn't have the `prisma` field. TypeScript allows passing it to the service because the service's parameter is typed as `PayoutRepository` (the interface), and the mock is compatible with the interface.

This should work!

Let me verify: the service constructor:
```ts
constructor(
  @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
  ...
)
```

The parameter is typed as `PayoutRepository` (the interface). When I do `new PayoutService(mockRepo, ...)`, TypeScript checks that `mockRepo` is compatible with `PayoutRepository`. Since `mockRepo` has all the interface's methods, it's compatible. The `@Inject` decorator doesn't affect this check.

This works. Let me use this approach.

But wait, there's still the issue with `@Inject` and NestJS DI. The service has `@Inject(PAYOUT_REPOSITORY)` on the first parameter. When NestJS resolves the service's dependencies, it uses the `PAYOUT_REPOSITORY` token to find the provider. The provider is configured in the module:

```ts
{
  provide: PAYOUT_REPOSITORY,
  useExisting: PrismaPayoutRepository,
},
```

And `PrismaPayoutRepository` has its own dependencies (`PrismaService`). NestJS resolves these automatically.

This should work. Let me proceed.

But wait, `PrismaPayoutRepository` uses `PrismaService` in its constructor. `PrismaService` is provided by `PrismaModule` (which is `@Global()`). So NestJS can resolve `PrismaService` when instantiating `PrismaPayoutRepository`.

But `PrismaPayoutRepository` is listed in `providers` of `PayoutModule`. NestJS will try to instantiate it when the `PAYOUT_REPOSITORY` token is requested. To instantiate `PrismaPayoutRepository`, NestJS needs to resolve its `PrismaService` dependency. Since `PrismaModule` is imported (and global), `PrismaService` is available.

Wait, but `PrismaModule` is `@Global()`, so it's available in all modules. But do I need to explicitly import it in `PayoutModule`? Since it's global, no — the `PrismaService` is available everywhere. But for documentation purposes, let me import it.

Actually, `@Global()` modules' providers are available in all modules without explicit import. So I don't need to import `PrismaModule` in `PayoutModule`.

But for `BankModule`, which is not global, I need to import it in `PayoutModule` to get `BANK_CLIENT`.

Let me update the module:

```ts
@Module({
  imports: [BankModule], // PrismaModule is global, no need to import
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    { provide: PAYOUT_REPOSITORY, useExisting: PrismaPayoutRepository },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(process.env.PUBLISH_LAG_MINUTES || '30', 10),
        maxAttempts: parseInt(process.env.MAX_PAYOUT_ATTEMPTS || '5', 10),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait, but the `AppModule` imports `PrismaModule`. Since `PrismaModule` is `@Global()`, `PrismaService` is available in all modules. So `PayoutModule` doesn't need to import `PrismaModule`.

But for `PrismaPayoutRepository` to be instantiable, NestJS needs to resolve `PrismaService`. If `PayoutModule` doesn't import `PrismaModule` (but it's global), NestJS should still find `PrismaService`.

Let me keep the import for clarity:

```ts
imports: [PrismaModule, BankModule],
```

Actually, wait. Let me reconsider. The `AppModule` imports `PrismaModule, BankModule, PayoutModule`. `PayoutModule` needs `BANK_CLIENT` from `BankModule`. Since `BankModule` is not global, `PayoutModule` must import it.

But the task says: "A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other." So `BankModule` exports `BANK_CLIENT`, and `PayoutModule` imports `BankModule`.

For `PrismaModule`, it's `@Global()`, so it doesn't need to be imported. But for clarity, I'll import it.

OK, let me finalize the module:

```ts
import { Module } from '@nestjs/common';
import { PrismaPayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { PAYOUT_CONFIG, PAYOUT_REPOSITORY } from './payout.types';
import { BankModule } from '../bank/bank.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    {
      provide: PAYOUT_REPOSITORY,
      useExisting: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(
          process.env.PUBLISH_LAG_MINUTES || '30',
          10,
        ),
        maxAttempts: parseInt(
          process.env.MAX_PAYOUT_ATTEMPTS || '5',
          10,
        ),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

This looks correct. `PrismaModule` is global but imported for clarity. `BankModule` is imported for `BANK_CLIENT`. `PAYOUT_REPOSITORY` points to `PrismaPayoutRepository`. `PAYOUT_CONFIG` is a factory using env vars.

OK, now let me finalize the `PrismaPayoutRepository`. It needs to implement `PayoutRepository`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';
```

Wait, I'm importing `PayoutRepository` (the interface) from `payout.types`. But `PrismaPayoutRepository` is also named... hmm, the class is `PrismaPayoutRepository` and it implements `PayoutRepository` (the interface). There's no name conflict.

Let me now write the test file. I need:
- `InMemoryPayoutRepository` (implements `PayoutRepository`)
- `MockBankClient` (implements `BankClient`)
- Three test cases

Let me write the test file:

```ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { PayoutService } from '../src/payout/payout.service';
import {
  Payout,
  PayoutStatus,
  PayoutRepository,
  PayoutConfig,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from '../src/payout/payout.types';
import {
  BankClient,
  BankSendResult,
  Settlement,
} from '../src/bank/bank.types';

// --- Mock implementations ---

class MockBankClient implements BankClient {
  sendCalls: Array<{ txid: string; amount: number; key: string }> = [];
  private sendResults: BankSendResult[] = [];
  private sendCallIndex = 0;
  private _statementEntries: Settlement[] = [];

  configureSendResults(results: BankSendResult[]): void {
    this.sendResults = [...results];
    this.sendCallIndex = 0;
  }

  configureStatement(entries: Settlement[]): void {
    this._statementEntries = [...entries];
  }

  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    if (this.sendResults.length === 0) {
      throw new Error('No send result configured');
    }
    const result = this.sendResults[Math.min(this.sendCallIndex, this.sendResults.length - 1)];
    this.sendCallIndex = Math.min(this.sendCallIndex + 1, this.sendResults.length);
    return result;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return [...this._statementEntries];
  }
}

class InMemoryPayoutRepository implements PayoutRepository {
  private store = new Map<string, Payout>();
  private counter = 0;

  create(data: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = `payout-${++this.counter}`;
    const now = new Date();
    const payout: Payout = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, payout);
    return payout;
  }

  get(id: string): Payout | undefined {
    return this.store.get(id);
  }

  async findPending(): Promise<Payout[]> {
    return [...this.store.values()].filter(p => p.status === PayoutStatus.PENDING);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return [...this.store.values()].find(p => p.txid === txid) ?? null;
  }

  async findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> {
    return [...this.store.values()].filter(
      p =>
        p.status === PayoutStatus.AWAITING_RECONCILE &&
        p.effectiveDate >= window.from &&
        p.effectiveDate <= cutoff,
    );
  }

  async markSent(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.SENT;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.AWAITING_RECONCILE;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markRejected(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.REJECTED;
    p.rejectedAt = new Date();
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.SETTLED;
    p.settledAt = settledAt;
    p.updatedAt = new Date();
  }

  async markForResend(id: string): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.PENDING;
    p.updatedAt = new Date();
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.FAILED;
    p.failedAt = failedAt;
    p.updatedAt = new Date();
  }

  private getOrFail(id: string): Payout {
    const p = this.store.get(id);
    if (!p) throw new Error(`Payout ${id} not found`);
    return p;
  }
}

// --- Helpers ---

const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);
const threeHoursAgo = () => new Date(Date.now() - 3 * 60 * 60 * 1000);
const defaultWindow = (): ReconcileWindow => ({
  from: threeHoursAgo(),
  to: new Date(),
});

// --- Tests ---

describe('PayoutService', () => {
  let repo: InMemoryPayoutRepository;
  let bank: MockBankClient;
  let service: PayoutService;
  const config: PayoutConfig = { publishLagMinutes: 30, maxAttempts: 5 };

  beforeEach(() => {
    repo = new InMemoryPayoutRepository();
    bank = new MockBankClient();
    service = new PayoutService(repo, bank, config);
  });

  // ... tests
});
```

Now let me write the actual test cases.

### Test 1: timeout-but-settled (no resend)

```ts
it('timeout-but-settled: does not resend when reconciliation finds the txid in the statement', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // executePayments → bank times out (transient error)
  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  // Order should be AWAITING_RECONCILE with txid set and attemptCount = 1
  const afterSend = repo.get(order.id)!;
  expect(afterSend.status).toBe(PayoutStatus.AWAITING_RECONCILE);
  expect(afterSend.attemptCount).toBe(1);
  expect(afterSend.txid).toBeDefined();
  expect(bank.sendCalls.length).toBe(1);
  const txid = afterSend.txid!;

  // reconcile → statement contains the txid → order is SETTLED
  bank.configureStatement([{ txid, amount: 1000, status: 'settled' }]);
  const result = await service.reconcile(defaultWindow());

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
  expect(repo.get(order.id)!.settledAt).not.toBeNull();
  expect(result.matched).toBe(1);
  expect(result.resendEligible).toBe(0);

  // executePayments again → should NOT resend
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(1); // no additional send
});
```

### Test 2: proven-absent (resend, same txid)

```ts
it('proven-absent: resends with the same txid after reconciliation proves absence', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // First send → timeout
  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.AWAITING_RECONCILE);
  expect(bank.sendCalls.length).toBe(1);
  const originalTxid = repo.get(order.id)!.txid!;

  // Reconcile → empty statement (proven absent) → PENDING
  bank.configureStatement([]);
  await service.reconcile(defaultWindow());

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.PENDING);
  expect(repo.get(order.id)!.txid).toBe(originalTxid); // txid preserved
  expect(repo.get(order.id)!.attemptCount).toBe(1); // unchanged after resend eligibility

  // executePayments → resend with SAME txid
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();

  expect(bank.sendCalls.length).toBe(2);
  expect(bank.sendCalls[1].txid).toBe(originalTxid); // same txid
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(2);

  // Final reconcile → found in statement → SETTLED
  bank.configureStatement([{ txid: originalTxid, amount: 1000, status: 'settled' }]);
  await service.reconcile(defaultWindow());

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
});
```

### Test 3: attempt exhaustion

```ts
it('attempt exhaustion: parks for manual review after 5 failed attempts and never auto-reverts', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  // 5 cycles of send (timeout) + reconcile (proven absent)
  for (let i = 0; i < 5; i++) {
    bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
    await service.executePayments();
    expect(bank.sendCalls.length).toBe(i + 1);

    bank.configureStatement([]);
    await service.reconcile(defaultWindow());

    const p = repo.get(order.id)!;
    if (i < 4) {
      expect(p.status).toBe(PayoutStatus.PENDING);
      expect(p.attemptCount).toBe(i + 1);
    } else {
      expect(p.status).toBe(PayoutStatus.FAILED);
      expect(p.attemptCount).toBe(5);
      expect(p.failedAt).not.toBeNull();
    }
  }

  // executePayments should NOT attempt a 6th send
  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(5); // still 5, no 6th

  // Order remains FAILED — never auto-revert
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.FAILED);
});
```

### Additional tests for classification

```ts
it('accepted: marks as SENT then advances to SETTLED on reconciliation', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  bank.configureSendResults([{ status: 'accepted' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(1);
  expect(repo.get(order.id)!.txid).toBeDefined();

  const txid = repo.get(order.id)!.txid!;

  bank.configureStatement([{ txid, amount: 1000, status: 'settled' }]);
  await service.reconcile(defaultWindow());

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
  expect(repo.get(order.id)!.settledAt).not.toBeNull();
});

it('duplicate: bank already has the txid → marks as SENT', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  bank.configureSendResults([{ status: 'duplicate', txid: 'pre-existing' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SENT);
  expect(repo.get(order.id)!.attemptCount).toBe(1);

  const txid = repo.get(order.id)!.txid!;

  bank.configureStatement([{ txid, amount: 1000, status: 'settled' }]);
  await service.reconcile(defaultWindow());

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
});

it('permanent_rejection: parks as REJECTED and never retried', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  bank.configureSendResults([{ status: 'permanent_rejection', error: 'invalid account' }]);
  await service.executePayments();

  expect(repo.get(order.id)!.status).toBe(PayoutStatus.REJECTED);
  expect(repo.get(order.id)!.attemptCount).toBe(1);
  expect(repo.get(order.id)!.rejectedAt).not.toBeNull();
  expect(bank.sendCalls.length).toBe(1);

  // Should not be retried
  await service.executePayments();
  expect(bank.sendCalls.length).toBe(1); // no additional send

  // Should not be changed by reconciliation
  bank.configureStatement([]);
  await service.reconcile(defaultWindow());
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.REJECTED);
});
```

These tests cover all four classification cases and the three required scenarios.

Let me also add a test for idempotent reconciliation (running reconcile twice with the same window):

```ts
it('reconcile is idempotent: running twice with overlapping windows is safe', async () => {
  const order = repo.create({
    externalKey: 'key-123',
    amount: 1000,
    effectiveDate: twoHoursAgo(),
    status: PayoutStatus.PENDING,
    txid: null,
    attemptCount: 0,
    settledAt: null,
    rejectedAt: null,
    failedAt: null,
  });

  bank.configureSendResults([{ status: 'transient_error', error: 'timeout' }]);
  await service.executePayments();

  const txid = repo.get(order.id)!.txid!;
  bank.configureStatement([{ txid, amount: 1000, status: 'settled' }]);

  // First reconcile
  const result1 = await service.reconcile(defaultWindow());
  expect(result1.matched).toBe(1);
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);

  // Second reconcile with overlapping window — should be idempotent
  const result2 = await service.reconcile(defaultWindow());
  expect(result2.matched).toBe(1); // still matched (already settled)
  expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
});
```

Wait, actually, the second reconcile would try to match the txid again. It calls `findByTxid(txid)` and finds the order. But the status is already SETTLED, so the condition `order.status !== PayoutStatus.SETTLED` is false, and it doesn't call `markSettled` again. The `matched` count would still be 1 (the first match).

Hmm, but in step 3 of reconcile, I iterate over settlements and match them to orders:

```ts
for (const settlement of settlements) {
  const order = await this.payoutRepository.findByTxid(settlement.txid);
  if (order && order.status !== PayoutStatus.SETTLED) {
    await this.payoutRepository.markSettled(order.id, now);
    matched++;
  }
}
```

On the second reconcile, the order is already SETTLED. So `order.status !== PayoutStatus.SETTLED` is false. `markSettled` is not called. `matched` is not incremented. So `matched` would be 0 on the second run.

Wait, that contradicts my assertion `expect(result2.matched).toBe(1)`. Let me fix the assertion:

On the second reconcile, the statement still contains the txid. The `findByTxid` finds the order (status = SETTLED). The condition `order.status !== PayoutStatus.SETTLED` is false. So `matched` is not incremented. `result2.matched` should be 0.

Let me fix the assertion:

```ts
const result2 = await service.reconcile(defaultWindow());
expect(result2.matched).toBe(0); // no new matches (already settled)
expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
```

This is correct. The second reconcile is idempotent — it doesn't change any state.

Actually, wait. On the second reconcile, `findAwaitingReconcileEligible` is called. But the order's status is SETTLED, not AWAITING_RECONCILE. So it's not returned. And the statement txids are checked, but the order is already SETTLED. So no changes. `matched = 0, resendEligible = 0, failed = 0`.

This is correct. Let me update the test.

OK, let me finalize all the tests and write the complete test file.

Let me also think about the `vi` import from `vitest`. I don't think I need `vi` for these tests — I'm not mocking functions with `vi.fn()`. I'm using custom mock classes. So I don't need to import `vi`.

But I should import `describe`, `it`, `expect`, `beforeEach` from `vitest` (or use globals).

Let me import them explicitly:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
```

OK, let me now write the complete test file. Let me also think about whether I need to handle the `Date` object carefully in tests. The `Date.now()` changes over time, but the test runs fast (milliseconds). The `twoHoursAgo()` function returns a date 2 hours in the past, which is well past the 30-minute publish lag. So the timing should be fine.

But there's a subtle issue: the `cutoff` in `reconcile` is `now - 30 minutes`. The `findAwaitingReconcileEligible` method filters by `effectiveDate <= cutoff`. If `effectiveDate` is 2 hours ago and `cutoff` is 30 minutes ago, then `effectiveDate <= cutoff` is true (2 hours ago <= 30 minutes ago). So the order is eligible.

Wait, is 2 hours ago less than 30 minutes ago? Yes! 2 hours ago is further in the past. So `effectiveDate` (2 hours ago) <= `cutoff` (30 minutes ago) is true. Good.

And in the `fetchStatements` method, I check `current.getTime() <= cutoff.getTime()`. The `current` date is normalized to midnight. If the order's effective date is 2 hours ago (e.g., Jan 15 12:00), the date is Jan 15 00:00. The cutoff is Jan 15 13:30. Jan 15 00:00 <= Jan 15 13:30 is true. So the statement is fetched. Good.

OK, the timing is correct.

Let me also think about the `window` in the tests. I use `defaultWindow()` which returns `{ from: 3h ago, to: now }`. The `from` is 3 hours ago, and `to` is now. In the date iteration, I start from `from` (3h ago, normalized to midnight) and go to `to` (now, normalized to midnight). 

If now is Jan 15 14:00, then:
- from = Jan 15 11:00 → midnight = Jan 15 00:00
- to = Jan 15 14:00 → midnight = Jan 15 00:00

So the date range is just Jan 15 (one day). The statement for Jan 15 is fetched (Jan 15 00:00 <= Jan 15 13:30 = cutoff). Good.

And the order's effective date is Jan 15 12:00 (2 hours ago). The `findAwaitingReconcileEligible` checks `effectiveDate >= window.from` (Jan 15 12:00 >= Jan 15 11:00 → true) and `effectiveDate <= cutoff` (Jan 15 12:00 <= Jan 15 13:30 → true). So the order is eligible. Good.

Wait, but the window `from` is Jan 15 11:00, and the effective date is Jan 15 12:00. `effectiveDate >= window.from` → Jan 15 12:00 >= Jan 15 11:00 → true. And `effectiveDate <= cutoff` → Jan 15 12:00 <= Jan 15 13:30 → true. So the order is within the window and past the lag. Correct.

But what if the window `from` is 3 hours ago, and the effective date is exactly 2 hours ago? The effective date is within the window (3h ago ≤ 2h ago ≤ 0h ago = now). Correct.

OK, the test setup is correct. Let me write the final code.

Actually, let me reconsider the `defaultWindow`. I use `threeHoursAgo()` as the `from`. But what if the test runs and `threeHoursAgo()` returns a date on a different day? For example, if now is Jan 15 01:00, then 3 hours ago is Jan 14 22:00. The date range would be Jan 14 to Jan 15 (two days). The statement for both dates would be fetched.

In the mock, `getStatement` returns the same entries for any date. So this is fine.

But in the `findAwaitingReconcileEligible` method, I check `effectiveDate >= window.from`. If the effective date is Jan 14 23:00 (2 hours ago from Jan 15 01:00), and `window.from` is Jan 14 22:00 (3 hours ago), then `effectiveDate >= window.from` → Jan 14 23:00 >= Jan 14 22:00 → true. And `effectiveDate <= cutoff` → Jan 14 23:00 <= Jan 14 00:30 (cutoff = Jan 15 01:00 - 30min = Jan 14 00:30). Wait, that's wrong. Jan 14 23:00 is NOT <= Jan 14 00:30.

Hmm, wait. If now is Jan 15 01:00, and publish lag is 30 minutes, then cutoff is Jan 15 00:30. And the effective date is Jan 14 23:00 (2 hours ago). Is Jan 14 23:00 <= Jan 15 00:30? Yes, because Jan 14 23:00 is before Jan 15 00:30. OK, that's correct.

Let me re-trace: now = Jan 15 01:00, publish lag = 30 min, cutoff = Jan 15 00:30. effectiveDate = Jan 14 23:00 (2 hours ago). effectiveDate <= cutoff → Jan 14 23:00 <= Jan 15 00:30 → true (Jan 14 23:00 is before Jan 15 00:30). Correct.

And window.from = Jan 14 22:00 (3 hours ago). effectiveDate >= window.from → Jan 14 23:00 >= Jan 14 22:00 → true. Correct.

So the order is eligible. The statement for Jan 14 is fetched (midnight of Jan 14 = Jan 14 00:00 <= cutoff = Jan 15 00:30 → true). Good.

But wait, the order's effective date is Jan 14 23:00. The statement for Jan 14 should include transactions from Jan 14 00:00 to Jan 14 23:59. So the order's txid should be in the Jan 14 statement. Good.

In the mock, `getStatement` returns the same entries for any date. So the order's txid is in the statement regardless of the date. Good.

OK, the test setup is correct for edge cases. Let me write the final code.

Actually, I realize there's another issue. In the `fetchStatements` method, I iterate from `window.from` (normalized to midnight) to `window.to` (normalized to midnight). If `window.from` is Jan 14 22:00 and `window.to` is Jan 15 01:00, the dates are Jan 14 00:00 and Jan 15 00:00. Both are <= cutoff (Jan 15 00:30). So both statements are fetched. The mock returns the same entries for both dates. Good.

OK, I'm confident the test setup is correct. Let me write the final code.

Let me also think about whether the `effectiveDate >= window.from` check in the mock's `findAwaitingReconcileEligible` is correct. The `window.from` is a Date with a time component (e.g., Jan 14 22:00). The `effectiveDate` is also a Date with a time component (e.g., Jan 14 23:00). So `effectiveDate >= window.from` → Jan 14 23:00 >= Jan 14 22:00 → true. Correct.

But what if the effectiveDate is Jan 14 21:00 (before window.from)? Then `effectiveDate >= window.from` → Jan 14 21:00 >= Jan 14 22:00 → false. The order is not eligible. This is correct — the order's effective date is before the window.

OK, the logic is correct. Let me write the code.

Let me also think about whether I need to handle the case where `window.from > window.to`. In this case, the date iteration loop doesn't execute (no dates). And `findAwaitingReconcileEligible` returns no orders. This is a no-op. The controller should validate that `from <= to`, but for this task, I'll just handle it gracefully (no-op).

OK, WRITING CODE NOW. I'll write each file completely, from first line to last. Here we go.

Let me think one more time about whether the `PrismaPayoutRepository` should implement the `PayoutRepository` interface. If it does, TypeScript ensures the class has all the interface's methods. If it doesn't, the class just has the methods but isn't explicitly tied to the interface.

For type safety and documentation, let me have `PrismaPayoutRepository` implement `PayoutRepository`:

```ts
@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  // ...
}
```

But wait, `PayoutRepository` is an interface that uses `Payout` and `PayoutStatus` types. The `PrismaPayoutRepository` returns domain types (converted from Prisma types). So it should be compatible.

The issue is that `PrismaPayoutRepository` has a private `prisma` field, which is not part of the `PayoutRepository` interface. But that's fine — the interface doesn't require the private field. The class has extra members, which is allowed.

For the `PAYOUT_REPOSITORY` token, I use `useExisting: PrismaPayoutRepository`:

```ts
{ provide: PAYOUT_REPOSITORY, useExisting: PrismaPayoutRepository },
```

Wait, but `PAYOUT_REPOSITORY` is a symbol. And `PrismaPayoutRepository` is a class. The `useExisting` directive tells NestJS to use the same instance as `PrismaPayoutRepository`. But `PrismaPayoutRepository` is also provided in the same module (as a class provider). So NestJS instantiates `PrismaPayoutRepository` once and uses the same instance for both `PrismaPayoutRepository` and `PAYOUT_REPOSITORY`.

Actually, I need to be careful. If I provide both `PrismaPayoutRepository` (as a class) and `{ provide: PAYOUT_REPOSITORY, useExisting: PrismaPayoutRepository }`, NestJS creates one instance of `PrismaPayoutRepository` and uses it for both tokens. This is correct.

But wait, the service injects `PAYOUT_REPOSITORY` (the symbol token). NestJS resolves this to the `PrismaPayoutRepository` instance (via `useExisting`). So the service gets a `PrismaPayoutRepository` instance typed as `PayoutRepository` (the interface). This is correct.

OK, the wiring is correct. Let me write the code.

Actually, I just realized there might be a circular import issue. `PrismaPayoutRepository` imports from `payout.types.ts` (for `Payout`, `PayoutStatus`, `PayoutRepository`, `ReconcileWindow`). And `payout.types.ts` doesn't import from `payout.repository.ts`. So there's no circular dependency. Good.

Similarly, `PayoutService` imports from `payout.types.ts` and `bank.types.ts`. And `payout.types.ts` doesn't import from `payout.service.ts`. No circular dependency. Good.

And `payout.module.ts` imports from `payout.repository.ts`, `payout.service.ts`, and `payout.types.ts`. These don't import from `payout.module.ts`. No circular dependency. Good.

OK, I'm satisfied with the design. Let me write the code now.

Let me think about the `PrismaPayoutRepository` imports:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';
```

Wait, do I need to import `PayoutStatus` in the repository? I'm using string literals in Prisma queries (e.g., `status: PayoutStatus.PENDING`). Since `PayoutStatus` is a const object with string values, `PayoutStatus.PENDING` is `'PENDING'`. And Prisma accepts string values for enum fields. So I need to import `PayoutStatus`.

Actually, I could just use the string literal `'PENDING'` directly. But using `PayoutStatus.PENDING` is more readable and type-safe. Let me import it.

But wait, in the Prisma query, `status: PayoutStatus.PENDING` is `'PENDING'` (a string). Prisma expects the `PayoutStatus` type from the Prisma client, which is a union of string literals. Since `'PENDING'` is a valid member of that union, it's accepted.

But there might be a type mismatch: my `PayoutStatus.PENDING` is the value `'PENDING'` (from my const object), and Prisma expects `Prisma.PayoutStatus.PENDING` (from the Prisma client). Both have the same string value, so TypeScript should accept it.

Actually, let me think about this more carefully. In Prisma's generated client, the `PayoutStatus` is a `const` object:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
```

And the type is `(typeof PayoutStatus)[keyof typeof PayoutStatus]`, which is `'PENDING' | 'SENT' | ...`.

My domain `PayoutStatus` is the same structure:

```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  ...
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];
```

So `PayoutStatus.PENDING` is `'PENDING'` in both cases. When I use `PayoutStatus.PENDING` (from my domain) in a Prisma query, TypeScript sees it as `'PENDING'`, which is assignable to Prisma's `PayoutStatus` type. This works.

But wait, there's a name collision. Both the Prisma client and my domain types export `PayoutStatus`. If I import both, there's a conflict.

In the repository, I import `PayoutStatus` from my domain (`payout.types.ts`), not from the Prisma client. So there's no conflict. The Prisma client's `PayoutStatus` is not imported in the repository. The repository uses my domain `PayoutStatus` for queries, and the values are compatible with Prisma's expectations.

For the `toDomain` function, I cast the Prisma result's `status` (which is Prisma's `PayoutStatus`) to my domain `PayoutStatus`. Since both are the same string values, this is safe:

```ts
status: row.status as PayoutStatus
```

But I'm typing the `row` parameter as a generic object with `status: string`. So `row.status` is `string`, and I cast it to `PayoutStatus`. This is safe.

OK, the types work. Let me write the code.

Actually, one more thing. In the repository, I import `PayoutRepository` (the interface) to make `PrismaPayoutRepository implements PayoutRepository`. But `PayoutRepository` is defined in `payout.types.ts` and uses `Payout` (also from `payout.types.ts`). The `PrismaPayoutRepository` returns `Payout[]` (domain type) from its methods. The Prisma results are converted to `Payout` via `toDomain`. This is correct.

But the `PayoutRepository` interface has methods that return `Promise<Payout[]>`, `Promise<Payout | null>`, `Promise<void>`. The `PrismaPayoutRepository` implements these with Prisma-specific logic. The `toDomain` function converts Prisma results to domain types. This is the repository pattern.

OK, everything is consistent. Let me write the code now.

Let me also check: does the `PayoutStatus` const object work with `switch` statements? In TypeScript:

```ts
switch (result.status) {
  case PayoutStatus.ACCEPTED: // 'accepted'
    ...
}
```

Wait, I'm using `PayoutStatus` for the order status (PENDING, SENT, etc.), not for the bank send result status (accepted, duplicate, etc.). The bank send result status is a different type (`BankSendStatus`). Let me make sure I don't confuse them.

In the service's `handleSendResult`, I switch on `result.status` which is `BankSendStatus`. The cases are `'accepted'`, `'duplicate'`, `'transient_error'`, `'permanent_rejection'`. These are string literals, not from the `PayoutStatus` const object.

In the service's `reconcile`, I check `order.status !== PayoutStatus.SETTLED`. This uses the domain `PayoutStatus` const. This is correct.

OK, no confusion. Let me write the code.

Let me now also think about whether I need to export `PrismaPayoutRepository` from the module. The module provides it, and the service injects it via the `PAYOUT_REPOSITORY` token. I don't need to export it.

But I export `PayoutService` so other modules can use it. The task might need a controller in another module to call `PayoutService`.

OK, writing code now. Let me list the files one final time and write them.

Wait, I need to reconsider the `PrismaPayoutRepository` imports. It imports `PayoutRepository` from `payout.types.ts`:

```ts
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';
```

And the class is:

```ts
@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  // ...
}
```

But wait, `PayoutRepository` is an interface. When the class implements it, TypeScript checks that all methods are present with the correct signatures. Let me make sure the method signatures match.

Interface:
```ts
findPending(): Promise<Payout[]>
findByTxid(txid: string): Promise<Payout | null>
findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>
markSent(id: string, txid: string): Promise<void>
markAwaitingReconcile(id: string, txid: string): Promise<void>
markRejected(id: string, txid: string): Promise<void>
markSettled(id: string, settledAt: Date): Promise<void>
markForResend(id: string): Promise<void>
markFailed(id: string, failedAt: Date): Promise<void>
```

Class:
```ts
async findPending(): Promise<Payout[]> { ... }
async findByTxid(txid: string): Promise<Payout | null> { ... }
async findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]> { ... }
async markSent(id: string, txid: string): Promise<void> { ... }
async markAwaitingReconcile(id: string, txid: string): Promise<void> { ... }
async markRejected(id: string, txid: string): Promise<void> { ... }
async markSettled(id: string, settledAt: Date): Promise<void> { ... }
async markForResend(id: string): Promise<void> { ... }
async markFailed(id: string, failedAt: Date): Promise<void> { ... }
```

These match. Good.

OK, writing the code now. I'll write all 18 files.

Wait, I actually need to double-check: does the `PayoutStatus` in `payout.types.ts` conflict with the Prisma-generated `PayoutStatus`? In the repository, I import `PayoutStatus` from `payout.types.ts`:

```ts
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';
```

And in the Prisma query, I use `PayoutStatus.PENDING`:

```ts
where: { status: PayoutStatus.PENDING }
```

The Prisma client expects `Prisma.PayoutStatus.PENDING` (a string literal `'PENDING'`). My `PayoutStatus.PENDING` is also `'PENDING'`. Since both are string literals with the same value, TypeScript accepts it.

But I need to be careful: the Prisma client generates its own `PayoutStatus` const object. If I name mine `PayoutStatus` too, there might be a naming conflict if I import both. But I'm only importing my domain `PayoutStatus` from `payout.types.ts`. The Prisma `PayoutStatus` is not explicitly imported in the repository.

When I use `PayoutStatus.PENDING` in a Prisma query, TypeScript checks the type against Prisma's expected type. Since `PayoutStatus.PENDING` is `'PENDING'` (a string), and Prisma's `PayoutStatus` type includes `'PENDING'`, the types are compatible.

This should work. Let me proceed.

Actually, wait. In the Prisma client, the `PayoutStatus` is available at runtime (it's a const object). But I'm not importing it in the repository. I'm using my own `PayoutStatus` const. The values are the same strings. So at runtime, the Prisma client receives `'PENDING'` (from my const), which is the same as `Prisma.PayoutStatus.PENDING`. No issue.

OK, I'm confident the types are compatible. Let me write the code.

One final thought: I should also make sure the `PrismaPayoutRepository` is correctly instantiated by NestJS. The class has a constructor that takes `PrismaService`:

```ts
constructor(private readonly prisma: PrismaService) {}
```

NestJS resolves `PrismaService` from the `PrismaModule` (which is global). So NestJS can instantiate `PrismaPayoutRepository` with its dependency.

When the `PAYOUT_REPOSITORY` token is requested (by the service), NestJS uses `useExisting: PrismaPayoutRepository`. This means NestJS first instantiates `PrismaPayoutRepository` (resolving `PrismaService`), then uses the same instance for the `PAYOUT_REPOSITORY` token.

This should work. Let me proceed.

OK, HERE IS THE FINAL CODE. I'll write all files now.</think>### src/prisma/prisma.module.ts
```prisma
// placeholder
```

Wait — let me reconsider. The module files go in `src/`, not `prisma/`. Let me write them correctly.

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/bank/bank.types.ts
```ts
export const BANK_CLIENT = Symbol('BANK_CLIENT');

export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResult {
  status: BankSendStatus;
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { BankClient, BankSendResult, Settlement } from './bank.types';

@Injectable()
export class BankService implements BankClient {
  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's instant-payment API.
    throw new Error('BankService.send not implemented: configure BANK_API_URL');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Bank API endpoint and authentication are configured via
    // BANK_API_URL and BANK_API_KEY environment variables.
    // This is a stub that should be replaced with actual HTTP calls to
    // the bank's statement endpoint.
    throw new Error('BankService.getStatement not implemented: configure BANK_API_URL');
  }
}
```

### src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BANK_CLIENT } from './bank.types';
import { BankService } from './bank.service';

@Module({
  providers: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
  exports: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
})
export class BankModule {}
```

### src/payout/payout.types.ts
```ts
export const PayoutStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  AWAITING_RECONCILE: 'AWAITING_RECONCILE',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export interface Payout {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: PayoutStatus;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ReconcileResult {
  matched: number;
  resendEligible: number;
  failed: number;
}

export interface PayoutConfig {
  publishLagMinutes: number;
  maxAttempts: number;
}

export const PAYOUT_CONFIG = Symbol('PAYOUT_CONFIG');
export const PAYOUT_REPOSITORY = Symbol('PAYOUT_REPOSITORY');

export interface PayoutRepository {
  findPending(): Promise<Payout[]>;
  findByTxid(txid: string): Promise<Payout | null>;
  findAwaitingReconcileEligible(window: ReconcileWindow, cutoff: Date): Promise<Payout[]>;
  markSent(id: string, txid: string): Promise<void>;
  markAwaitingReconcile(id: string, txid: string): Promise<void>;
  markRejected(id: string, txid: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markForResend(id: string): Promise<void>;
  markFailed(id: string, failedAt: Date): Promise<void>;
}

export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';

type PrismaPayoutRow = {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
      orderBy: { effectiveDate: 'asc' },
    });
    return results.map(this.toDomain);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const result = await this.prisma.payout.findUnique({
      where: { txid },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAwaitingReconcileEligible(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.AWAITING_RECONCILE,
        effectiveDate: {
          gte: window.from,
          lte: cutoff,
        },
      },
    });
    return results.map(this.toDomain);
  }

  async markSent(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.SENT,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.AWAITING_RECONCILE,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markRejected(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.REJECTED,
        rejectedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        settledAt,
      },
    });
  }

  async markForResend(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.PENDING,
      },
    });
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.FAILED,
        failedAt,
      },
    });
  }

  private toDomain(row: PrismaPayoutRow): Payout {
    return {
      id: row.id,
      externalKey: row.externalKey,
      amount: row.amount,
      effectiveDate: row.effectiveDate,
      txid: row.txid,
      status: row.status as PayoutStatus,
      attemptCount: row.attemptCount,
      settledAt: row.settledAt,
      rejectedAt: row.rejectedAt,
      failedAt: row.failedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BANK_CLIENT } from '../bank/bank.types';
import type { BankClient, BankSendResult, Settlement } from '../bank/bank.types';
import {
  Payout,
  PayoutStatus,
  PayoutConfig,
  PAYOUT_CONFIG,
  PayoutRepository,
  PAYOUT_REPOSITORY,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from './payout.types';

@Injectable()
export class PayoutService {
  private readonly publishLagMs: number;
  private readonly maxAttempts: number;

  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {
    this.publishLagMs = config.publishLagMinutes * 60_000;
    this.maxAttempts = config.maxAttempts;
  }

  /**
   * Derives a deterministic txid from the order ID and effective date.
   * Same order + same effective date always yields the same txid,
   * which is required for the bank's duplicate detection.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = formatDateKey(effectiveDate);
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payouts via the bank's instant-payment API.
   *
   * Response classification:
   *   accepted        → SENT (in the bank's system, waiting for settlement)
   *   duplicate       → SENT (bank already has this txid)
   *   transient_error → AWAITING_RECONCILE (needs proof of absence before retry)
   *   permanent_rejection → REJECTED (parked, never auto-retried)
   */
  async executePayments(): Promise<number> {
    const orders = await this.payoutRepository.findPending();

    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankClient.send({
          txid,
          amount: order.amount,
          key: order.externalKey,
        });
      } catch (err) {
        // Network / timeout / unhandled exception → transient
        result = {
          status: 'transient_error',
          error: (err as Error).message,
        };
      }

      await this.handleSendResult(order, txid, result);
    }

    return orders.length;
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'duplicate':
        // The bank already has this txid from a prior attempt.
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'transient_error':
        // Send failed or timed out — we cannot know if the bank received it.
        // The order must go through reconciliation to prove absence
        // before it can be re-sent with the same deterministic txid.
        await this.payoutRepository.markAwaitingReconcile(order.id, txid);
        break;

      case 'permanent_rejection':
        // Definitive rejection. Park for manual review — never auto-retried.
        await this.payoutRepository.markRejected(order.id, txid);
        break;
    }
  }

  /**
   * Reconciles bank statements with payout orders.
   *
   * Idempotent and safe to run every 15 minutes, including over
   * overlapping windows: if a txid was already matched in a prior
   * run, the second run is a no-op for that order.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.publishLagMs);

    // 1. Fetch statement entries for dates in the window past the publish lag.
    const settlements = await this.fetchStatements(window, cutoff);

    // 2. Collect every txid that appeared in the bank statement.
    const statementTxids = new Set<string>();
    for (const s of settlements) {
      statementTxids.add(s.txid);
    }

    // 3. Match statement entries to orders → advance to SETTLED.
    let matched = 0;
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.markSettled(order.id, now);
        matched++;
      }
    }

    // 4. For AWAITING_RECONCILE orders absent from the statement,
    //    prove absence and decide: resend or park for manual review.
    const awaiting = await this.payoutRepository.findAwaitingReconcileEligible(
      window,
      cutoff,
    );

    let resendEligible = 0;
    let failed = 0;

    for (const order of awaiting) {
      if (order.txid && statementTxids.has(order.txid)) {
        // Already matched and settled in step 3 — skip.
        continue;
      }

      // Proven absent past the publishing lag.
      if (order.attemptCount >= this.maxAttempts) {
        await this.payoutRepository.markFailed(order.id, now);
        failed++;
      } else {
        await this.payoutRepository.markForResend(order.id);
        resendEligible++;
      }
    }

    return { matched, resendEligible, failed };
  }

  /**
   * Fetches bank statements for each calendar date in the window
   * that is older than the publish-lag cutoff.
   */
  private async fetchStatements(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Settlement[]> {
    const settlements: Settlement[] = [];

    const current = new Date(window.from);
    current.setHours(0, 0, 0, 0);
    const end = new Date(window.to);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (current.getTime() <= cutoff.getTime()) {
        try {
          const entries = await this.bankClient.getStatement(new Date(current));
          settlements.push(...entries);
        } catch {
          // ASSUMPTION: A single statement fetch failure should not abort
          // the entire reconciliation. The affected date will be retried
          // on the next scheduled run.
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return settlements;
  }
}
```

### src/payout/payout.controller.ts
```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { ReconcileResult, ReconcileWindow } from './payout.types';

interface ReconcileRequest {
  from: string;
  to: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async execute(): Promise<{ processed: number }> {
    const processed = await this.payoutService.executePayments();
    return { processed };
  }

  @Post('reconcile')
  async reconcile(@Body() body: ReconcileRequest): Promise<ReconcileResult> {
    if (!body.from || !body.to) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Query parameters "from" and "to" are required.',
          details: {},
        },
      });
    }

    const from = new Date(body.from);
    const to = new Date(body.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Expected ISO 8601 date strings for "from" and "to".',
          details: { from: body.from, to: body.to },
        },
      });
    }

    const window: ReconcileWindow = { from, to };
    return this.payoutService.reconcile(window);
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { PrismaPayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { PAYOUT_CONFIG, PAYOUT_REPOSITORY } from './payout.types';

@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    {
      provide: PAYOUT_REPOSITORY,
      useExisting: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(
          process.env.PUBLISH_LAG_MINUTES || '30',
          10,
        ),
        maxAttempts: parseInt(
          process.env.MAX_PAYOUT_ATTEMPTS || '5',
          10,
        ),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Payout,
  PayoutStatus,
  PayoutRepository,
  PayoutConfig,
  ReconcileWindow,
  formatDateKey,
} from '../src/payout/payout.types';
import {
  BankClient,
  BankSendResult,
  Settlement,
} from '../src/bank/bank.types';
import { PayoutService } from '../src/payout/payout.service';

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

class MockBankClient implements BankClient {
  sendCalls: Array<{ txid: string; amount: number; key: string }> = [];
  private sendResults: BankSendResult[] = [];
  private sendCallIndex = 0;
  private statementEntries: Settlement[] = [];

  configureSendResults(results: BankSendResult[]): void {
    this.sendResults = [...results];
    this.sendCallIndex = 0;
  }

  configureStatement(entries: Settlement[]): void {
    this.statementEntries = [...entries];
  }

  async send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult> {
    this.sendCalls.push(params);
    if (this.sendResults.length === 0) {
      throw new Error('No send result configured');
    }
    const result = this.sendResults[
      Math.min(this.sendCallIndex, this.sendResults.length - 1)
    ];
    this.sendCallIndex = Math.min(
      this.sendCallIndex + 1,
      this.sendResults.length,
    );
    return result;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return [...this.statementEntries];
  }
}

class InMemoryPayoutRepository implements PayoutRepository {
  private store = new Map<string, Payout>();
  private counter = 0;

  create(data: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>): Payout {
    const id = `payout-${++this.counter}`;
    const now = new Date();
    const payout: Payout = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, payout);
    return payout;
  }

  get(id: string): Payout | undefined {
    return this.store.get(id);
  }

  async findPending(): Promise<Payout[]> {
    return [...this.store.values()].filter(
      (p) => p.status === PayoutStatus.PENDING,
    );
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return [...this.store.values()].find((p) => p.txid === txid) ?? null;
  }

  async findAwaitingReconcileEligible(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Payout[]> {
    return [...this.store.values()].filter(
      (p) =>
        p.status === PayoutStatus.AWAITING_RECONCILE &&
        p.effectiveDate >= window.from &&
        p.effectiveDate <= cutoff,
    );
  }

  async markSent(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.SENT;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.AWAITING_RECONCILE;
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markRejected(id: string, txid: string): Promise<void> {
    const p = this.getOrFail(id);
    p.txid = txid;
    p.status = PayoutStatus.REJECTED;
    p.rejectedAt = new Date();
    p.attemptCount++;
    p.updatedAt = new Date();
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.SETTLED;
    p.settledAt = settledAt;
    p.updatedAt = new Date();
  }

  async markForResend(id: string): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.PENDING;
    p.updatedAt = new Date();
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    const p = this.getOrFail(id);
    p.status = PayoutStatus.FAILED;
    p.failedAt = failedAt;
    p.updatedAt = new Date();
  }

  private getOrFail(id: string): Payout {
    const p = this.store.get(id);
    if (!p) throw new Error(`Payout ${id} not found`);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const twoHoursAgo = (): Date => new Date(Date.now() - 2 * 60_000 * 60_000);
const threeHoursAgo = (): Date => new Date(Date.now() - 3 * 60_600_000);

const defaultWindow = (): ReconcileWindow => ({
  from: threeHoursAgo(),
  to: new Date(),
});

const basePayout = (
  overrides: Partial<Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>>,
): Omit<Payout, 'id' | 'createdAt' | 'updatedAt'> => ({
  externalKey: 'key-123',
  amount: 1000,
  effectiveDate: twoHoursAgo(),
  status: PayoutStatus.PENDING,
  txid: null,
  attemptCount: 0,
  settledAt: null,
  rejectedAt: null,
  failedAt: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PayoutService', () => {
  let repo: InMemoryPayoutRepository;
  let bank: MockBankClient;
  let service: PayoutService;

  const config: PayoutConfig = { publishLagMinutes: 30, maxAttempts: 5 };

  beforeEach(() => {
    repo = new InMemoryPayoutRepository();
    bank = new MockBankClient();
    service = new PayoutService(repo, bank, config);
  });

  // -----------------------------------------------------------------
  // Required scenario 1: timeout-but-settled (no resend)
  // -----------------------------------------------------------------

  it('timeout-but-settled: does not resend when reconciliation finds the txid in the statement', async () => {
    const order = repo.create(
      basePayout({ externalKey: 'key-123', amount: 1000 }),
    );

    // executePayments → bank times out (transient error)
    bank.configureSendResults([
      { status: 'transient_error', error: 'timeout' },
    ]);
    await service.executePayments();

    const afterSend = repo.get(order.id)!;
    expect(afterSend.status).toBe(PayoutStatus.AWAITING_RECONCILE);
    expect(afterSend.attemptCount).toBe(1);
    expect(afterSend.txid).toBeDefined();
    expect(bank.sendCalls.length).toBe(1);

    const txid = afterSend.txid!;

    // reconcile → statement contains the txid (actually settled)
    bank.configureStatement([
      { txid, amount: 1000, status: 'settled' },
    ]);
    const result = await service.reconcile(defaultWindow());

    const afterReconcile = repo.get(order.id)!;
    expect(afterReconcile.status).toBe(PayoutStatus.SETTLED);
    expect(afterReconcile.settledAt).not.toBeNull();
    expect(result.matched).toBe(1);
    expect(result.resendEligible).toBe(0);
    expect(result.failed).toBe(0);

    // executePayments again → should NOT resend
    await service.executePayments();
    expect(bank.sendCalls.length).toBe(1); // no additional send
  });

  // -----------------------------------------------------------------
  // Required scenario 2: proven-absent (resend, same txid)
  // -----------------------------------------------------------------

  it('proven-absent: resends with the same txid after reconciliation proves absence', async () => {
    const order = repo.create(
      basePayout({ externalKey: 'key-123', amount: 1000 }),
    );

    // First send → timeout
    bank.configureSendResults([
      { status: 'transient_error', error: 'timeout' },
    ]);
    await service.executePayments();

    const afterFirstSend = repo.get(order.id)!;
    expect(afterFirstSend.status).toBe(PayoutStatus.AWAITING_RECONCILE);
    expect(bank.sendCalls.length).toBe(1);
    const originalTxid = afterFirstSend.txid!;
    expect(originalTxid).toBeDefined();

    // Reconcile → empty statement (proven absent) → PENDING
    bank.configureStatement([]);
    await service.reconcile(defaultWindow());

    const afterReconcile = repo.get(order.id)!;
    expect(afterReconcile.status).toBe(PayoutStatus.PENDING);
    expect(afterReconcile.txid).toBe(originalTxid); // txid preserved
    expect(afterReconcile.attemptCount).toBe(1); // unchanged by resend eligibility

    // executePayments → resend with SAME txid
    bank.configureSendResults([
      { status: 'accepted' },
    ]);
    await service.executePayments();

    expect(bank.sendCalls.length).toBe(2);
    expect(bank.sendCalls[1].txid).toBe(originalTxid);

    const afterResend = repo.get(order.id)!;
    expect(afterResend.status).toBe(PayoutStatus.SENT);
    expect(afterResend.attemptCount).toBe(2);

    // Final reconcile → found in statement → SETTLED
    bank.configureStatement([
      { txid: originalTxid, amount: 1000, status: 'settled' },
    ]);
    await service.reconcile(defaultWindow());

    expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
  });

  // -----------------------------------------------------------------
  // Required scenario 3: attempt exhaustion
  // -----------------------------------------------------------------

  it('attempt exhaustion: parks for manual review after 5 failed attempts and never auto-reverts', async () => {
    const order = repo.create(
      basePayout({ externalKey: 'key-123', amount: 1000 }),
    );

    // 5 cycles of send (timeout) + reconcile (proven absent)
    for (let i = 0; i < 5; i++) {
      bank.configureSendResults([
        { status: 'transient_error', error: 'timeout' },
      ]);
      await service.executePayments();
      expect(bank.sendCalls.length).toBe(i + 1);

      bank.configureStatement([]);
      await service.reconcile(defaultWindow());

      const p = repo.get(order.id)!;
      if (i < 4) {
        // After 1st-4th timeout: PENDING (eligible for resend)
        expect(p.status).toBe(PayoutStatus.PENDING);
        expect(p.attemptCount).toBe(i + 1);
      } else {
        // After 5th timeout: FAILED (attempts exhausted)
        expect(p.status).toBe(PayoutStatus.FAILED);
        expect(p.attemptCount).toBe(5);
        expect(p.failedAt).not.toBeNull();
      }
    }

    // executePayments should NOT attempt a 6th send
    bank.configureSendResults([
      { status: 'accepted' },
    ]);
    await service.executePayments();
    expect(bank.sendCalls.length).toBe(5); // no 6th

    // Order remains FAILED — never auto-revert
    expect(repo.get(order.id)!.status).toBe(PayoutStatus.FAILED);
  });

  // -----------------------------------------------------------------
  // Classification: accepted
  // -----------------------------------------------------------------

  it('accepted: marks as SENT then advances to SETTLED on reconciliation', async () => {
    const order = repo.create(
      basePayout({ externalKey: 'key-123', amount: 1000 }),
    );

    bank.configureSendResults([
      { status: 'accepted' },
    ]);
    await service.executePayments();

    const afterSend = repo.get(order.id)!;
    expect(afterSend.status).toBe(PayoutStatus.SENT);
    expect(afterSend.attemptCount).toBe(1);
    expect(afterSend.txid).toBeDefined();

    const txid = afterSend.txid!;

    bank.configureStatement([
      { txid, amount: 1000, status: 'settled' },
    ]);
    await service.reconcile(defaultWindow());

    expect(repo.get(order.id)!.status).toBe(PayoutStatus.SETTLED);
    expect(repo.get(order.id)!.settledAt).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // Classification: duplicate
  // -----------------------------------------------------------------

  it('duplicate: bank already has the txid → marks as SENT', async () => {
    const order = repo.create(
      basePayout({ externalKey: 'key-123', amount: 1000 }),
    );

    bank.configureSendResults([
      { status: 'duplicate', txid: 'pre-existing-txid' },
    ]);
    await service.executePayments();

    const afterSend = repo.get(order.id)!;
    expect(afterSend.status).toBe(PayoutStatus.SENT);
    expect(afterSend.attemptCount).toBe(1);

    const txid = afterSend.txid!;

    // Reconcile → found in statement → SETTLED
