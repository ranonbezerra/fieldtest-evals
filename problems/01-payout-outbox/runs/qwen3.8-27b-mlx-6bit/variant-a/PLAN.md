## 1. Assumptions

- **Provider SDK is injected, not real**: `PayoutProvider` is a dependency-injected interface with `transfer(to: string, amount: bigint): Promise<{ txHash: string }>`; tests use a fake. Reason: the SDK is not in scope and must be mockable for retry-exhaustion tests.
- **Outbox enqueue is in the same DB transaction as payout creation**: the message row is written by the repository inside the `createPayout` transaction, so a payout can never exist without its message. Reason: this is the outbox pattern and prevents lost work.
- **Worker claims messages with a status flip + `FOR UPDATE SKIP LOCKED`**: a message moves `pending → processing` atomically before the provider call, so two workers never process one message. Reason: at-least-once is required and idempotency must be enforced downstream.
- **Idempotency key is unique per account**: the outbox message has a unique `(accountId, idempotencyKey)` and the payout references it. Reason: retries from one account are deduped; the key is scoped to the account that owns the funds.
- **Amounts are `bigint` minor units** stored as Prisma `BigInt` (Postgres `BIGINT`); no floats anywhere. Reason: the statement forbids floating-point money.
- **Ledger is double-entry**: one `ledger_entry` per side of a balance change; account settled balance is derived as the sum of entries. Reason: keeps the ledger auditable and the balance a pure aggregate.
- **`processedAt`/`completedAt` timestamps are `timestamptz`**; `createdAt` is `timestamptz`. Reason: standard for Postgres.
- **Poll interval and max retries are env-configured**: `PAYOUT_WORKER_INTERVAL_MS` (default 1000) and `PAYOUT_MAX_ATTEMPTS` (default 3). Reason: no hardcoded config.
- **Retry exhaustion with no definitive outcome → `needs-review`**: if the provider throws a non-timeout error (definitive failure) the payout is `failed`; if it times out or throws ambiguously and attempts are exhausted, the payout is `needs-review` (funds still reserved, no ledger entry posted). Reason: a timeout may mean the transfer actually landed on-chain; failing it would double-spend, so we hold it for manual reconciliation.
- **Files live under `src/payout/`** with names `payout.module.ts`, `payout.controller.ts`, `payout.service.ts`, `payout.repository.ts`, `payout.worker.ts`, `payout.provider.ts`. Reason: matches the `<feature>` layout convention.
- **Error envelope is raised by the controller** translating service-thrown typed errors; the service throws `PayoutError` subclasses. Reason: keeps the envelope contract in one place.

## 2. Data model

**`accounts`** (`@@map("accounts")`)
- `id: String @id @default(cuid())` — `@map("id")`
- `settledBalance: BigInt @default(0)` — `@map("settled_balance")`
- `reservedAmount: BigInt @default(0)` — `@map("reserved_amount")`
- `createdAt: DateTime @default(now())` — `@map("created_at")`

Available funds = `settledBalance - reservedAmount`.

**`payouts`** (`@@map("payouts")`)
- `id: String @id @default(cuid())` — `@map("id")`
- `accountId: String` — `@map("account_id")`, relation to `accounts`
- `amount: BigInt` — `@map("amount")`
- `destinationAddress: String` — `@map("destination_address")`
- `status: PayoutStatus @default(CREATED)` — `@map("status")`
- `txHash: String?` — `@map("tx_hash")`
- `attempts: Int @default(0)` — `@map("attempts")`
- `lastError: String?` — `@map("last_error")`
- `createdAt: DateTime @default(now())` — `@map("created_at")`
- `processedAt: DateTime?` — `@map("processed_at")`
- `completedAt: DateTime?` — `@map("completed_at")`

**`payout_messages`** (`@@map("payout_messages")`)
- `id: String @id @default(cuid())` — `@map("id")`
- `payoutId: String @unique` — `@map("payout_id")`, relation to `payouts`
- `accountId: String` — `@map("account_id")`
- `idempotencyKey: String` — `@map("idempotency_key")`
- `status: MessageStatus @default(PENDING)` — `@map("status")`
- `attempts: Int @default(0)` — `@map("attempts")`
- `createdAt: DateTime @default(now())` — `@map("created_at")`
- `claimedAt: DateTime?` — `@map("claimed_at")`

