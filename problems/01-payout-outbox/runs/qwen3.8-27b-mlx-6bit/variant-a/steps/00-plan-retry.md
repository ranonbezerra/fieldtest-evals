# plan-retry

## reasoning

```
The user wants me to write a PLAN.md for the crypto payout service (variant A). I need to follow the exact six-section format, be terse, and ensure every symbol is resolvable. Let me think through the design carefully before writing.

Key decisions to make:
1. Schema: accounts, payouts, ledger_entries, outbox_messages tables
2. Idempotency: unique constraint on idempotency_key in payouts table
3. Concurrency: row-level locking (SELECT ... FOR UPDATE) on account balance check
4. Ledger: double-entry — debit from "payout_hold" and credit to "settled" or similar
5. Outbox: message table with status (pending, processing, done, failed), worker polls
6. Retry: bounded retries on outbox message; if exhausted, mark payout as "needs-review"
7. State machine: created → processing → sent → completed | failed | needs-review

Let me think about the ledger more carefully. The requirement says "The account's settled balance changes only when the provider confirms the transfer." So:
- On creation: reserve funds (decrease available, increase held)
- On confirmation: release from held, decrease settled (or net effect is settled decreases)

Actually let me think about this differently. Double-entry ledger:
- Account has a "settled" balance
- On payout creation: move from settled to "pending_payout" (hold)
- On payout success: the pending_payout is spent (removed from account entirely)
- On payout failure: move back from pending_payout to settled

The ledger entries would be:
- On creation: debit account.settled, credit account.pending_payout (or a "payout_hold" liability)
- On completion: debit account.pending_payout, credit external (the payout left the system)
- On failure/reversal: debit account.pending_payout... wait, credit back to settled

Let me simplify. The ledger tracks the account balance. I'll use:
- `ledger_entries` table with: id, account_id, type (debit/credit), amount, reference_type, reference_id, created_at

Actually for a double-entry system, each transaction has two entries. But since we're tracking one account's balance, I can simplify to:
- Each ledger entry has: account_id, direction (in/out), amount, payout_id, created_at
- The "settled balance" = sum of all ledger entries for the account where they haven't been offset

Hmm, let me think more carefully. The requirement says "double-entry-style ledger" and "The account's settled balance changes only when the provider confirms the transfer."

So the flow is:
1. Payout created → funds are reserved (held). Account's "available for new payouts" decreases, but "settled balance" hasn't changed yet.
2. Provider confirms → settled balance decreases (money actually left).
3. Provider fails permanently → funds released back, available increases again.

For double-entry:
- Entry 1 (on creation): Debit: Payout Hold / Credit: Account Available
- Entry 2 (on completion): Debit: External Payout / Credit: Payout Hold
- Entry 2' (on failure): Debit: Account Available / Credit: Payout Hold

So the "Account Available" is what we check for sufficiency. The "settled balance" (actual money in the account) = initial deposit - all completed payouts. The "available" = settled - held_for_pending_payouts.

Actually, I think the simplest interpretation that satisfies "double-entry-style" is:
- We have a `ledger_entries` table
- Each payout creation creates a "hold" entry (reduces available)
- Each payout completion creates a "settlement" entry (reduces the actual balance)
- The balance is derived from ledger entries

Let me define it as:
- `ledger_entries`: id, account_id, amount (positive bigint), entry_type (enum: HOLD, SETTLE, RELEASE), payout_id, created_at
- Available balance = initial_deposit - SUM(HOLD amounts for non-released payouts) ... no this gets complex.

Simpler approach that's still "double-entry-style":
- `ledger_entries`: id, account_id, amount (bigint, can be negative), reason (enum), payout_id, created_at
- Balance = SUM(amount) for all entries

On creation: entry with amount = -payout_amount, reason = PAYOUT_HOLD
On completion: no additional entry needed if we treat the hold as the final deduction. But that means balance changes on creation, contradicting "settled balance changes only when provider confirms."

OK let me re-read: "The account's settled balance changes only when the provider confirms the transfer."

So I need TWO concepts:
- Available balance (can be used for new payouts) = settled_balance - held_amount
- Settled balance (actual confirmed funds) changes only on confirmation

So:
- On creation: held_amount increases by payout_amount. Available decreases. Settled unchanged.
- On confirmation: settled_balance decreases by payout_amount, held_amount decreases by payout_amount. Available unchanged (it already went down on creation).
- On failure: held_amount decreases by payout_amount. Available increases back. Settled unchanged.

For the ledger (double-entry):
- On creation: Debit `payout_holds` by X, Credit `account_settled` by X... no that changes settled.

I think the cleanest model is:
- `accounts` table has: id, settled_balance (bigint), held_amount (bigint)
- Available = settled_balance - held_amount
- `ledger_entries` for audit: id, account_id, amount, entry_type (HOLD, SETTLE, RELEASE), payout_id, created_at
- On creation: atomically check settled_balance - held_amount >= amount, then increment held_amount. Write ledger entry HOLD.
- On confirmation: decrement settled_balance AND decrement held_amount. Write ledger entry SETTLE.
- On failure: decrement held_amount. Write ledger entry RELEASE.

This is "double-entry-style" in that every change to one field has a corresponding ledger entry, and the ledger is reconcilable.

Now for concurrency: I'll use `SELECT ... FOR UPDATE` on the account row when checking/holding funds. In Prisma, this means a raw query or using `$queryRaw` in the repository. Actually, I can use Prisma's `interactiveTransactions` or just do a raw query for the lock.

Wait, the convention says "repository is the only layer that touches the database" and "zero raw SQL, zero Prisma client calls" in service. So the repository can use `$queryRaw` for the SELECT FOR UPDATE, or I can use Prisma's `$transaction` with a specific isolation level.

Actually in Prisma, I can use `$transaction` with an interactive transaction and do `SELECT ... FOR UPDATE` via `$queryRaw`. Or I can use Prisma's `findUnique` with `select` and then update, but that doesn't give me a row lock.

Best approach: In the repository, use `prisma.$transaction(async (tx) => { const account = await tx.$queryRaw(...FOR UPDATE...); ... })` or use the Prisma interactive transaction.

Actually, a cleaner Prisma approach: use `prisma.$transaction` (interactive) and within it do the read-check-write. The default isolation level in PostgreSQL is READ COMMITTED, which with SELECT FOR UPDATE gives us the serialization we need.

Let me plan the files:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout-worker.service.ts
test/payout.spec.ts
DESIGN.md
```

