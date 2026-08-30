# Transcript — 01-payout-outbox / variant-a / Qwen3.8-27B-MLX-6bit

Every request, in order, with its reasoning. Nothing is elided.

# plan

## reply

## 1. Assumptions

- **Amounts are `BigInt` (minor units, integer).** No float anywhere; the provider contract is adapted to send/receive `number` minor units.
- **Provider SDK is a dependency-injected interface** (`PayoutProvider`) so tests can stub it; the real implementation is out of scope.
- **Idempotency key is per-account**: unique on `(accountId, idempotencyKey)`. A retry with the same key + account returns the existing payout.
- **Outbox = one `payout_messages` row per payout**, enqueued in the same transaction as the reserve. Worker polls it, so no external broker.
- **At-least-once is handled by idempotent processing**: the worker checks payout status before acting; a duplicate message for an already-`sent` payout is a no-op.
- **Bounded retries = 5**, then status `needs-review` (safe: funds stay reserved, transfer not confirmed, no double-spend, human resolves).
- **`completed` vs `sent`**: `sent` = provider returned a txHash; `completed` = final after confirmation. Here we treat the provider's success response as final, so `sent` and `completed` collapse to a single terminal `sent`. I keep `completed` as the terminal name and drop `sent` to reduce states; lifecycle: `created → processing → sent | failed | needs-review`.
- **Worker runs in-process** via NestJS `onModuleInit` + `setInterval`; poll interval 5s (configurable via env).
- **`failed` is only for permanent provider errors** (e.g. invalid address); transient errors retry. On exhaustion → `needs-review`, not `failed`.
- **Files live under `src/payout/`** per the layout convention; worker is a service in that module.
- **One error envelope** for all HTTP errors per the codebase convention.

## 2. Data model

All tables `snake_case` via Prisma `@@map`; columns `snake_case` via `@map`.

**`accounts`** — `@@map("accounts")`
- `id` : String, PK, cuid
- `available_balance` : BigInt, default 0 (`@map("available_balance")`) — funds not yet reserved
- `pending_balance` : BigInt, default 0 (`@map("pending_balance")`) — reserved for in-flight payouts
- `settled_balance` : BigInt, default 0 (`@map("settled_balance")`) — confirmed out
- `created_at` : DateTime, default now

**`payouts`** — `@@map("payouts")`
- `id` : String, PK, cuid
- `account_id` : String, FK → accounts.id
- `amount` : BigInt — minor units
- `destination_address` : String
- `idempotency_key` : String
- `status` : PayoutStatus (enum below)
- `tx_hash` : String? (`@map("tx_hash")`)
- `retry_count` : Int, default 0
- `created_at` : DateTime, default now
- `updated_at` : DateTime, @updatedAt
- `@@unique([account_id, idempotency_key])`

**`payout_messages`** (outbox) — `@@map("payout_messages")`
- `id` : String, PK, cuid
- `payout_id` : String, FK → payouts.id
- `status` : MessageStatus (enum below)
- `attempts` : Int, default 0
- `last_error` : String? (`@map("last_error")`)
- `created_at` : DateTime, default now
- `updated_at` : DateTime, @updatedAt

**`ledger_entries`** (double-entry) — `@@map("ledger_entries")`
- `id` : String, PK, cuid
- `payout_id` : String, FK → payouts.id
- `account_id` : String, FK → accounts.id
- `type` : LedgerEntryType (enum below)
- `amount` : BigInt — always positive; direction encoded by `type`
- `created_at` : DateTime, default now

**Enums:**
- `PayoutStatus`: `CREATED`, `PROCESSING`, `SENT`, `FAILED`, `NEEDS_REVIEW`
- `MessageStatus`: `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `NEEDS_REVIEW`
- `LedgerEntryType`: `RESERVE`, `SETTLE`, `RELEASE`

## 3. Types and signatures

### Enums (re-exported from Prisma-generated types)

```ts
type PayoutStatus = 'CREATED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'NEEDS_REVIEW';
type MessageStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'NEEDS_REVIEW';
type LedgerEntryType = 'RESERVE' | 'SETTLE' | 'RELEASE';
```

### `PayoutProvider` (interface, in `src/payout/payout-provider.ts`)

```ts
interface PayoutProvider {
  transfer(args: { to: string; amount: number }): Promise<{ txHash: string }>;
}
```

### `PayoutDto` (request body, in `src/payout/payout.controller.ts`)

```ts
interface CreatePayoutDto {
  accountId: string;
  amount: number;          // minor units, integer
  destinationAddress: string;
  idempotencyKey: string;
}
```

### `Payout` (returned shape, in `src/payout/payout.service.ts`)

```ts
interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  retryCount: number;
  createdAt: Date;
}
```

### `PayoutController` (in `src/payout/payout.controller.ts`)

```ts
class PayoutController {
  constructor(service: PayoutService);
  createPayout(dto: CreatePayoutDto): Promise<Payout>;   // POST /payouts
}
```

### `PayoutService` (in `src/payout/payout.service.ts`)

```ts
class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);

  createPayout(dto: CreatePayoutDto): Promise<Payout>;

  processMessages(): Promise<void>;
}
```

### `PayoutRepository` (in `src/payout/payout.repository.ts`)

```ts
class PayoutRepository {
  constructor(prisma: PrismaClient);