Unique index: `@@unique([accountId, idempotencyKey], map: "uq_messages_account_idem")`.

**`ledger_entries`** (`@@map("ledger_entries")`)
- `id: String @id @default(cuid())` — `@map("id")`
- `accountId: String` — `@map("account_id")`
- `payoutId: String` — `@map("payout_id")`
- `direction: LedgerDirection` — `@map("direction")` (`CREDIT` | `DEBIT`)
- `amount: BigInt` — `@map("amount")`
- `createdAt: DateTime @default(now())` — `@map("created_at")`

Settled balance invariant: `accounts.settledBalance` == sum of `CREDIT` entries minus sum of `DEBIT` entries for that account. The repository maintains `settledBalance`/`reservedAmount` as cached columns updated in the same transaction as ledger writes.

**Enums (Prisma):**
- `PayoutStatus`: `CREATED`, `PROCESSING`, `SENT`, `COMPLETED`, `FAILED`, `NEEDS_REVIEW`
- `MessageStatus`: `PENDING`, `PROCESSING`, `DONE`, `DEAD`
- `LedgerDirection`: `CREDIT`, `DEBIT`

**Migration:** one initial migration creating all tables, enums, and the unique index.

## 3. Types and signatures

**`src/payout/payout.provider.ts`**
```ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```
Throws on transient or permanent failure; the caller distinguishes by error shape (see §4).

**`src/payout/payout.service.ts`**
```ts
export class PayoutError extends Error {
  readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}

export class InsufficientFundsError extends PayoutError {}   // code: "insufficient_funds"
export class DuplicatePayoutError extends PayoutError {}     // code: "duplicate_payout"
export class PayoutNotFoundError extends PayoutError {}      // code: "resource_not_found"

@Injectable()
export class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);

  // Creates a payout + outbox message in one transaction.
  // Throws InsufficientFundsError if available < amount.
  // Throws DuplicatePayoutError if (accountId, idempotencyKey) already exists.
  createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }>;

  // Called by the worker for each claimed message.
  // Handles retry, status transitions, ledger posting.
  processMessage(messageId: string): Promise<void>;
}
```

**`src/payout/payout.repository.ts`**
```ts
@Injectable()
export class PayoutRepository {
  constructor(prisma: PrismaClient);

  // Atomic: locks account row, checks available, decrements reserved,
  // inserts payout (CREATED) + message (PENDING). Single transaction.
  // Returns { payoutId } or throws InsufficientFundsError / DuplicatePayoutError.
  createPayoutWithMessage(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }>;

  // Claims a pending message: sets status PROCESSING, claimedAt now,
  // increments attempts. Uses SELECT ... FOR UPDATE SKIP LOCKED.
  // Returns the message or null if none available / already claimed.
  claimMessage(messageId: string): Promise<MessageRow | null>;

  // Marks payout PROCESSING, sets processedAt.
  markProcessing(payoutId: string): Promise<void>;

  // Records a provider attempt failure: increments attempts, sets lastError.
  recordAttemptFailure(payoutId: string, error: string): Promise<void>;

  // On success: payout SENT → COMPLETED, sets txHash, completedAt.
  // Posts ledger DEBIT (amount) to account, decrements reserved, decrements settled.
  // Marks message DONE. Single transaction.
  completePayout(payoutId: string, txHash: string): Promise<void>;

  // On definitive failure: payout FAILED, completedAt now.
  // Releases reservation (reserved -= amount). No ledger entry.
  // Marks message DONE. Single transaction.
  failPayout(payoutId: string): Promise<void>;

  // On retry exhaustion without definitive outcome: payout NEEDS_REVIEW.
  // Reservation stays. No ledger entry. Marks message DEAD.
  markNeedsReview(payoutId: string): Promise<void>;

  // Fetches a pending message (for worker polling).
  findPendingMessages(limit: number): Promise<MessageRow[]>;

  // Fetches a message by id (for re-processing / duplicate delivery).
  findMessageById(id: string): Promise<MessageRow | null>;

  // Idempotency check: does a payout already exist for this key?
  findPayoutByAccountIdemKey(accountId: string, idempotencyKey: string): Promise<{ payoutId: string } | null>;
}
```

**`MessageRow`** (internal, not exported): `{ id: string; payoutId: string; accountId: string; status: MessageStatus; attempts: number }`.

