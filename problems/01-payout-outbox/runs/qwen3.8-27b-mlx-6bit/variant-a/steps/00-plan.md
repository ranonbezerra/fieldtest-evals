# plan

## reasoning

```
Let me analyze the task and write a PLAN.md for the crypto payout service.

The task requires:
1. POST /payouts endpoint with idempotency
2. Asynchronous processing via message table + polling worker
3. Concurrent safety for account balances (no overdraft)
4. Payout lifecycle tracking
5. Double-entry ledger
6. Bounded retries with safe failure handling

Let me plan each section:

**1. Assumptions:**
- Polling interval: 5 seconds (configurable via env PAYOUT_POLL_INTERVAL_MS)
- Max retries: 3 (constant)
- On retry exhaustion without definitive outcome: mark as `needs_review` and alert — because we can't know if the transfer hit the chain or not, so we must not retry blindly (could double-spend) and must not assume failure (could lose funds)
- Provider SDK is injected as an interface for testability
- No webhook from provider — we poll the message table
- Amounts are integers (minor units, e.g. cents for USDC)
- The `idempotencyKey` is unique per (accountId, idempotencyKey)
- The account balance is tracked in a ledger table with double-entry (debit/credit entries)
- On successful transfer confirmation, we post to the ledger: debit account balance, credit payout settlement
- The "reserving" is done atomically via SELECT FOR UPDATE on the account row during payout creation

Wait, let me reconsider. The requirements say:
- "Creates a payout if the account has sufficient available funds" — this is at creation time
- "The account's settled balance changes only when the provider confirms the transfer" — so the ledger settlement happens at confirmation
- But we need to prevent overdraft at creation time

So the flow is:
1. At creation: check available balance (committed - reserved), reserve the amount (set reserved += amount) — all in one transaction with row lock
2. At confirmation: post the ledger entry (debit reserved, credit settled out)

Actually, let me think about this more carefully with double-entry:
- Account has a "balance" (available funds)
- When creating a payout: we check balance >= amount, then we "reserve" (balance stays but available = balance - reserved)
- When provider confirms: we post the entry, reducing the actual balance

For double-entry ledger:
- Each account has a running balance
- When funds come in: credit the account (increase)
- When a payout is confirmed: debit the account (decrease)

But we need to reserve at creation time without changing the settled balance. So:
- `accounts` table: `balance` (settled, minor units bigint)
- `payouts` table: tracks status
- At creation: atomically check `balance >= amount + sum(reserved payouts)` and mark payout as created
- At confirmation: `UPDATE accounts SET balance = balance - amount` — only then does the settled balance change

Actually for double-entry:
- `ledger_entries` table: (id, account_id, debit bigint, credit bigint, reference_type, reference_id, created_at)
- When funds are deposited: (account_id, 0, amount) — credit
- When payout confirmed: (account_id, amount, 0) — debit
- Available = total credits - total debits - sum(pending/reserved amounts)

Let me reconsider the data model:

Tables:
1. `accounts` — id, balance (bigint), created_at
2. `payouts` — id, account_id, amount (bigint), destination_address, idempotency_key, status, created_at, updated_at
3. `outbox_messages` — id, payout_id, payload (jsonb), status, attempts, next_attempt_at, created_at, updated_at
4. `ledger_entries` — id, account_id, debit (bigint), credit (bigint), reference_type, reference_id, created_at

Unique constraint: payouts(account_id, idempotency_key)

Status enum for payouts: created, processing, sent, completed, failed, needs_review
Status enum for outbox_messages: pending, delivered, processing, done

Wait, the task says "Use a message table in Postgres as the queue plus a polling worker". So the outbox pattern:
- Create payout + insert outbox message in same transaction
- Worker polls outbox for pending messages, picks them up, processes them

Worker flow:
1. Select pending messages ordered by created_at, LIMIT batch
2. For each message: mark as processing (claim)
3. Call provider.transfer()
4. If success: update payout to completed, post ledger entry, mark message done
5. If transient error: increment attempts, if < max set next_attempt_at, else mark needs_review
6. If permanent error: mark payout failed, mark message done

Let me structure this now.

**Files to create:**
- prisma/schema.prisma
- src/main.ts
- src/app.module.ts
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/payout/payout.types.ts (or keep types in service/repository)
- src/outbox/outbox.module.ts
- src/outbox/outbox.service.ts (worker)
- src/outbox/outbox.repository.ts
- test/payout.spec.ts
- DESIGN.md

Wait, the layout convention says:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

So I'll have:
- src/payout/... for the payout feature
- src/outbox/... for the outbox worker

Actually, let me reconsider. The outbox is part of the payout flow. But it's a separate concern (the worker). Let me put them in separate feature folders since they have different modules.

Let me also think about the provider SDK. I'll define an interface for it:
```typescript
interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

