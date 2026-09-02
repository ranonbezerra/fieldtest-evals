# 00-plan@medium

## reasoning

```
Let me plan this payout service carefully. I need to write a PLAN.md with exactly 6 sections.

Let me think through the design:

**1. Assumptions:**
- Polling interval: 5 seconds (reasonable default, configurable via env)
- Max retries: 3 (bounded, safe)
- On retry exhaustion: mark payout as `needs-review` and don't release funds (safe = don't lose money, human intervenes)
- Available funds = settled balance - reserved amount (tracked in ledger)
- Idempotency: unique index on `idempotencyKey`
- Concurrency safety: use `SELECT ... FOR UPDATE` (row-level lock) on the account row within a transaction
- Ledger: double-entry, each payout creates debit from "account" to "pending_payouts", then on completion credit "pending_payouts" and debit "external"
- Worker: single instance assumption (no distributed locking needed, but `processMessages` should be idempotent)
- Amount type: integer (minor units, e.g. cents)
- File naming per conventions

**2. Data model:**
- `accounts` table: id, balance (settled), reserved, created_at
- `payouts` table: id, account_id, amount, destination_address, idempotency_key (unique), status, tx_hash, created_at, updated_at
- `messages` table: id, payout_id, status (pending/processing/done), attempts, last_attempt_at, created_at
- `ledger_entries` table: id, account_id, payout_id (nullable), type (debit/credit), amount, reference_type (payout_reservation/payout_completion/payout_reversal), created_at

Wait, let me reconsider the ledger. Double-entry means every transaction has a debit and credit side. But since we're tracking one account's balance, let me simplify:

Actually the requirement says "double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."

So:
- On payout creation: reserve funds (settled balance decreases, reserved increases) — but this is NOT a settled balance change in the double-entry sense
- On payout completion: reserved decreases, external payment confirmed

Let me think about this differently. The ledger tracks all movements:
- Entry types: `RESERVED` (funds set aside), `RELEASED` (funds returned on failure), `COMPLETED` (funds permanently sent out)
- The account's available = balance - reserved

Actually let me keep it simpler:
- `accounts`: `settled_balance` (int), `reserved` (int)
- `ledger_entries`: records every change with a reason

For double-entry style:
- When creating payout: debit from account (settled_balance -= amount, reserved += amount)
- When completing: credit to external (reserved -= amount, settled_balance stays)
- When failing/reversing: credit back to account (reserved -= amount, settled_balance += amount)

The ledger_entries table records each of these with:
- id, account_id, payout_id, entry_type (RESERVE / RELEASE / SETTLE), amount, created_at

**3. Types and signatures:**

Let me think about the Prisma models and the TS types.

Prisma schema:
- Account: id (String/UUID), settledBalance (BigInt or Int - use Int for minor units, but could overflow... let's use BigInt to be safe), reserved (BigInt), createdAt
- Payout: id, accountId, amount (BigInt), destinationAddress, idempotencyKey (@unique), status (enum), txHash (String?), createdAt, updatedAt
- Message: id, payoutId (@unique), status (enum: PENDING/PROCESSING/DONE), attempts (Int), lastAttemptAt, createdAt
- LedgerEntry: id, accountId, payoutId (nullable), entryType (enum), amount (BigInt), createdAt

Wait, the convention says "Do not use floating point for money." BigInt is the Prisma type for arbitrary precision integers. That's correct.

Actually, for Prisma with PostgreSQL, `BigInt` maps to `bigint`. That's fine for minor units.

Let me now think about the service interface:
- `createPayout(input: CreatePayoutInput): Promise<PayoutResponse>`
- `processMessages(): Promise<void>`

Errors:
- `insufficient_funds` - account balance < amount
- `invalid_request` - bad input
- `internal_error` - unexpected

**4. Control flow:**

POST /payouts:
1. Validate input
2. BEGIN TRANSACTION
   a. SELECT account FOR UPDATE (row lock)
   b. Check idempotencyKey - if payout exists, return it (no new reservation)
   c. Check settled_balance >= amount (or available = settled - reserved >= amount? Actually if we decrement settled and increment reserved, then available = settled_balance. Let me reconsider.)

Hmm, let me think about the balance model more carefully.

Option A: `settled_balance` is the total, `reserved` is a subset.
- Available = settled_balance - reserved
- On create: settled_balance stays, reserved += amount
- On complete: settled_balance -= amount, reserved -= amount
- On fail: reserved -= amount

Option B: `settled_balance` decreases immediately on reservation.
- On create: settled_balance -= amount, reserved += amount
- On complete: reserved -= amount (settled already reduced)
- On fail: settled_balance += amount, reserved -= amount

Option B is simpler for the "sufficient funds" check: just check settled_balance >= 0 after subtraction... no wait, that's not right either.

Let me go with Option A:
- `settled_balance`: total funds the account has (decreases only on confirmed payout)
- `reserved`: amount set aside for in-flight payouts
- Available = settled_balance - reserved
- Check: available >= amount before reserving
- On create: reserved += amount
- On complete: settled_balance -= amount, reserved -= amount
- On fail/reverse: reserved -= amount

This means "The account's settled balance changes only when the provider confirms the transfer" is satisfied.

For concurrent safety: within a transaction, we SELECT ... FOR UPDATE on the account row. This serializes access.

Worker (processMessages):
1. SELECT messages WHERE status = 'PENDING' LIMIT N FOR UPDATE SKIP LOCKED
2. For each message:
   a. Mark as PROCESSING
   b. Call provider.transfer({to, amount})
   c. On success: mark payout completed, update ledger (settled_balance -= amount, reserved -= amount), mark message DONE
   d. On failure: attempts += 1; if attempts >= MAX, mark payout needs-review, mark message DONE; else mark message PENDING (retry)
3. COMMIT per message or batch? Each message in its own transaction for isolation.

Actually, let me reconsider. The requirement says "Delivery is at-least-once: your worker may see the same message more than once." So the worker must be idempotent. If a message is already DONE, skip it. If the payout is already completed, skip.

**5. Tests:**
- Concurrent creation: two requests with different idempotency keys race against one account with limited balance. Only one succeeds (or both succeed if enough funds, but never overdraw).
- Duplicate idempotency key: same key sent twice, second returns the original payout without reserving again.
- Duplicate message delivery: processMessages called twice, same message, payout only completed once.
- Retry exhaustion: provider always fails, after MAX_RETRIES the payout is marked needs-review, funds remain reserved (not released back).

Wait, on retry exhaustion the requirement says "do something safe and explain why." Marking as needs-review and keeping funds reserved is safe because:
- We don't know if the transfer went through (timeout)
- Releasing funds would mean we might have sent money AND released the balance = double spend
- A human can verify and either confirm or cancel

**6. Manifest:**

Files:
- prisma/schema.prisma
- prisma/migrations/... (auto-generated, but I'll note it)
- src/main.ts
- src/app.module.ts
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/payout/worker.service.ts (or payout-worker.service.ts)
- test/payout.spec.ts

Wait, the convention says `src/<feature>/<feature>.module.ts`, `src/<feature>/<feature>.controller.ts`, `src/<feature>/<feature>.service.ts`, `src/<feature>/<feature>.repository.ts`.

For the worker, I'll make it part of the service or a separate file. Let me make it `payout.worker.ts` in the payout folder. Actually the convention doesn't have a worker pattern. I'll put `processMessages` in the service and have a separate lightweight `payout.worker.ts` that just calls it on an interval.

Actually, let me re-read: "NestJS module: controller, service, worker". So the worker is a deliverable. I'll make it `src/payout/payout-worker.ts`.

For the provider, I need a `TransferProvider` interface that's injected. In production it wraps the blockchain SDK, in tests it's a mock.

Let me also think about `src/config.ts` or just reading env vars directly in the module. The convention says "Configuration comes from environment variables only." I'll use `@nestjs/config` or just `process.env`. Let me keep it simple: read from process.env in the worker for the poll interval, and max retries as a constant in the service.

Actually, I'll define constants at the top of the service file and read poll interval from env in the worker.

Let me finalize the plan now and write it concisely.

For the Prisma schema, I need:
- Account model
- Payout model  
- Message (outbox) model
- LedgerEntry model

Enums:
- PayoutStatus: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW
- MessageStatus: PENDING, PROCESSING, DONE
- LedgerEntryType: RESERVE, RELEASE, SETTLE

Wait, the requirement says "created → processing → sent → completed / failed / needs-review". Let me use:
- CREATED → PROCESSING → SENT → COMPLETED
- Or PROCESSING → FAILED
- Or PROCESSING → NEEDS_REVIEW

"SENT" means the provider confirmed a tx hash. "COMPLETED" means... actually in this context SENT and COMPLETED might be the same. Let me simplify:
- CREATED (payout record exists, funds reserved)
- PROCESSING (worker picked up the message)
- SENT (provider returned tx hash)
- COMPLETED (we've recorded the settlement in the ledger) — actually this is immediate after SENT
- FAILED (retries exhausted, definitive failure from provider)
- NEEDS_REVIEW (retries exhausted, no definitive outcome — timeout/ambiguous)

Hmm, the requirement says "sent → completed / failed / needs-review". So SENT is an intermediate state where we have a tx hash but haven't fully processed. Let me keep all of them.

Actually for the outbox pattern, let me think about when we transition:
- POST creates payout (CREATED) + message (PENDING) in one transaction
- Worker picks message, marks PROCESSING, payout → PROCESSING
- Provider call:
  - Success (tx hash): payout → SENT, then immediately → COMPLETED (update ledger), message → DONE
  - Transient failure: message stays PENDING (or goes back to PENDING), attempts++
  - Exhaustion with ambiguous: payout → NEEDS_REVIEW, message → DONE
  - Exhaustion with definitive failure (e.g. provider says "invalid address"): payout → FAILED, message → DONE, release funds

Wait, the requirement says "Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe." So:
- Definitive failure (provider returns an error saying "no"): FAILED + release funds
- Ambiguous (timeout, network error after retries): NEEDS_REVIEW + keep funds reserved

For simplicity in the plan, I'll say: any error from provider.transfer is treated as transient/retryable. On exhaustion → NEEDS_REVIEW. This is the safest default. If we want to distinguish, the provider would need a richer error type, but the spec just says "may throw."

Let me now write the plan. I need to be concise given the output limit.
```