**`src/payout/payout.worker.ts`**
```ts
@Injectable()
export class PayoutWorker {
  constructor(service: PayoutService, repo: PayoutRepository);

  // Single poll cycle: fetch pending messages, claim each, call service.processMessage.
  processMessages(): Promise<void>;

  // Starts the interval timer (called by module onModuleInit).
  start(intervalMs: number): void;

  // Stops the timer (called by module onModuleDestroy).
  stop(): void;
}
```

**`src/payout/payout.controller.ts`**
```ts
@Controller('payouts')
export class PayoutController {
  constructor(service: PayoutService);

  @Post()
  create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }>;
}
```

**`CreatePayoutDto`**: `{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }` — `amount` is a decimal string parsed to `bigint` in the controller (no float).

**Error envelope:** the controller catches `PayoutError` subclasses and returns `{ error: { code, message, details } }` with the appropriate HTTP status (409 for duplicate/insufficient, 404 for not found). Non-`PayoutError` → 500 with `code: "internal_error"`.

**Ordering rules:**
- `createPayoutWithMessage` must lock the account row **before** checking balance and inserting, to prevent concurrent overdraw.
- `completePayout` must post the ledger entry **before** updating the account's cached balance columns, in the same transaction.
- `processMessage` must claim (flip to PROCESSING) **before** calling the provider, so a crash after the provider call but before status update results in at-least-once redelivery, not silent loss.
- On duplicate message delivery (message already DONE/DEAD), `processMessage` must be a no-op: check message status first, return immediately if not PROCESSING.

## 4. Control flow

**State machine (payout):**
```
CREATED → PROCESSING → SENT → COMPLETED
                        ↘ FAILED
                        ↘ NEEDS_REVIEW
```
- `CREATED`: set at creation, in the same transaction as the outbox message.
- `PROCESSING`: set when the worker begins processing (after claim).
- `SENT`: set when the provider returns a `txHash` (transfer confirmed on-chain).
- `COMPLETED`: set immediately after `SENT` in the same transaction that posts the ledger entry. In practice SENT and COMPLETED are set together; SENT exists as a distinct state for observability if the ledger post is deferred.
- `FAILED`: set on definitive provider failure (non-timeout error) after all retries exhausted, or immediate if the provider rejects the address.
- `NEEDS_REVIEW`: set when retries are exhausted and the last failure was ambiguous (timeout or unknown error). Funds remain reserved. No ledger entry.

**State machine (message):**
```
PENDING → PROCESSING → DONE
                  ↘ DEAD
```

**Transaction boundaries:**

1. **`createPayoutWithMessage`** (one transaction):
   - `SELECT ... FOR UPDATE` on the account row.
   - Check `settledBalance - reservedAmount >= amount`. If not, throw `InsufficientFundsError`.
   - Check idempotency: if a payout already exists for `(accountId, idempotencyKey)`, throw `DuplicatePayoutError`.
   - Increment `reservedAmount` by `amount`.
   - Insert payout row (status CREATED).
   - Insert message row (status PENDING).
   - Commit.

2. **`claimMessage`** (one transaction):
   - `SELECT ... FOR UPDATE SKIP LOCKED` the message row.
   - If status is not PENDING, return null (already claimed or done).
   - Set status PROCESSING, `claimedAt` = now, increment `attempts`.
   - Commit.

3. **`completePayout`** (one transaction):
   - Set payout status COMPLETED, `txHash`, `completedAt`.
   - Insert ledger entry (DEBIT, amount) for the account.
   - Decrement `reservedAmount` by `amount`, decrement `settledBalance` by `amount`.
   - Set message status DONE.
   - Commit.

4. **`failPayout`** (one transaction):
   - Set payout status FAILED, `completedAt`.
   - Decrement `reservedAmount` by `amount` (release reservation). No ledger entry.
   - Set message status DONE.
   - Commit.

5. **`markNeedsReview`** (one transaction):
   - Set payout status NEEDS_REVIEW.
   - Reservation stays. No ledger entry.
   - Set message status DEAD.
   - Commit.

**What must NOT be inside a transaction:** the provider `transfer()` call. It is a network call that may take seconds; holding a DB transaction open across it would block the account row lock and cause deadlocks.