This gets injected via DI.

Now let me write the plan concisely.

For the manifest, I need to list files in dependency order (reads only reference files listed above it).

Let me finalize:

Files:
1. prisma/schema.prisma — the schema
2. src/main.ts — bootstrap
3. src/app.module.ts — root module
4. src/payout/provider.interface.ts — BlockchainProvider interface
5. src/payout/payout.types.ts — shared types, enums, DTOs
6. src/payout/payout.repository.ts — DB access
7. src/payout/payout.service.ts — business logic
8. src/payout/payout.controller.ts — HTTP layer
9. src/payout/payout.module.ts — module wiring
10. src/outbox/outbox.repository.ts — outbox DB access
11. src/outbox/outbox.service.ts — worker logic
12. src/outbox/outbox.module.ts — module wiring
13. test/payout.spec.ts — tests
14. DESIGN.md

Wait, I need to be careful. The convention says TS file: `kebab-case.role.ts`. So:
- provider.interface.ts
- payout.types.ts
- etc.

Let me write this out now, keeping it terse and complete.

For the retry exhaustion: mark payout as `needs_review`. Why safe? Because we don't know if the transfer hit the chain. Retrying could double-spend. Assuming failure could leave funds stuck in limbo while the recipient actually got paid. `needs_review` halts automated processing and flags for human inspection.

Let me also think about the "ordering rule" requirement in section 3. Key ordering:
- Payout creation must happen before outbox message insertion (same transaction)
- Ledger entry posting must happen after payout status is set to completed (same transaction)
- Message must be marked done in the same transaction as payout completion