## reply

## 1. Assumptions

- Poll interval: 5 s, read from `PAYOUT_POLL_MS` env var (default 5000). Reasonable for a test/dev service.
- Max retries: 3 (constant in the worker). Bounded, keeps latency low.
- On retry exhaustion: mark payout `NEEDS_REVIEW`, keep funds reserved. Reason: we cannot know whether the transfer landed; releasing would risk double-spend, so a human verifies.
- Available balance = `settled_balance − reserved`. Settlement (decrement of `settled_balance`) happens only on confirmed transfer.
- Concurrency guard: `SELECT … FOR UPDATE` on the account row inside the creation transaction serialises racing writes.
- Single worker instance. `processMessages` is idempotent: it skips messages whose payout is already past `PROCESSING`.
- Provider interface injected via DI; tests supply a mock. No real SDK dependency in this repo.
- Amounts are `BigInt` (Prisma `BigInt` → Postgres `bigint`). No floating point.
- `src/payout/` is the feature folder. Worker lives at `src/payout/payout-worker.ts`.
- Idempotency key is a client-supplied UUID string; unique index enforces it.

## 2. Data model

### Account
| column | type | notes |
|---|---|---|
| id | `String` (uuid pk) | |
| settled_balance | `BigInt` | default 0 |
| reserved | `BigInt` | default 0 |
| created_at | `DateTime` | auto |