Wait, the convention says `src/<feature>/<feature>.module.ts` etc. So:
```
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
```

For the worker, I'll make it a separate service in the same module: `src/payout/payout-worker.service.ts`

For the provider SDK, I'll define an interface `TransferProvider` that the worker uses. This is a dependency that can be mocked in tests.

Now let me think about the outbox message table:
- id, payout_id, status (pending, processing, done, failed), attempts, max_attempts, last_error, created_at, updated_at

The worker:
1. Polls for messages with status = 'pending' (or 'processing' that timed out)
2. For each, sets status to 'processing', calls provider.transfer
3. On success: marks message done, updates payout to completed, settles ledger
4. On transient failure: increments attempts, if attempts < max, sets back to pending with delay; else marks failed, updates payout to needs-review
5. On definitive failure (e.g., invalid address): marks message failed immediately, updates payout to failed

Actually, for the "at-least-once" delivery: the worker picks up pending messages. If it crashes mid-processing, the message is still in a state that allows re-pickup. I'll use:
- status = 'pending' → worker claims it by setting to 'processing' (with a timestamp)
- If a message is in 'processing' for longer than a timeout, it can be reclaimed (set back to 'pending')
- On successful processing: status → 'done'
- On failure with retries left: status → 'pending', attempts incremented
- On failure without retries left: status → 'failed'

The worker sets payout state:
- When it first picks up a pending message: payout → 'processing'
- On provider success: payout → 'completed'
- On provider definitive failure: payout → 'failed'
- On retry exhaustion: payout → 'needs-review'

Now for idempotency:
- `payouts` table has a unique constraint on `idempotency_key`
- On POST /payouts: try to insert. If unique violation, return the existing payout (200 with existing data).

For the concurrent creation test:
- Two requests with different idempotency keys for the same account, where only enough funds exist for one
- One should succeed, one should fail with insufficient_funds

Let me now think about the state machine:
```
created → processing → completed
                  → failed
                  → needs-review
```

Transitions:
- created → processing: when worker picks up the message
- processing → completed: provider confirms transfer
- processing → failed: provider definitively rejects (e.g., bad address)
- processing → needs-review: retries exhausted without definitive outcome