**`processMessage` flow (no single transaction; each DB op is its own):**
1. Load the message by id. If status is DONE or DEAD, return (idempotent no-op for duplicate delivery).
2. If status is not PROCESSING, claim it (step 2 above). If claim returns null, return.
3. Load the associated payout. If payout status is not CREATED or PROCESSING, return (already handled).
4. Mark payout PROCESSING.
5. Call `provider.transfer(destinationAddress, amount)`.
   - **Success**: call `completePayout(payoutId, txHash)`. Done.
   - **Failure**: record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`, leave the message as PROCESSING (it will be re-claimed by a subsequent poll after a timeout/reclaim, or the worker can reset it to PENDING for retry). If `attempts >= PAYOUT_MAX_ATTEMPTS`:
     - If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`.
     - If the error is **ambiguous** (timeout, 5xx, network error): call `markNeedsReview`.

**Retry mechanism:** after a failed attempt where retries remain, the message status is reset to PENDING (via `recordAttemptFailure` or a separate repo call) so the next poll picks it up again. The `attempts` counter on the message tracks how many times it has been processed.

**Duplicate delivery:** if the worker polls and finds a message already in PROCESSING (from a concurrent or crashed prior run), `claimMessage` returns null and the message is skipped. If a message is already DONE/DEAD, `processMessage` returns immediately. The idempotency of the payout state transitions (only CREATED/PROCESSING → terminal) ensures no double ledger entry.

## 5. Tests

- **Concurrent creation against one account**: two `createPayout` calls with different idempotency keys race against an account whose available balance covers only one; exactly one succeeds, the other throws `InsufficientFundsError`; the account's `reservedAmount` equals the successful amount, not the sum.
- **Duplicate idempotency key**: two `createPayout` calls with the same `(accountId, idempotencyKey)`; the second throws `DuplicatePayoutError`; the account's `reservedAmount` is incremented only once.
- **Duplicate message delivery**: call `processMessage` twice for the same message id; the provider `transfer` is called exactly once; the payout reaches COMPLETED with a single ledger entry; the second call is a no-op.
- **Retry exhaustion with definitive failure**: the provider throws a non-timeout error on every attempt; after `PAYOUT_MAX_ATTEMPTS` calls the payout is FAILED, the reservation is released, no ledger entry exists, and the message is DONE.
- **Retry exhaustion with ambiguous failure (timeout)**: the provider throws a timeout error on every attempt; after `PAYOUT_MAX_ATTEMPTS` calls the payout is NEEDS_REVIEW, the reservation is still held, no ledger entry exists, and the message is DEAD.
- **Transient failure then success**: the provider fails once (timeout) then succeeds on the second attempt; the payout is COMPLETED with a ledger entry; `attempts` on the message is 2.
- **Ledger balance invariant**: after a successful payout, `accounts.settledBalance` equals the sum of CREDIT entries minus DEBIT entries for that account; `reservedAmount` is decremented by the payout amount.
- **Worker polls and processes**: seed a PENDING message, call `processMessages()`, the payout transitions to COMPLETED and the message to DONE.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema: accounts, payouts, payout_messages, ledger_entries tables and PayoutStatus, MessageStatus, LedgerDirection enums
prisma/migrations/0001_init/migration.sql | reads: - | Initial migration creating all tables, enums, and the (account_id, idempotency_key) unique index
src/payout/payout.provider.ts | reads: - | PayoutProvider interface with transfer(to, amount) -> Promise<{txHash}>
src/payout/payout.repository.ts | reads: src/payout/payout.provider.ts | PayoutRepository: all DB access — createPayoutWithMessage, claimMessage, markProcessing, recordAttemptFailure, completePayout, failPayout, markNeedsReview, findPendingMessages, findMessageById, findPayoutByAccountIdemKey
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts, src/payout/payout.provider.ts | PayoutService: createPayout, processMessage; PayoutError and subclasses (InsufficientFundsError, DuplicatePayoutError, PayoutNotFoundError)
src/payout/payout.worker.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts | PayoutWorker: processMessages, start, stop; interval timer for polling
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts | PayoutController: POST /payouts; CreatePayoutDto; error envelope translation
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout.worker.ts, src/payout/payout.provider.ts | PayoutModule: wires provider, repository, service, worker, controller
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout.worker.ts, src/payout/payout.provider.ts | Tests: concurrent creation, duplicate idempotency key, duplicate message delivery, retry exhaustion (definitive + ambiguous), transient-then-success, ledger invariant, worker poll
DESIGN.md | reads: - | 10-20 line explanation of the funds-safety approach
-->
