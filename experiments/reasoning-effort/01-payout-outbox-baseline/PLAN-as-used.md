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