Now let me write the plan. I need to be terse and complete.

For the Prisma schema:
- Account: id, name (or just id), settledBalance (bigint), heldAmount (bigint)
- Payout: id, accountId, amount (bigint), destinationAddress, idempotencyKey (unique), status (enum), txHash (optional), createdAt, updatedAt
- LedgerEntry: id, accountId, amount (bigint), entryType (enum: HOLD, SETTLE, RELEASE), payoutId, createdAt
- OutboxMessage: id, payoutId (unique reference), status (enum: pending, processing, done, failed), attempts (int), maxAttempts (int), lastError (string optional), processingStartedAt (datetime optional), createdAt, updatedAt

Wait, I should also think about what "provider.transfer" returns and throws. The statement says it may throw, time out, or succeed slowly. I'll define the provider interface:

```typescript
interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

It throws on failure. The worker distinguishes transient vs definitive based on the error type or a convention (e.g., errors with a `code` property).

Actually, let me keep it simpler. The provider throws an error. The worker treats ALL errors as transient (retryable) up to the max attempts, then marks needs-review. This is the "safe" choice — if we can't determine the outcome, we don't assume failure (which would release funds that might have been sent) and we don't assume success (which would mark completed without confirmation). We flag for human review.

This satisfies requirement 6: "if you exhaust retries without a definitive outcome, do something safe and explain why."

Now let me structure the plan sections.

For section 3 (types and signatures), I need to be thorough. Let me list:
- Enums: PayoutStatus, LedgerEntryType, MessageStatus
- Interfaces: TransferProvider, CreatePayoutInput, PayoutDto
- Classes (NestJS): PayoutController, PayoutService, PayoutRepository, PayoutWorkerService
- Methods on each class

For the repository, I need methods that the service calls:
- `createPayoutWithHold(input): Promise<Payout>` — does the atomic check-and-hold
- `findPayoutByIdempotencyKey(key): Promise<Payout | null>`
- `findPayoutById(id): Promise<Payout | null>`
- `updatePayoutStatus(id, status, txHash?): Promise<void>`
- `settleLedger(payoutId): Promise<void>` — decrements settled and held
- `releaseHold(payoutId): Promise<void>` — decrements held only
- `claimPendingMessages(limit): Promise<OutboxMessage[]>` — atomically claims messages
- `markMessageDone(id): Promise<void>`
- `markMessageFailed(id, error): Promise<void>`
- `requeueMessage(id): Promise<void>`

Actually, let me think about transaction boundaries more carefully:

1. POST /payouts creation:
   - Transaction: SELECT account FOR UPDATE, check available >= amount, increment held, insert payout (with idempotency key), insert ledger entry HOLD, insert outbox message
   - If unique violation on idempotency_key: rollback, return existing payout

2. Worker processing a message:
   - No transaction needed for the provider call (it's external)
   - On success: Transaction: update payout to completed, settle ledger (decrement settled + held), mark message done
   - On failure (retries left): update message attempts, set back to pending
   - On failure (exhausted): Transaction: update payout to needs-review, mark message failed

3. Worker claiming messages:
   - Transaction or atomic update: UPDATE outbox_messages SET status='processing', processingStartedAt=now() WHERE status='pending' AND id IN (...) — but this has a race. Better: UPDATE ... SET status='processing' WHERE id = ? AND status = 'pending' and check affected rows.

Actually for the claim, I'll do:
```sql
UPDATE outbox_messages SET status = 'processing', processing_started_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *
```
If 0 rows returned, someone else claimed it. This is safe under READ COMMITTED.

Let me also think about the stale processing timeout. If a worker crashes while processing, the message stays in 'processing' forever. Solution: when polling, also pick up messages in 'processing' where `processing_started_at < NOW() - interval '30 seconds'`. These are stale and get reclaimed.

Now let me write the actual PLAN.md. I'll be terse.

One more thing: the manifest needs to list files I'll write. Let me list them:
- prisma/schema.prisma
- prisma/migrations/... (I'll just say the migration directory)
- src/main.ts
- src/app.module.ts
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/payout/payout-worker.service.ts
- test/payout.spec.ts
- DESIGN.md

For the manifest, I need to be precise about reads. Let me think:
- prisma/schema.prisma | reads: - | (defines the data model)
- src/main.ts | reads: src/app.module.ts | entry point
- src/app.module.ts | reads: src/payout/payout.module.ts | root module
- src/payout/payout.module.ts | reads: (controller, service, worker, repository) | wires the feature
- src/payout/payout.controller.ts | reads: src/payout/payout.service.ts | HTTP layer
- src/payout/payout.service.ts | reads: src/payout/payout.repository.ts | business logic
- src/payout/payout.repository.ts | reads: prisma/schema.prisma | data access
- src/payout/payout-worker.service.ts | reads: src/payout/payout.repository.ts, src/payout/payout.service.ts (or maybe just repository) | async processing
- test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout-worker.service.ts | tests
- DESIGN.md | reads: - | design notes

Wait, the convention says "A file may name under `reads:` only files listed above it." So I need to order them so dependencies come first. Let me reorder:

1. prisma/schema.prisma (no reads)
2. src/payout/payout.repository.ts (reads schema)
3. src/payout/payout.service.ts (reads repository)
4. src/payout/payout-worker.service.ts (reads repository, service)
5. src/payout/payout.controller.ts (reads service)
6. src/payout/payout.module.ts (reads controller, service, worker, repository)
7. src/app.module.ts (reads payout module)
8. src/main.ts (reads app module)
9. test/payout.spec.ts (reads service, worker, repository)
10. DESIGN.md (no reads)

Hmm but the worker might not need the service. Let me think... The worker calls the provider, then updates state via repository. It might not need the service at all. Let me keep it decoupled: worker uses repository directly for state updates and calls the provider directly.

Actually, to keep the layering clean: controller → service → repository, and worker → repository (worker is not called by a controller, it's a standalone processor). The worker also calls the provider.

Let me reconsider: does the worker need the service? The service holds business logic. The state transitions (payout status changes, ledger entries) are business logic. So maybe the worker should call service methods for those transitions. But that creates a circular dependency if the service also knows about the worker... no it doesn't, the service doesn't know about the worker.

I'll have the worker call repository methods directly for the state transitions since they're simple atomic updates. The complex logic (checking balance, creating payout) is in the service (called by controller). The worker's logic is: claim message → call provider → update state based on result. That's thin enough to be in the worker.

Actually, re-reading the conventions: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database."

So the worker (which is a service) should call the repository. That's fine.

Let me finalize and write it out. I'll be concise.
```

