## 1. Assumptions

- **Amounts are `BigInt` in code, `BIGINT`/Postgres `bigint` in the DB** — minor units, no float anywhere.
- **Provider SDK is injected as a token `PAYOUT_PROVIDER`** whose value implements `{ transfer(to: string, amount: bigint): Promise<{ txHash: string }> }`; a `NoopProvider`/fake is used in tests.
- **One worker instance** polls the message table; at-least-once is handled by idempotent processing keyed on `messageId`, not by a distributed lock.
- **Polling interval** is `PAYOUT_POLL_MS` (env), default 1000 ms; worker starts/stops with the Nest app lifecycle.
- **Retry policy**: `PAYOUT_MAX_ATTEMPTS` (env), default 3. Each failed *attempt* increments `attempts`; a message is marked `dead` after the `N`th attempt without a definitive outcome.
- **Safe behavior on retry exhaustion**: mark the payout `needs_review` and the message `dead`, and **do NOT reverse the ledger** — because we never received a definitive success, the settled balance was never debited, so there is nothing to roll back; a human investigates whether the transfer actually landed.
- **Available balance** = `settled_balance` − `reserved_amount`, both read from the ledger in the same transaction as the reservation.
- **Idempotency key is globally unique** (not per account); a retry with the same key returns the existing payout.
- **Statuses**: `created`, `processing`, `sent`, `completed`, `failed`, `needs_review`.
- **File layout** follows the given convention; feature folder is `payout`, plus a `worker` subfolder for the polling loop.
- **Error codes**: `insufficient_funds`, `duplicate_idempotency_key` (409 on create), `resource_not_found`, `invalid_request`.

## 2. Data model

**accounts** (`@@map("accounts")`)
- `id` String, PK
- `settled_balance` BigInt (`@map("settled_balance")`) — confirmed, spendable funds
- `reserved_amount` BigInt (`@map("reserved_amount")`) — held by in-flight payouts
- `created_at` DateTime, default now

**payouts** (`@@map("payouts")`)
- `id` String, PK (uuid)
- `account_id` String (`@map("account_id")`), FK → accounts.id
- `amount` BigInt — minor units
- `destination_address` String (`@map("destination_address")`)
- `idempotency_key` String, unique (`@map("idempotency_key")`)
- `status` String — one of the status values in §1
- `tx_hash` String? (`@map("tx_hash")`) — set on `sent`/`completed`
- `attempts` Int, default 0 (`@map("attempts")`)
- `created_at`, `updated_at` DateTime

**ledger_entries** (`@@map("ledger_entries")`)
- `id` String, PK (uuid)
- `payout_id` String? (`@map("payout_id")`), FK → payouts.id
- `account_id` String (`@map("account_id")`)
- `type` String — `reserve`, `release`, `settle_out`
- `amount` BigInt — always positive; sign is implied by `type`
- `created_at` DateTime

**messages** (`@@map("messages")`) — the outbox / queue
- `id` String, PK (uuid)
- `payout_id` String (`@map("payout_id")`), FK → payouts.id, unique
- `status` String — `pending`, `processing`, `done`, `dead`
- `attempts` Int, default 0 (`@map("attempts")`)
- `last_error` String? (`@map("last_error")`)
- `created_at`, `updated_at` DateTime

Every schema change ships with a migration (one initial migration covers all tables).

## 3. Types and signatures

```ts
// src/payout/provider.types.ts
export interface PayoutProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER'; // injection token

// src/payout/payout.types.ts
export type PayoutStatus =
  | 'created' | 'processing' | 'sent'
  | 'completed' | 'failed' | 'needs_review';

export type LedgerType = 'reserve' | 'release' | 'settle_out';
export type MessageStatus = 'pending' | 'processing' | 'done' | 'dead';

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutView {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
}

export interface ProviderResult {
  txHash: string;
}
```

**Repository (the only layer that touches Prisma).** All methods are async. Transactional multi-step methods take a `tx` client passed by the service so the service owns the boundary.