### Payout
| column | type | notes |
|---|---|---|
| id | `String` (uuid pk) | |
| account_id | `String` (fk → Account.id) | indexed |
| amount | `BigInt` | minor units |
| destination_address | `String` | |
| idempotency_key | `String` | unique index |
| status | `PayoutStatus` | enum, see below |
| tx_hash | `String?` | set when provider confirms |
| created_at | `DateTime` | auto |
| updated_at | `DateTime` | on update |

### Message (outbox)
| column | type | notes |
|---|---|---|
| id | `String` (uuid pk) | |
| payout_id | `String` (fk → Payout.id) | unique — 1 message per payout |
| status | `MessageStatus` | enum |
| attempts | `Int` | default 0 |
| last_attempt_at | `DateTime?` | |
| created_at | `DateTime` | auto |

### LedgerEntry
| column | type | notes |
|---|---|---|
| id | `String` (uuid pk) | |
| account_id | `String` (fk → Account.id) | indexed |
| payout_id | `String?` (fk → Payout.id) | null for non-payout entries |
| entry_type | `LedgerEntryType` | enum |
| amount | `BigInt` | always positive; sign implied by type |
| created_at | `DateTime` | auto |

### Enums (Prisma)
- `PayoutStatus`: `CREATED`, `PROCESSING`, `SENT`, `COMPLETED`, `FAILED`, `NEEDS_REVIEW`
- `MessageStatus`: `PENDING`, `PROCESSING`, `DONE`
- `LedgerEntryType`: `RESERVE`, `RELEASE`, `SETTLE`