## reply

## 1. Assumptions

| Open question | Choice | Why |
|---|---|---|
| How to distinguish transient vs. definitive provider errors | Treat **all** thrown errors as transient; only retry-exhaustion triggers `needs_review` | Safest: never assume a transfer failed when we cannot confirm; a human inspects before releasing or confirming |
| Stale-processing timeout for crashed workers | 30 seconds | Long enough for a slow provider call, short enough to recover quickly |
| Provider interface location | Defined in `payout.service.ts` as an exported interface, injected via DI token | Keeps it alongside the logic that uses it; no separate file needed |
| Idempotent duplicate response status | `200 OK` with the existing payout body | Client sees success; no distinction from first-creation needed by spec |
| `maxAttempts` default | 3 | Bounded, small enough to fail fast in tests |
| Worker polling interval | 5 seconds (configurable via env `WORKER_POLL_MS`) | Reasonable for an eval; low overhead |
| Account seeding for tests | Insert directly via Prisma in test setup | No API needed to create accounts in this task |

## 2. Data model

All monetary columns are `BIGINT` (minor units). All timestamps are `TIMESTAMPTZ`.

**accounts** (`@@map("accounts")`)

| Column | Type | Notes |
|---|---|---|
| id | `UUID` PK | |
| settled_balance | `BIGINT` (default 0) | Confirmed funds that have not yet been paid out |
| held_amount | `BIGINT` (default 0) | Funds reserved for in-flight payouts |

Available = `settled_balance − held_amount`.

**payouts** (`@@map("payouts")`)

| Column | Type | Notes |
|---|---|---|
| id | `UUID` PK | |
| account_id | `UUID` FK → accounts.id | |
| amount | `BIGINT` | |
| destination_address | `TEXT` | |
| idempotency_key | `TEXT` **UNIQUE** | |
| status | `PAYOUT_STATUS` (see §3) | default `created` |
| tx_hash | `TEXT?` | Set when provider confirms |
| created_at | `TIMESTAMPTZ` default now() | |
| updated_at | `TIMESTAMPTZ` default now() | |