  // All methods run inside a Prisma transaction unless noted.

  createPayoutWithReserve(args: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<Payout>;
  // Atomically: check available_balance >= amount (row-locked), decrement
  // available, increment pending, insert payout (CREATED), insert
  // payout_message (PENDING), insert RESERVE ledger entry.
  // Raises PayoutError('insufficient_funds') if balance < amount.
  // Idempotent: if (accountId, idempotencyKey) exists, returns existing payout.

  findById(id: string): Promise<Payout | null>;

  findMessageById(id: string): Promise<Message | null>;

  claimMessage(id: string): Promise<Message | null>;
  // Atomically: if status == PENDING, set to PROCESSING and return it.
  // Otherwise return null (duplicate delivery or already handled).

  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout>;

  settlePayout(payoutId: string, txHash: string): Promise<void>;
  // Atomically: set payout SENT, message SENT, decrement pending_balance,
  // increment settled_balance, insert SETTLE ledger entry.

  failPayout(payoutId: string): Promise<void>;
  // Atomically: set payout FAILED, message FAILED, increment pending_balance
  // (release reservation), insert RELEASE ledger entry.

  markNeedsReview(payoutId: string): Promise<void>;
  // Atomically: set payout NEEDS_REVIEW, message NEEDS_REVIEW. Funds stay
  // reserved (pending_balance unchanged). No ledger entry.

  incrementRetryCount(payoutId: string): Promise<void>;

  findPendingMessages(limit?: number): Promise<Message[]>;
}
```

### `Message` (in `src/payout/payout.repository.ts`)

```ts
interface Message {
  id: string;
  payoutId: string;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}
```

### `PayoutWorker` (in `src/payout/payout-worker.ts`)

```ts
class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  constructor(service: PayoutService, config: ConfigService);
  onModuleInit(): void;    // starts setInterval
  onModuleDestroy(): void; // clears interval
}
```

### `PayoutModule` (in `src/payout/payout.module.ts`)

```ts
class PayoutModule {
  // controllers: [PayoutController]
  // providers: [PayoutService, PayoutRepository, PayoutProvider, PayoutWorker]
  // exports: [PayoutService]
}
```

### Errors (in `src/payout/payout.errors.ts`)

```ts
class PayoutError extends Error {
  code: string;       // snake_case, the contract
  details: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>);
}
```

Error codes raised:
- `insufficient_funds` — `createPayoutWithReserve` when available_balance < amount.
- `invalid_account` — `createPayoutWithReserve` when accountId not found.
- `validation_error` — controller rejects malformed body (non-integer amount, missing fields).

All map to HTTP 400 / 422 with the standard envelope.

### Ordering rules

- **Reserve before enqueue**: the payout row, the message row, and the RESERVE ledger entry are inserted in one transaction. If any fails, all roll back.
- **Claim before process**: the worker must `claimMessage` (PENDING → PROCESSING) before calling the provider. A second worker seeing the same message gets `null` from `claimMessage` and skips it.
- **Settle before release**: `settlePayout` moves funds from pending to settled. `failPayout` returns funds from pending to available. These are mutually exclusive per payout; the status guard in `claimMessage` ensures only one path executes.
- **Idempotency check before insert**: `createPayoutWithReserve` checks for an existing `(accountId, idempotencyKey)` row first. If found, it returns that payout without touching balances.

## 4. Control flow

### Payout lifecycle (state machine)

```
CREATED ──(worker claims)──▶ PROCESSING ──(provider ok)──▶ SENT
                                  │
                                  ├──(transient error, retries left)──▶ PROCESSING (retry)
                                  │
                                  ├──(transient error, retries exhausted)──▶ NEEDS_REVIEW
                                  │
                                  └──(permanent error)──▶ FAILED