## 3. Types and signatures

```ts
// src/payout/payout.repository.ts
export class PayoutRepository {
  constructor(prisma: PrismaClient);

  createWithReservation(
    accountRow: { id: string; reserved: bigint }, // row already locked
    input: CreatePayoutInput,
  ): Promise<{ payout: Payout; message: Message }>;

  findByIdempotencyKey(key: string): Promise<Payout | null>;

  lockAccount(id: string): Promise<Account | null>; // SELECT … FOR UPDATE (raw through $queryRaw)

  completePayout(payoutId: string, txHash: string): Promise<void>;
  markNeedsReview(payoutId: string): Promise<void>;
  markFailed(payoutId: string): Promise<void>;

  claimMessages(limit: number): Promise<Message[]>; // FOR UPDATE SKIP LOCKED, PENDING only
  markMessageDone(messageId: string): Promise<void>;
  incrementAttempts(messageId: string): Promise<Message>;

  recordLedger(entry: Omit<LedgerEntry, "id" | "createdAt">): Promise<LedgerEntry>;
}
```

```ts
// src/payout/payout.service.ts
export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  status: PayoutStatus;
  amount: bigint;
  txHash: string | null;
}

export class PayoutService {
  constructor(repo: PayoutRepository);

  createPayout(input: CreatePayoutInput): Promise<PayoutResponse>;
}
```

```ts
// src/payout/payout-worker.ts
export class PayoutWorker {
  constructor(repo: PayoutRepository, provider: TransferProvider);

  processMessages(): Promise<void>;
}
```