Let me write the plan now.
```

## reply

## 1. Assumptions

| Open question | Choice | Why |
|---|---|---|
| Poll interval | 5 s, env `PAYOUT_POLL_INTERVAL_MS` | Sensible default; config without code change |
| Max provider retries | 3 (constant `MAX_ATTEMPTS`) | Bounded; keeps the worker bounded even under sustained failures |
| Behaviour on retry exhaustion with no definitive outcome | Mark payout `needs_review`, leave ledger untouched, mark message done | We cannot know if the tx hit-chain; retrying risks double-spend, assuming failure risks losing track of paid funds. Halting and flagging for human inspection is the only safe option |
| Provider SDK interface | `BlockchainProvider` interface, injected via DI | Testability; the task says "assume" the SDK |
| Amount type | `bigint` (Prisma `BigInt`) throughout | Task forbids floating point for money |
| Idempotency scope | Unique on `(account_id, idempotency_key)` | A key is meaningful only within one account |
| Outbox batch size per poll | 10 (constant) | Bounded work per tick; avoids starving the connection pool |
| File for shared payout types / DTOs | `src/payout/payout.types.ts` | Keeps controller/service/repository agreeing on one import |
| Feature folder for worker | `src/outbox/` (separate from `src/payout/`) | The worker is a distinct module with its own module file per the layout convention |
| Error on insufficient funds | HTTP 422, code `insufficient_funds` | Distinguishes from "not found" or validation error |
| Error on duplicate idempotency (same account, different body) | HTTP 409, code `idempotency_conflict` | Client bug; surfaced explicitly rather than silently returning the old row |

## 2. Data model

### accounts
| Column | Type | Notes |
|---|---|---|
| id | `uuid` (pk) | |
| balance | `bigint` | Settled balance, minor units. Changes only on confirmed transfer or deposit |
| created_at | `timestamptz` | |

### payouts
| Column | Type | Notes |
|---|---|---|
| id | `uuid` (pk) | |
| account_id | `uuid` (fk → accounts.id) | |
| amount | `bigint` | Minor units, > 0 |
| destination_address | `text` | |
| idempotency_key | `text` | |
| status | `text` | One of: `created`, `processing`, `sent`, `completed`, `failed`, `needs_review` |
| tx_hash | `text?` | Set when provider confirms |
| created_at | `timestamptz` | |
| updated_at | `timestamptz` | |

**Unique constraint:** `(account_id, idempotency_key)`.

### outbox_messages
| Column | Type | Notes |
|---|---|---|
| id | `uuid` (pk) | |
| payout_id | `uuid` (fk → payouts.id, unique) | One message per payout |
| payload | `jsonb` | `{ to: string, amount: bigint }` |
| status | `text` | `pending`, `processing`, `done` |
| attempts | `int` | Starts 0 |
| next_attempt_at | `timestamptz?` | NULL = ready now |
| last_error | `text?` | Last provider error message, for ops |
| created_at | `timestamptz` | |
| updated_at | `timestamptz` | |

### ledger_entries
| Column | Type | Notes |
|---|---|---|
| id | `uuid` (pk) | |
| account_id | `uuid` (fk → accounts.id) | |
| debit | `bigint` | 0 when this is a credit entry |
| credit | `bigint` | 0 when this is a debit entry |
| reference_type | `text` | `deposit` or `payout` |
| reference_id | `uuid?` | Payout id when type is `payout` |
| created_at | `timestamptz` | |

Double-entry invariant: for every row, exactly one of `debit`/`credit` is non-zero.

## 3. Types and signatures

### `src/payout/payout.types.ts`

```ts
// ── Enums (string-union, not TS enum, to keep Prisma happy) ──
export type PayoutStatus = 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';
export type OutboxStatus = 'pending' | 'processing' | 'done';

// ── DTOs ──
export interface CreatePayoutDto {
  accountId: string;
  amount: string;            // decimal-string of minor units; parsed to BigInt in service
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  status: PayoutStatus;
  amount: string;            // minor units as string
}

// ── Provider interface ──
export interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

// ── Error codes (module-level consts) ──
export const ERROR_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const ERROR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
export const ERROR_ACCOUNT_NOT_FOUND = 'resource_not_found';
export const ERROR_VALIDATION = 'validation_failed';
```

### `src/payout/provider.interface.ts`

Re-exports `BlockchainProvider` from `payout.types.ts` (single file to avoid circular imports if needed; here it's just a re-export barrel).

### `src/payout/payout.repository.ts`

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically: SELECT … FOR UPDATE on the account row, compute
   * available = balance − Σ(payouts.amount WHERE status IN ('created','processing','sent')),
   * check available >= amount, INSERT payout (status='created') + outbox_message (status='pending')
   * in one $transaction. Returns the payout row.
   * Throws Prisma.PrismaClientKnownRequestError (code P2002) on idempotency conflict.
   * Throws a custom InsufficientFundsError when available < amount.
   */
  createPayoutWithReservation(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRow>;

  /** UPDATE payouts SET status, tx_hash, updated_at WHERE id = $. Returns updated row or null. */
  updatePayout(id: string, status: PayoutStatus, txHash?: string): Promise<PayoutRow | null>;

  /** Single-row read by id. */
  findById(id: string): Promise<PayoutRow | null>;

  /**
   * Atomic ledger post + balance decrement:
   * INSERT ledger_entries (debit=amount, credit=0, reference_type='payout', reference_id)
   * + UPDATE accounts SET balance = balance − amount WHERE id = accountId AND balance >= amount.
   * In one $transaction. Throws OverdraftError if the guard fails (should never happen
   * if reservation logic is correct, but defensive).
   */
  confirmPayoutLedger(accountId: string, payoutId: string, amount: bigint): Promise<void>;
}
```