```ts
// src/payout/payout.repository.ts
export class PayoutRepository {
  constructor(prisma: PrismaClient);

  // account
  getAccount(id: string): Promise<Account | null>;
  // Atomic: read settled_balance & reserved_amount, check settled - reserved >= amount,
  // then increment reserved_amount. Throws InsufficientFundsError if it cannot.
  reserveFunds(tx: Prisma.TransactionClient, accountId: string, amount: bigint): Promise<void>;
  releaseReserved(tx: Prisma.TransactionClient, accountId: string, amount: bigint): Promise<void>;
  // Debits settled_balance by amount (the only place settled balance decreases).
  settleOut(tx: Prisma.TransactionClient, accountId: string, amount: bigint): Promise<void>;

  // payout
  findPayoutByIdempotencyKey(key: string): Promise<Payout | null>;
  createPayoutWithMessage(tx: Prisma.TransactionClient, dto: CreatePayoutDto): Promise<Payout>;
  getPayout(id: string): Promise<Payout | null>;
  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<void>;
  incrementPayoutAttempts(id: string): Promise<number>; // returns new count

  // message
  claimNextPendingMessage(): Promise<Message | null>;
  // CAS: only succeeds if status is still 'pending'; else returns false (lost the race).
  claimMessage(id: string): Promise<boolean>;
  setMessageStatus(id: string, status: MessageStatus, lastError?: string): Promise<void>;
  incrementMessageAttempts(id: string): Promise<number>;
}
```

**Service.** Holds all logic; calls the repository and the provider.

```ts
// src/payout/payout.service.ts
export class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);

  createPayout(dto: CreatePayoutDto): Promise<PayoutView>;
  // Runs inside ONE transaction: findPayoutByIdempotencyKey (return existing if present),
  // reserveFunds, createPayoutWithMessage.

  processMessages(): Promise<number>; // claims + processes all pending, returns count processed
  // For each claimed message: run processOneMessage.

  private processOneMessage(msg: Message): Promise<void>;
  // provider.transfer -> on success: settle_out + release? (see §4) + status transitions;
  // on throw: increment attempts, decide retry vs dead.
}
```

**Controller.** Validates input only; maps to the service; returns the error envelope.

```ts
// src/payout/payout.controller.ts
export class PayoutController {
  constructor(service: PayoutService);
  @Post('payouts') create(@Body() body: CreatePayoutDto): Promise<PayoutView>;
}
```

**Worker.** Owns the timer; delegates to the service.

```ts
// src/payout/worker/payout.worker.ts
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  constructor(service: PayoutService, config: ConfigService);
  onModuleInit(): void;    // starts setInterval(this.tick, PAYOUT_POLL_MS)
  onModuleDestroy(): void; // clears the interval
  private tick(): Promise<void>; // calls processMessages(), swallows + logs errors
}
```

**Errors.** All thrown as `PayoutError` (an `Error` subclass) carrying a code; the controller (or an exception filter) maps them to the envelope.

```ts
// src/payout/payout.errors.ts
export type ErrorCode =
  | 'insufficient_funds' | 'duplicate_idempotency_key'
  | 'resource_not_found' | 'invalid_request';

export class PayoutError extends Error {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
  code: ErrorCode;
  details: Record<string, unknown>; // always an object, never null
}
```

- `InsufficientFundsError` → code `insufficient_funds`, raised by `reserveFunds` when `settled - reserved < amount`.
- `DuplicateIdempotencyKeyError` → code `duplicate_idempotency_key`, raised by `createPayout` when the key already exists (409).
- `ResourceNotFoundError` → code `resource_not_found`, raised when an account or payout id does not exist.
- `InvalidRequestError` → code `invalid_request`, raised by the controller for malformed body (missing fields, negative amount).

**Ordering rules (the two operations that could be written in either order).**
- In `createPayout`: `reserveFunds` **before** `createPayoutWithMessage`. If the payout row is created first and the reservation fails, we would have a payout with no held funds.
- In `processOneMessage` success path: `settleOut` (debit settled) **before** marking the payout `sent`. If we marked `sent` first and the debit failed, we'd claim a transfer we never accounted for. The message is marked `done` only after both the payout status and the ledger are committed.
- In `processOneMessage` failure path: increment attempts **before** deciding retry vs dead, so the count reflects the attempt just made.