```ts
// src/payout/transfer-provider.ts (interface)
export interface TransferProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

### Errors (thrown as `HttpException` with the standard envelope)

| code | raised by | condition |
|---|---|---|
| `insufficient_funds` | `PayoutService.createPayout` | available < amount |
| `account_not_found` | `PayoutService.createPayout` | accountId has no row |
| `invalid_input` | Controller guard | missing/empty fields, amount ≤ 0, bad uuid |
| `internal_error` | Any layer | unexpected exception (500) |

### Ordering rules

- In `createPayout`: the idempotency-key lookup **must** happen after acquiring the row lock (`lockAccount`), so a racing duplicate sees the first payout's reservation.
- In `processMessages`: check payout status before calling the provider; if already past `PROCESSING`, skip (idempotent duplicate delivery).
- In `processMessages`: the ledger `SETTLE` entry and the account balance update are in the **same** transaction as marking the message `DONE`.

## 4. Control flow

### POST /payouts

1. Controller validates shape (non-empty strings, amount > 0). On failure → `invalid_input`.
2. Service opens a Prisma interactive transaction:
   - `lockAccount(accountId)` → if null, throw `account_not_found`.
   - `findByIdempotencyKey(key)` → if a payout exists, return it (no side-effects).
   - Check `account.settledBalance − account.reserved ≥ amount`. If not, throw `insufficient_funds`.
   - `createWithReservation`: insert Payout (CREATED), Message (PENDING), LedgerEntry (RESERVE), increment `account.reserved` — all in this transaction.
3. Return `{ id, status, amount, txHash }`.

Transaction boundary: steps 2a–2d are one DB transaction. No provider call, no I/O beyond Postgres.

### Worker — processMessages (invoked by a `setInterval` in the module's `onModuleInit`)

1. `claimMessages(10)` — selects up to 10 PENDING messages with `FOR UPDATE SKIP LOCKED`, marks them PROCESSING.
2. For each claimed message (sequential, one transaction per message):
   a. Load payout. If `status` is already `SENT`/`COMPLETED`/`FAILED`/`NEEDS_REVIEW`, mark message DONE and continue (duplicate delivery guard).
   b. Set payout status → `PROCESSING`.
   c. Call `provider.transfer({ to, amount })`.
   d. **Success:** set payout → `SENT` then immediately `COMPLETED`; record `SETTLE` ledger entry; decrement `account.settledBalance` and `account.reserved`; set `txHash`; mark message `DONE`.
   e. **Throw (transient):** increment `message.attempts`. If `attempts ≥ MAX_RETRIES`, set payout → `NEEDS_REVIEW`, mark message `DONE` (funds stay reserved). Else revert message to `PENDING`.
   f. Each sub-step (d or e) is its own transaction with the message lock held.

Transaction boundaries: one per message. The provider call is **outside** the DB transaction (it is a network I/O; we commit the PROCESSING mark before calling, and open a second transaction for the outcome).

### What must NOT be inside a transaction
- The `provider.transfer` call.
- Any HTTP response construction.

## 5. Tests

| test | what it proves |
|---|---|
| Two concurrent `createPayout` calls against an account with balance 100 and amount 60 each → exactly one succeeds, the other gets `insufficient_funds`; balance/reserved are consistent. | No overdraw under race. |
| `createPayout` called twice with the same `idempotencyKey` → second call returns the first payout's id, no second row, reserved unchanged. | Idempotency prevents double-reservation. |
| `processMessages` called twice; the provider mock succeeds both times → payout transitions to COMPLETED exactly once, `SETTLE` ledger entry has one row, balance decremented once. | At-least-once delivery is idempotent. |
| Provider mock throws on every call; after `MAX_RETRIES` invocations the payout is `NEEDS_REVIEW`, message is `DONE`, funds remain reserved (not released back). | Retry exhaustion is safe: no silent fund release. |
| Provider mock throws twice then succeeds on the third call → payout reaches COMPLETED, message DONE, attempts = 2. | Transient failures are retried and eventually succeed. |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma models, enums, relations for Account, Payout, Message, LedgerEntry
src/main.ts | reads: - | Nest bootstrap, JSON body parser, BigInt serialisation filter
src/app.module.ts | reads: src/payout/payout.module.ts | Root module, imports PayoutModule
src/payout/transfer-provider.ts | reads: - | TransferProvider interface + mock implementation for tests
src/payout/payout.repository.ts | reads: - | All Prisma queries: lockAccount, createWithReservation, claimMessages, complete/needs-review/failed transitions, ledger writes
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts | createPayout business logic, idempotency check, balance check
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts | POST /payouts endpoint, input validation
src/payout/payout-worker.ts | reads: src/payout/payout.repository.ts, src/payout/transfer-provider.ts | processMessages loop, provider call, retry/exhaustion logic
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout-worker.ts, src/payout/transfer-provider.ts | Wiring: providers, exports, interval start in onModuleInit
DESIGN.md | reads: - | 10-20 line explanation of funds-safety approach
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout-worker.ts, src/payout/payout.repository.ts, src/payout/transfer-provider.ts | All five tests listed in section 5
-->