### `src/payout/payout.service.ts`

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Validates the DTO (amount > 0, non-empty strings), calls
   * repo.createPayoutWithReservation. Maps P2002 → conflict check (same body → return
   * existing; different body → 409 idempotency_conflict). Maps InsufficientFundsError → 422.
   */
  create(dto: CreatePayoutDto): Promise<PayoutResponse>;
}
```

### `src/payout/payout.controller.ts`

```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse>;
}
```

### `src/outbox/outbox.repository.ts`

```ts
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim up to `limit` pending messages: SELECT … WHERE status='pending'
   * AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at
   * FOR UPDATE SKIP LOCKED, then mark them 'processing'. Returns claimed rows.
   */
  claimPending(limit: number): Promise<OutboxMessageRow[]>;

  /** Mark a message done (idempotent). */
  markDone(messageId: string): Promise<void>;

  /** Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error. */
  recordAttempt(messageId: string, attempts: number, nextAttemptAt: Date | null, lastError?: string): Promise<void>;
}
```

### `src/outbox/outbox.service.ts`

```ts
@Injectable()
export class OutboxService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  /** Start the polling loop. Called from module onModuleInit. */
  start(): void;

  /** Stop the polling loop. Called from module onModuleDestroy. */
  stop(): void;

  /**
   * One polling tick: claim messages, process each.
   * For each message:
   *   1. Load the payout row (payoutRepo.findById).
   *   2. If payout.status is 'completed' or 'failed' → mark message done (idempotent redelivery).
   *   3. Set payout.status = 'processing' (if currently 'created').
   *   4. Call provider.transfer({ to, amount }).
   *   5a. Success → payout.status='completed', tx_hash set; call payoutRepo.confirmPayoutLedger;
   *       mark message done. All in a single $transaction.
   *   5b. Error → outboxRepo.recordAttempt. If attempts >= MAX_ATTEMPTS →
   *       payout.status='needs_review'; mark message done. Else leave for next poll.
   */
  processMessages(): Promise<void>;
}
```

### `src/payout/payout.module.ts`

Providers: `PayoutRepository`, `PayoutService`.  
Exports: `PayoutService`, `PayoutRepository` (outbox module needs the repo).  
Declares: `PayoutController`.  
Imports: none (PrismaModule is global or imported in AppModule).

### `src/outbox/outbox.module.ts`

Providers: `OutboxRepository`, `OutboxService`.  
Imports: `PayoutModule` (for `PayoutRepository`).

### Error envelope

All HTTP errors use:
```json
{ "error": { "code": "<snake_case>", "message": "...", "details": {} } }
```
`details` is always an object (possibly `{}`).

| Code | HTTP | Raised by |
|---|---|---|
| `validation_failed` | 400 | Controller: missing/empty fields, amount ≤ 0 or non-numeric |
| `resource_not_found` | 404 | Service: accountId does not exist |
| `insufficient_funds` | 422 | Repository → Service: available < amount |
| `idempotency_conflict` | 409 | Service: same key, different body fields |

## 4. Control flow

### Payout creation (single DB transaction)

```
BEGIN
  SELECT balance FROM accounts WHERE id = $accountId FOR UPDATE
  (if no row → ROLLBACK, throw resource_not_found)

  SELECT COALESCE(SUM(amount), 0) AS reserved FROM payouts
    WHERE account_id = $accountId AND status IN ('created','processing','sent')

  IF balance - reserved < amount → ROLLBACK, throw insufficient_funds

  INSERT INTO payouts (…, status='created')
  INSERT INTO outbox_messages (…, status='pending', attempts=0)
COMMIT
```

*Idempotency:* the unique index on `(account_id, idempotency_key)` causes P2002 on retry. The service catches it, fetches the existing row, and either returns 200 (same body) or 409 (different body).

### Worker tick (`processMessages`)

```
messages = outboxRepo.claimPending(BATCH_SIZE)   -- FOR UPDATE SKIP LOCKED, mark 'processing'