**ledger_entries** (`@@map("ledger_entries")`)

| Column | Type | Notes |
|---|---|---|
| id | `UUID` PK | |
| account_id | `UUID` FK → accounts.id | |
| payout_id | `UUID` FK → payouts.id | |
| amount | `BIGINT` | Always positive; direction implied by entry_type |
| entry_type | `LEDGER_ENTRY_TYPE` | `HOLD`, `SETTLE`, `RELEASE` |
| created_at | `TIMESTAMPTZ` default now() | |

Invariants: for any account, `held_amount = SUM(ledger_entries.amount WHERE entry_type = HOLD) − SUM(WHERE entry_type = SETTLE) − SUM(WHERE entry_type = RELEASE)`.

**outbox_messages** (`@@map("outbox_messages")`)

| Column | Type | Notes |
|---|---|---|
| id | `UUID` PK | |
| payout_id | `UUID` FK → payouts.id **UNIQUE** | One message per payout |
| status | `MESSAGE_STATUS` | default `pending` |
| attempts | `INT` default 0 | |
| max_attempts | `INT` default 3 | |
| last_error | `TEXT?` | |
| processing_started_at | `TIMESTAMPTZ?` | Set when claimed, cleared on release |
| created_at | `TIMESTAMPTZ` default now() | |
| updated_at | `TIMESTAMPTZ` default now() | |

## 3. Types and signatures

### Enums (Prisma)

```
PAYOUT_STATUS: created | processing | completed | failed | needs_review
LEDGER_ENTRY_TYPE: HOLD | SETTLE | RELEASE
MESSAGE_STATUS: pending | processing | done | failed
```

### Exported interfaces

```typescript
// In payout.service.ts
interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}

interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

interface PayoutResponse {
  id: string;
  accountId: string;
  amount: string;         // minor units as string for JSON
  destinationAddress: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
}
```

### Error thrown by service

```typescript
class InsufficientFundsError extends Error {
  code = "insufficient_funds";
}
```

Raised when `settled_balance − held_amount < amount` at creation time.

### PayoutRepository (class, `@Injectable()`)

```typescript
createPayoutWithHold(input: CreatePayoutInput): Promise<PayoutResponse>
findPayoutByIdempotencyKey(key: string): Promise<PayoutResponse | null>
findPayoutById(id: string): Promise<PayoutResponse | null>
updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<void>
settleLedger(payoutId: string, accountId: string, amount: bigint): Promise<void>
releaseHold(payoutId: string, accountId: string, amount: bigint): Promise<void>
claimMessage(messageId: string): Promise<boolean>
claimStaleMessages(timeoutMs: number, limit: number): Promise<OutboxMessageRow[]>
nextPendingMessage(limit: number): Promise<OutboxMessageRow[]>
incrementAttempts(messageId: string): Promise<void>
markMessageDone(messageId: string): Promise<void>
markMessageFailed(messageId: string, error: string): Promise<void>
```

`OutboxMessageRow` is the Prisma model shape for `outbox_messages`.

### PayoutService (class, `@Injectable()`)

```typescript
createPayout(input: CreatePayoutInput): Promise<PayoutResponse>
```

Orchestration: calls `findPayoutByIdempotencyKey` first (fast path for duplicates); on miss, calls `createPayoutWithHold`; on unique-constraint violation from the repository, re-fetches and returns the existing payout.

### PayoutWorkerService (class, `@Injectable()`)

```typescript
constructor(provider: TransferProvider, repo: PayoutRepository)
processMessages(): Promise<void>
```

`processMessages` is the idempotent work unit called by a `setInterval` loop started in `onModuleInit`.

### PayoutController (class, `@Controller("payouts")`)

```typescript
@Post()
create(@Body() body: CreatePayoutInput): Promise<PayoutResponse>
```

Validates presence of all four fields; delegates to `PayoutService.createPayout`. Returns `400` on missing fields, `422` on `InsufficientFundsError`.

### Ordering rules

- `updatePayoutStatus(→ processing)` must occur **before** calling `provider.transfer`.
- `settleLedger` and `updatePayoutStatus(→ completed)` must occur in the same DB transaction.
- `releaseHold` and `updatePayoutStatus(→ needs_review)` must occur in the same DB transaction.
- `claimMessage` / `claimStaleMessages` must use a conditional update (`WHERE status = 'pending'`) so two workers cannot claim the same message.