## 4. Control flow

**State machine (payout.status):**
```
created --worker claims--> processing --transfer ok--> sent --(committed)--> completed
                              |
                              |--attempts < MAX, transient--> processing (retry)
                              |--attempts >= MAX, no definitive outcome--> needs_review
                              +--definitive provider rejection--> failed
```
`needs_review` and `failed` are terminal. The message mirrors: `pending → processing → done | dead`.

**Transaction boundaries.**
1. **Create (one tx):** look up idempotency key → if found, return existing (no reservation). Else `reserveFunds` (atomic balance check + increment) → insert payout (`created`) → insert message (`pending`). Commit. The transfer is NOT in this tx.
2. **Process one message (per attempt, its own tx for the DB writes):**
   - Claim the message (`pending → processing`) via CAS; if it fails, skip (another worker got it).
   - Call `provider.transfer` **outside** any DB transaction (it may be slow/timeout).
   - **Success:** in one tx: `settleOut` (debit settled), set payout `sent` with `txHash`, set message `done`. Commit.
   - **Failure:** in one tx: increment message attempts, store `last_error`. If attempts < MAX → reset message to `pending` (retry) and payout stays/returns to `processing`. If attempts >= MAX → set message `dead`, payout `needs_review`. Commit.
   - What must NOT be inside the transfer call: any DB write that assumes success. The settled balance is debited only after a confirmed `txHash`.

**Why `needs_review` on exhaustion (not auto-fail, not auto-reverse):** a timeout/ambiguous failure means we do not know if the transfer landed on-chain. Reversing the ledger (releasing the reservation) would make the funds spendable again while a real transfer may have succeeded → double-spend of settled balance. Holding the reservation and flagging for human review is the safe default: funds stay locked until a human confirms the on-chain state, then completes or fails it manually.

## 5. Tests

- `concurrent creation against one account`: N racing `createPayout` calls with distinct idempotency keys on an account holding funds for exactly K of them → exactly K succeed, N−K raise `insufficient_funds`, and `reserved_amount` == sum of the K amounts (no overdraw).
- `duplicate idempotency key`: two `createPayout` with the same key → one creates, the other returns the existing payout; only one payout row and one reservation exist.
- `duplicate message delivery`: `processOneMessage` invoked twice for the same message → the transfer is debited exactly once (settled_balance drops by `amount` once), payout reaches `completed`/`sent` exactly once, second call is a no-op.
- `retry exhaustion`: provider always throws; after MAX attempts the message is `dead`, payout is `needs_review`, and the reservation is still held (settled_balance unchanged).
- `transient failure then success`: provider throws once then succeeds → payout completes, settled_balance debited once, message `done`.
- `insufficient funds on create`: amount > available → `insufficient_funds`, no payout row, reservation unchanged.
- `invalid request`: missing/negative fields → `invalid_request` envelope from the controller.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | all tables, columns, relations, @@map
prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | initial DDL for all tables
src/payout/payout.errors.ts | reads: - | PayoutError + ErrorCode, the single error type
src/payout/provider.types.ts | reads: - | PayoutProvider interface + PAYOUT_PROVIDER token
src/payout/payout.types.ts | reads: - | status/type unions, DTOs, PayoutView
src/payout/payout.repository.ts | reads: src/payout/payout.types.ts, src/payout/payout.errors.ts | only layer touching Prisma: account funds, payout, ledger, message
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts, src/payout/provider.types.ts, src/payout/payout.types.ts, src/payout/payout.errors.ts | create + processMessages logic, tx boundaries, retry policy
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts, src/payout/payout.types.ts, src/payout/payout.errors.ts | validates input, maps to service + error envelope
src/payout/worker/payout.worker.ts | reads: src/payout/payout.service.ts | polling loop, lifecycle start/stop
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/worker/payout.worker.ts, src/payout/provider.types.ts | wires providers/exports/controller
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/provider.types.ts, src/payout/payout.errors.ts | concurrent creation, duplicate delivery, retry exhaustion, transient-then-success
-->