```

`SENT`, `FAILED`, `NEEDS_REVIEW` are terminal. No transitions out of them.

### POST /payouts (single transaction)

1. Validate body (controller).
2. `PayoutService.createPayout` → `PayoutRepository.createPayoutWithReserve`:
   - BEGIN TRANSACTION
   - SELECT account FOR UPDATE (row lock)
   - If account missing → `invalid_account`
   - If `(accountId, idempotencyKey)` exists → return existing payout (no balance change)
   - If `available_balance < amount` → `insufficient_funds`
   - UPDATE account: `available_balance -= amount`, `pending_balance += amount`
   - INSERT payout (status CREATED)
   - INSERT payout_message (status PENDING)
   - INSERT ledger_entry (type RESERVE, amount)
   - COMMIT
3. Return payout to client.

### Worker loop (`processMessages`)

1. `findPendingMessages(limit=10)` → list of PENDING messages.
2. For each message:
   a. `claimMessage(id)` → if null, skip (already claimed by another worker).
   b. Load payout via `findById`. If status is not PROCESSING (shouldn't happen after claim), skip.
   c. Call `provider.transfer({to, amount})`.
   d. **On success**: `settlePayout(payoutId, txHash)` — one transaction: payout → SENT, message → SENT, pending_balance -= amount, settled_balance += amount, SETTLE ledger entry.
   e. **On transient error** (timeout, 5xx): `incrementRetryCount`. If `retry_count < 5`: message stays PROCESSING → set back to PENDING for next poll. If `retry_count >= 5`: `markNeedsReview` — payout → NEEDS_REVIEW, message → NEEDS_REVIEW. Funds stay in pending_balance (safe: not double-spent, not lost, human reviews).
   f. **On permanent error** (4xx, invalid address): `failPayout` — payout → FAILED, message → FAILED, pending_balance -= amount, available_balance += amount (release), RELEASE ledger entry.

### Transaction boundaries

- **Transaction A** (POST /payouts): account update + payout insert + message insert + ledger insert. All-or-nothing.
- **Transaction B** (settle): payout update + message update + account update + ledger insert. All-or-nothing.
- **Transaction C** (fail): payout update + message update + account update + ledger insert. All-or-nothing.
- **Transaction D** (needs-review): payout update + message update only. No balance change, no ledger entry.
- **Transaction E** (claim): message update only.

The provider call is **never** inside a transaction. It happens between claim and settle/fail.

### What must not be

- No provider call inside a transaction.
- No balance decrement without a matching ledger entry in the same transaction.
- No payout creation without a message row (outbox invariant).
- No float arithmetic on amounts.

## 5. Tests

- **Concurrent creation against one account**: two simultaneous `POST /payouts` for the same account where combined amount exceeds balance; exactly one succeeds, the other gets `insufficient_funds`; account balances are consistent.
- **Idempotent retry**: same `idempotencyKey` + account submitted twice; second call returns the existing payout, no second row, no double reserve.
- **Duplicate message delivery**: worker processes the same PENDING message twice; the second `claimMessage` returns null and is skipped; provider called exactly once; payout transitions to SENT once.
- **Retry exhaustion**: provider fails transiently 5 times; payout ends in NEEDS_REVIEW; funds remain in pending_balance; no SETTLE or RELEASE ledger entry.
- **Transient retry then success**: provider fails twice then succeeds; payout ends in SENT; SETTLE ledger entry present; balances correct.
- **Permanent failure**: provider returns a permanent error (e.g. bad address); payout ends in FAILED; RELEASE ledger entry present; funds returned to available_balance.
- **Ledger integrity**: after a successful payout, the sum of RESERVE and SETTLE entries for that payout equals the amount; account settled_balance increased by amount.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema: accounts, payouts, payout_messages, ledger_entries, enums
src/payout/payout-provider.ts | reads: - | PayoutProvider interface
src/payout/payout.errors.ts | reads: - | PayoutError class
src/payout/payout.repository.ts | reads: src/payout/payout-provider.ts, src/payout/payout.errors.ts | PayoutRepository + Message type
src/payout/payout.service.ts | reads: src/payout/payout-provider.ts, src/payout/payout.errors.ts, src/payout/payout.repository.ts | PayoutService + Payout type + CreatePayoutDto
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts, src/payout/payout.errors.ts | PayoutController
src/payout/payout-worker.ts | reads: src/payout/payout.service.ts | PayoutWorker
src/payout/payout.module.ts | reads: src/payout/payout-controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout-provider.ts, src/payout/payout-worker.ts | PayoutModule
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/payout-provider.ts, src/payout/payout.errors.ts | concurrent creation, idempotency, duplicate delivery, retry exhaustion, permanent failure, ledger integrity
DESIGN.md | reads: - | 10–20 line funds-safety explanation
-->


---