## 4. Control flow

### Payout creation (POST /payouts)

1. Validate input shape. Return 400 on failure.
2. Check idempotency: `findPayoutByIdempotencyKey`. If found, return 200 with existing payout.
3. Open a DB transaction:
   a. `SELECT * FROM accounts WHERE id = ? FOR UPDATE`
   b. If `settled_balance − held_amount < amount`, abort → raise `InsufficientFundsError`.
   c. `UPDATE accounts SET held_amount = held_amount + ? WHERE id = ?`
   d. `INSERT INTO payouts (…, status='created')`
   e. `INSERT INTO ledger_entries (entry_type='HOLD', …)`
   f. `INSERT INTO outbox_messages (status='pending')`
4. Commit. Return 201 with the new payout.
5. If step 3d raises a unique violation on `idempotency_key` (race with another identical request), roll back and re-fetch the existing payout. Return 200.

**Must not be in this transaction:** any provider call, any network I/O.

### Worker: processMessages()

1. Fetch candidate messages:
   a. `nextPendingMessage(10)` → all rows with `status = 'pending'`.
   b. `claimStaleMessages(30000, 10)` → rows with `status = 'processing'` AND `processing_started_at < NOW() − 30s`.
2. For each candidate, atomically claim:
   - `claimMessage(id)`: `UPDATE … SET status='processing', processing_started_at=NOW() WHERE id=? AND status IN ('pending','processing') RETURNING …`. If 0 rows, skip (another worker got it).
3. Set payout status to `processing` (if not already).
4. Call `provider.transfer(destinationAddress, amount)`.
5. On **success**: in one transaction → `settleLedger`, `updatePayoutStatus(→ completed, txHash)`, `markMessageDone`.
6. On **error**:
   - If `attempts < maxAttempts`: increment attempts, set status back to `pending`, clear `processing_started_at`. Store last error.
   - If `attempts >= maxAttempts`: in one transaction → `releaseHold`, `updatePayoutStatus(→ needs_review)`, `markMessageFailed`.

**Must not be inside a DB transaction:** the `provider.transfer` call (it may hang for seconds).

### State machine

```
created ──► processing ──► completed
                    ├──► failed          (reserved for definitive rejection; not used in current provider contract)
                    └──► needs_review    (retries exhausted, outcome unknown)
```

`needs_review` is terminal from the worker's perspective; a human or future admin endpoint resolves it.

## 5. Tests

| Test | Proves |
|---|---|
| Two concurrent `createPayout` calls for the same account where only enough funds exist for one | Exactly one succeeds; the other receives `InsufficientFundsError` (422) |
| Two `createPayout` calls with the same `idempotencyKey` | Second returns 200 with the same payout id; `held_amount` increased only once |
| Worker processes a message whose provider succeeds | Payout status → `completed`; ledger has SETTLE entry; `settled_balance` and `held_amount` both decremented; message → `done` |
| Worker processes a message whose provider throws on every attempt (attempts = maxAttempts) | Payout status → `needs_review`; ledger has RELEASE entry; `held_amount` decremented, `settled_balance` unchanged; message → `failed` |
| Worker sees the same message twice (simulated by calling `processMessages` with a message already in `done`) | No double-settlement: ledger entry count unchanged, balance unchanged |
| Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts = 3) | Payout → `completed`; message → `done`; attempts recorded as 3 |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema for accounts, payouts, ledger_entries, outbox_messages
src/payout/payout.repository.ts | reads: prisma/schema.prisma | All Prisma/SQL access for the payout feature
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts | Business logic: createPayout orchestration, idempotency, error mapping
src/payout/payout-worker.service.ts | reads: src/payout/payout.repository.ts | Polling worker: claim, provider call, state transitions
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts | HTTP layer: validation, status codes
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout-worker.service.ts, src/payout/payout.repository.ts | NestJS wiring: providers, exports, controller declaration
src/app.module.ts | reads: src/payout/payout.module.ts | Root module importing PayoutModule
src/main.ts | reads: src/app.module.ts | Bootstrap entry point
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout-worker.service.ts, src/payout/payout.repository.ts | All behavioural tests from §5
DESIGN.md | reads: - | 10–20 line explanation of funds-safety approach
-->