FOR each message:
  payout = payoutRepo.findById(message.payoutId)

  IF payout.status IN ('completed','failed')
    → outboxRepo.markDone(message.id)          -- at-least-once redelivery, no-op
    CONTINUE

  IF payout.status == 'created'
    → payoutRepo.updatePayout(payout.id, 'processing')

  TRY provider.transfer({ to: payload.to, amount: payload.amount })
    ON SUCCESS:
      BEGIN (single $transaction)
        UPDATE payouts SET status='completed', tx_hash=$txHash WHERE id=$payout.id
        INSERT ledger_entries (debit=amount, credit=0, …)
        UPDATE accounts SET balance = balance - amount WHERE id=$accountId
        UPDATE outbox_messages SET status='done' WHERE id=$message.id
      COMMIT

    ON ERROR:
      attempts = message.attempts + 1
      IF attempts >= MAX_ATTEMPTS (3):
        payoutRepo.updatePayout(payout.id, 'needs_review')
        outboxRepo.markDone(message.id)
      ELSE:
        outboxRepo.recordAttempt(message.id, attempts, null, errorMsg)
        -- next_attempt_at stays NULL; message eligible on next tick
```

*What must NOT be in the creation transaction:* any call to the provider SDK, any async work.  
*What must NOT be in the confirmation transaction:* any network I/O.

### Payout state machine

```
created ──► processing ──► completed
                      ├──► failed
                      └──► needs_review   (retry exhaustion, no definitive outcome)

created is terminal-safe: a message delivered twice while status is still 'created'
simply re-sets it to 'processing' (idempotent). Once 'completed', redelivery is a no-op.
```

## 5. Tests

| Test | Proves |
|---|---|
| Two concurrent `POST /payouts` for the same account with amount > balance/2 → exactly one succeeds, the other gets 422 `insufficient_funds` | No overdraft under race |
| Two concurrent `POST /payouts` with the same `(accountId, idempotencyKey)` and identical body → both return 200 with the same payout id; only one row exists | Idempotent creation |
| `POST /payouts` with same key but different amount → 409 `idempotency_conflict` | Conflict detection |
| Worker picks up a pending message, provider succeeds → payout becomes `completed`, ledger entry posted, account balance decremented, message `done` | Happy-path end-to-end |
| Worker delivers the same message twice (simulate by calling `processMessages` twice after provider succeeds) → no double ledger entry, balance decremented only once | At-least-once safety |
| Provider throws 3× (transient) → payout becomes `needs_review`, message `done`, balance unchanged, no ledger entry | Retry exhaustion is safe |
| Provider throws once then succeeds → payout `completed`, correct balance | Transient retry works |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Prisma schema: accounts, payouts, outbox_messages, ledger_entries
src/payout/provider.interface.ts | reads: src/payout/payout.types.ts | Re-exports BlockchainProvider
src/payout/payout.types.ts | reads: - | PayoutStatus, OutboxStatus, DTOs, BlockchainProvider interface, error code consts
src/payout/payout.repository.ts | reads: src/payout/payout.types.ts | All Prisma access for payouts, accounts, ledger_entries
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts, src/payout/payout.types.ts | create() business logic + error mapping
src/payout/payout.controller.ts | reads: src/payout/payout.service.ts, src/payout/payout.types.ts | POST /payouts endpoint, input validation
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts | Module wiring for payout feature
src/outbox/outbox.repository.ts | reads: - | All Prisma access for outbox_messages
src/outbox/outbox.service.ts | reads: src/outbox/outbox.repository.ts, src/payout/payout.repository.ts, src/payout/payout.types.ts | Worker: claim, process, retry logic
src/outbox/outbox.module.ts | reads: src/outbox/outbox.service.ts, src/outbox/outbox.repository.ts, src/payout/payout.module.ts | Module wiring for outbox worker
src/app.module.ts | reads: src/payout/payout.module.ts, src/outbox/outbox.module.ts | Root module, imports both feature modules
src/main.ts | reads: src/app.module.ts | NestJS bootstrap
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/outbox/outbox.service.ts, src/outbox/outbox.repository.ts, src/payout/payout.types.ts | All tests from section 5
DESIGN.md | reads: - | Funds-safety explanation (10–20 lines)
-->
