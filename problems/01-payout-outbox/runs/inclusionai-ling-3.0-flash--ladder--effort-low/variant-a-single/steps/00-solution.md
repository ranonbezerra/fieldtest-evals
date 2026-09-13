# solution

## reasoning

```
Let me build the complete payout service solution. I need to deliver:

1. Prisma schema + migration
2. NestJS module: controller, service, worker
3. Tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion
4. DESIGN.md (10-20 lines)

Key requirements from both specs:
- Integer money (BigInt/minor units)
- Reserve (not debit) on creation, settle on confirmation
- Atomic check-and-reserve (conditional update, read rows changed)
- Message queue in same transaction as reservation
- Worker safe against redelivery (at-least-once)
- Idempotency key on creation
- Settlement only on provider confirmation
- Bounded retries; on exhaustion → terminal review state, reservation intact, nothing reversed
- Transactional outbox pattern

Let me design the schema:

**Account**: id, settledBalance (BigInt), reservedBalance (BigInt)
**Payout**: id, accountId, amount, destinationAddress, idempotencyKey, status (CREATED|PROCESSING|SENT|COMPLETED|FAILED|NEEDS_REVIEW), createdAt, processedAt, txHash, etc.
**Message** (queue): id, payoutId, status (PENDING|PROCESSED|FAILED), attempts, nextAttemptAt, payload
**Ledger**: id, accountId, amount (positive = credit, negative = debit), type (SETTLEMENT|HOLD|RELEASE), payoutId, createdAt

Wait, let me reconsider. The ledger is double-entry style. Let me keep it simple:
- Ledger entries record changes. Settled balance changes only on confirmation.

Let me think about the reservation flow:

1. POST /payouts:
   - Check idempotency key → if exists, return existing payout
   - Atomically: check available = settled - reserved >= amount, then reserve (increment reservedBalance), create payout (status CREATED), create message (PENDING) — all in one transaction
   - If reserve fails (0 rows affected), return error

2. Worker (polls messages):
   - Pick PENDING messages (with locking - SELECT FOR UPDATE SKIP LOCKED)
   - For each: update status to PROCESSING (conditional), process:
     - Call provider.transfer
     - On success: update payout to SENT, create ledger entry? No - settlement happens on confirmation.
     - Actually, "txHash in hand is not confirmation of settlement" - so SENT means we got txHash but haven't confirmed.
     - Retry on failure with bounded attempts
     - After exhaustion: NEEDS_REVIEW, reservation intact (don't release)
     - On confirmation (we need a way to confirm... maybe a separate endpoint or the worker polls the provider):
       - Update to COMPLETED, debit settledBalance, credit reservedBalance (release hold), create ledger entry

Wait, let me re-read: "The ledger entry that moves settled balance is written when the provider confirms." And "Settlement happens on confirmation, never on send."

So the flow is:
- CREATED: reserved, message queued
- PROCESSING: worker picked it up
- SENT: provider accepted (got txHash)
- COMPLETED: provider confirmed on-chain → settle (move from reserved to settled... actually debit settled)
- FAILED: provider definitively rejected
- NEEDS_REVIEW: retries exhausted, uncertain

Let me think about the ledger more carefully. "Double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."

So we have settledBalance and reservedBalance. When a payout completes:
- settledBalance decreases by amount (money left the account)
- reservedBalance decreases by amount (the hold is released)

Ledger entry for settlement: negative amount (debit) on the account when confirmed.

Let me think about what fields to include:

```prisma
model Account {
  id            String   @id @default(cuid())
  settledBalance BigInt  @default(0)
  reservedBalance BigInt @default(0)
  payouts       Payout[]
  ledgerEntries Ledger[]
  @@map("accounts")
}

model Payout {
  id                String        @id @default(cuid())
  accountId         String
  amount            BigInt
  destinationAddress String
  idempotencyKey    String        @unique
  status            PayoutStatus
  txHash            String?
  createdAt         DateTime      @default(now())
  processedAt       DateTime?
  completedAt       DateTime?
  account           Account       @relation(fields: [accountId], references: [id])
  messages          Message[]
  ledgerEntries     LedgerEntry[]
  retries           Int           @default(0)
  @@map("payouts")
}

model Message {
  id             String        @id @default(cuid())
  payoutId       String        @unique
  status         MessageStatus @default(PENDING)
  attempts       Int           @default(0)
  nextAttemptAt  DateTime
  payout         Payout        @relation(fields: [payoutId], references: [id])
  @@map("messages")
}

model LedgerEntry {
  id         String   @id @default(cuid())
  accountId  String
  amount     BigInt   // negative = debit, positive = credit
  type       LedgerType
  payoutId   String?
  createdAt  DateTime @default(now())
  account    Account  @relation(fields: [accountId], references: [id])
  payout     Payout?  @relation(fields: [payoutId], references: [id])
  @@map("ledger_entries")
}
```

Enums:
```prisma
enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MessageStatus {
  PENDING
  PROCESSED
  FAILED
}

enum LedgerType {
  SETTLEMENT
  HOLD
  RELEASE
}
```

Now let me think about the worker's processing flow more carefully:

When worker picks up a PENDING message:
1. Lock the message row (SELECT FOR UPDATE SKIP LOCKED)
2. Update status to PROCESSED (or keep track that we're processing it)
3. Update payout status to PROCESSING
4. Call provider.transfer({to, amount})
5. If success:
   - Update payout: status SENT, txHash, processedAt
   - Increment message attempts (it was already incremented)
   - Keep message as PROCESSED (it will be picked up again for status check)
   
Wait, actually the at-least-once delivery means the message gets redelivered. Let me reconsider.

The message represents "process this payout". When the worker processes it:
1. Pick PENDING message, lock it
2. Mark it as being processed (maybe status stays PENDING but we track processing, or we have a separate lock mechanism)
3. Try provider.transfer:
   - Success → payout.status = SENT, txHash set. Message.status = PROCESSED. Done for this message.
   - Transient failure → keep message PENDING (or set nextAttemptAt for future), increment attempts. If attempts >= MAX, set payout NEEDS_REVIEW, message FAILED.
   - Timeout/unknown → same as transient failure (bounded retries)

But wait - the message could be redelivered (at-least-once). If we already set it to PROCESSED but the process died before committing... but that's the transactional outbox - we update the message status in the same transaction. Actually, the issue is: the worker processes the message (calls external provider), and then needs to update the message status. But the provider call is NOT in the database transaction. So if the worker updates status to PROCESSED after the provider call succeeds, and then crashes before committing... the message will be redelivered.

Hmm, but that's actually fine because:
- When redelivered, payout is already SENT with txHash
- Worker should check payout status first: if SENT/COMPLETED, skip (idempotent handling)
- Then mark message as PROCESSED

So the redelivery safety comes from checking the payout state, not the message state alone.

Let me redesign the worker loop:
1. Poll: SELECT * FROM messages WHERE status = PENDING AND nextAttemptAt <= now() ORDER BY nextAttemptAt LIMIT N FOR UPDATE SKIP LOCKED
2. For each message:
   a. Try to update payout to PROCESSING (conditional: only if status is CREATED). If 0 rows affected, another worker is handling it → mark message PROCESSED and skip.
   b. Call provider.transfer({to, amount})
   c. On success: 
      - In a transaction: update payout (status=SENT, txHash, processedAt), mark message PROCESSED
   d. On transient failure:
      - In a transaction: increment attempts, set nextAttemptAt. If attempts >= MAX, set payout NEEDS_REVIEW, message FAILED
   e. On unknown/error:
      - Same as transient (bounded retries)
3. After processing all, wait N seconds, repeat

For the confirmation/settlement:
We need a way to confirm the transfer landed. Let me add a method that simulates checking provider status. In production this would be a provider API. Let me add:
- `confirmPayout(payoutId)` - checks with provider, and if confirmed, settles (updates settledBalance, releases reserved, creates ledger, updates payout to COMPLETED)

Actually, re-reading: "The ledger entry that moves settled balance is written when the provider confirms." Let me add a confirmation step. The worker could:
1. First call: send → SENT
2. Periodically check status of sent payouts → if confirmed → COMPLETED + settle

Let me make this a separate service method that can be called by the worker or another scheduled job.

Now let me code everything up.

For the concurrency test: two concurrent requests against one account with funds for exactly one payout. This needs to test the atomic reserve.

For duplicate delivery test: deliver same message twice → one transfer.

For retry exhaustion test: provider fails until max retries → NEEDS_REVIEW, reservation intact.

Let me think about the tests in detail:

**Concurrent creation test:**
- Set up account with 10000 (minor units, so 100.00 if display is 2 decimals)
- Fire two POST /payouts simultaneously with amount 6000 each
- Both see 10000 available, but only one should succeed in reserving
- Result: exactly one payout CREATED, one 409/conflict error
- reservedBalance should be 6000

**Duplicate delivery test:**
- Create a payout successfully
- Manually (or via test) call processMessages() twice with a message
- Should only call provider.transfer once
- Payout ends up COMPLETED (or SENT if provider mock returns success)

**Retry exhaustion test:**
- Create payout
- Mock provider to always fail
- Run processMessages() enough times
- After MAX_RETRIES, payout is NEEDS_REVIEW
- reservedBalance unchanged (still 6000 reserved)
- settledBalance unchanged

Now let me write all the code.

Actually let me think about the structure. I need:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts (or in service)
src/payout/payout.types.ts (enums/interfaces)
test/payout.spec.ts
DESIGN.md
```

Wait, let me think about where the worker lives. It could be a service method or a separate worker file. Let me put it in the payout service since it's core to the payout logic, or make it a separate worker class.

Let me create:
- `src/payout/payout.worker.ts` - the polling worker
- `src/payout/payout.service.ts` - API-facing operations + settlement
- `src/payout/payout.controller.ts` - REST controller
- `src/payout/payout.repository.ts` - DB access
- `src/payout/payout.module.ts` - module wiring

Let me start writing.

For the worker, I'll use a setInterval approach or a method that runs periodically. Let me make it a service with a method that can be called on an interval.

Actually, NestJS has `@nestjs/task` or we can use `@Cron` decorator, or just a simple interval. Let me use a simple approach with a `start()` method that sets up an interval.

Let me think about the provider. It's an external SDK. I'll create an injectable `ProviderService` that wraps `provider.transfer()`. For tests, we can mock it.

Let me also create a `ProviderService`:

```ts
// src/provider/provider.service.ts
@Injectable()
export class ProviderService {
  async transfer(to: string, amount: bigint): Promise<{ txHash: string }> {
    // ASSUMPTION: wraps external provider SDK
    return provider.transfer({ to, amount });
  }
}
```

Actually, let me keep it simpler and just inject the provider as a dependency. Let me create it as part of the payout module.

Let me now write everything out.

Key design decisions:
- Conditional update for reserve: `UPDATE accounts SET reserved_balance = reserved_balance + $1 WHERE id = $2 AND settled_balance - reserved_balance >= $1 RETURNING *` — check if affected rows > 0
- Message created in same transaction as reservation
- Worker uses SELECT FOR UPDATE SKIP LOCKED for message picking
- Idempotency: unique constraint on idempotencyKey, check before creating
- Redelivery: check payout status before processing (if SENT/COMPLETED, skip)
- Settlement: separate confirmation step
- Retry exhaustion: terminal NEEDS_REVIEW state, reservation left intact

Let me now write the full code.

For the message polling, I'll use `SELECT ... FOR UPDATE SKIP LOCKED` which PostgreSQL supports natively via Prisma's `$queryRaw`.

Actually Prisma supports raw queries. Let me use `$queryRaw` for the SELECT FOR UPDATE SKIP LOCKED since Prisma doesn't have a first-class API for locking.

Let me think about what's needed in the repository layer:

```ts
interface Repository {
  // Account
  getById(id: string): Promise<Account | null>
  reserveFunds(accountId: string, amount: bigint): Promise<{ success: boolean, account?: Account }>
  
  // Payout
  findByIdempotencyKey(key: string): Promise<Payout | null>
  create(data: CreatePayoutData): Promise<Payout>
  updateStatus(payoutId: string, status: PayoutStatus, ...): Promise<void>
  
  // Message
  createMessage(payoutId: string): Promise<Message>
  getPendingMessages(): Promise<Message[]>
  markProcessed(messageId: string): Promise<void>
  
  // Worker
  processMessages(): Promise<void>
  
  // Settlement
  confirmAndSettle(payoutId: string): Promise<void>
}
```

Actually, let me be more concrete. Let me write the actual code now.

I need to be careful with Prisma and BigInt. Prisma handles BigInt fields correctly in recent versions. The schema will use `BigInt` type.

Let me write it all out now.

For the `processMessages` method, this is the key worker. Let me think about the exact flow:

```ts
async processMessages(): Promise<void> {
  // 1. Get pending messages
  const messages = await this.getMessageQueue().findPending(); // SELECT ... FOR UPDATE SKIP LOCKED WHERE status = PENDING AND next_attempt_at <= now()
  
  for (const msg of messages) {
    try {
      // 2. Try to mark payout as PROCESSING (conditional on CREATED status)
      const payout = await this.tryStartProcessing(msg.payoutId);
      if (!payout) {
        // Already being processed elsewhere, mark this message as processed
        await this.markMessageProcessed(msg.id);
        continue;
      }
      
      // 3. Call provider
      const { txHash } = await this.provider.transfer(payout.destinationAddress, payout.amount);
      
      // 4. Update payout to SENT, message to PROCESSED (in transaction)
      await this.markSent(payout.id, txHash, msg.id);
      
    } catch (error) {
      // 5. Transient failure - check if max retries reached
      const attempts = msg.attempts + 1;
      if (attempts >= MAX_RETRIES) {
        // Terminal: NEEDS_REVIEW, reservation intact, message FAILED
        await this.markNeedsReviewAndFailed(msg.payoutId, msg.id);
      } else {
        // Schedule retry
        await this.scheduleRetry(msg.id, attempts);
      }
    }
  }
}
```

For the confirmation/settlement step, let me also add a method in the worker:

```ts
async checkAndSettle(): Promise<void> {
  const sentPayouts = await this.payoutRepo.findByStatus(PayoutStatus.SENT);
  for (const payout of sentPayouts) {
    try {
      const confirmed = await this.provider.confirm(payout.txHash!);
      if (confirmed) {
        await this.settle(payout.id);
      }
    } catch {
      // Will retry on next check
    }
  }
}
```

Wait, but the spec says provider is `provider.transfer({to, amount}) -> {txHash}`. It doesn't mention a confirm method. Let me make an assumption here.

`// ASSUMPTION: Provider has a `confirm(txHash)` method that returns boolean whether the transfer is confirmed on-chain. This is needed for the settlement step which occurs after send.`

Actually, let me re-read the requirements. "Asynchronous processing" — the transfer is executed asynchronously. "The provider can fail transiently" — bounded retries. 

I think the model is:
1. Send: provider.transfer() - returns txHash or throws
2. After send, we need to check if it actually landed (confirmed on-chain)
3. Settlement happens on confirmation

Let me add a provider that has both `transfer` and `confirm` methods. The worker will:
- Process messages → call transfer → on success, payout = SENT
- Also poll SENT payouts → call confirm → on confirmed, settle

Let me integrate both into the worker's processMessages() or have them as separate methods.

Actually, let me keep processMessages() as the main polling loop that handles both:
1. Process PENDING messages (send transfers)
2. Check SENT payouts for confirmation (settle)

Let me just write it all now.

Let me also think about the tests. I'll use Vitest with Prisma's `prisma.$executeRaw` for raw queries and test the actual behavior.

OK let me write this comprehensive solution now.

For the schema, I need to be careful:
- Tables mapped to snake_case via @@map
- Money as BigInt
- All proper relations

Let me also include migrations. The spec says "Every schema change ships with a migration." I'll include a migration file.

Now let me code:

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id               String        @id @default(cuid())
  settledBalance   BigInt        @default(0)
  reservedBalance  BigInt        @default(0)
  payouts          Payout[]
  ledgerEntries    LedgerEntry[]
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@map("accounts")
}

model Payout {
  id                 String        @id @default(cuid())
  accountId          String
  amount             BigInt
  destinationAddress String
  idempotencyKey     String        @unique
  status             PayoutStatus
  txHash             String?
  createdAt          DateTime      @default(now())
  processedAt        DateTime?
  completedAt        DateTime?
  account            Account       @relation(fields: [accountId], references: [id])
  messages           Message[]
  ledgerEntries      LedgerEntry[]
  retries            Int           @default(0)
  @@map("payouts")
}

model Message {
  id            String        @id @default(cuid())
  payoutId      String        @unique
  status        MessageStatus @default(PENDING)
  attempts      Int           @default(0)
  nextAttemptAt DateTime
  payout        Payout        @relation(fields: [payoutId], references: [id])
  @@map("messages")
}

model LedgerEntry {
  id        String     @id @default(cuid())
  accountId String
  amount    BigInt     // negative = debit, positive = credit
  type      LedgerType
  payoutId  String?
  createdAt DateTime   @default(now())
  account   Account    @relation(fields: [accountId], references: [id])
  payout    Payout?    @relation(fields: [payoutId], references: [id])
  @@map("ledger_entries")
}

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MessageStatus {
  PENDING
  PROCESSED
  FAILED
}

enum LedgerType {
  SETTLEMENT
  HOLD
  RELEASE
}
```

Now let me write all the source files. I'll make sure every layer is correct.

Let me think about the `tryStartProcessing` — this is the conditional update. In Prisma:

```ts
// Account update that only applies if funds available
const result = await prisma.$executeRaw`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}
  WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
`;
// Check affected rows: if 0, no reservation happened
```

But this doesn't return the updated row. For idempotency checks and getting the account, I'd need a separate query or a raw RETURNING.

Let me use:
```ts
const result = await prisma.$executeRaw<{ affectedRows: number }[]>`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}
  WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
`;
const affectedRows = result[0]?.affectedRows ?? 0;
if (affectedRows === 0) {
  return { success: false };
}
```

OK let me now write everything. This is going to be a lot of code. Let me be thorough.

Let me think about the test setup. I'll need:
- Test database (use a separate test DB URL)
- Prisma migrate deploy or just use the schema directly
- Mock provider for tests

Actually, in integration tests with Prisma, we can either:
1. Use `prisma migrate deploy` 
2. Use `prisma db push`
3. Or just reset the database and use the schema

Let me write the test to be practical. I'll use the actual Prisma client with transactions.

Let me now write all files systematically.

One more thing about the worker — I need to decide how often it runs. The spec says "processMessages() runs every N seconds". I'll make N configurable via environment variable or constant. Let me use a constant.

Let me also think about the confirmation polling. I'll add a second method `confirmPendingPayouts()` that checks SENT payouts with the provider's confirm method, and call it in the same interval or a separate one.

For simplicity, let me have `processMessages()` handle both:
1. Processing PENDING messages (sending transfers)
2. Confirming SENT payouts (settling)

Both within the same polling loop.

Let me also consider the message structure. The message represents a unit of work. When we process a message, we call the provider. On success, the message is PROCESSED. The payout is now SENT. We need another mechanism to settle.

Option A: Separate message for settlement confirmation
Option B: Poll SENT payouts in the worker

Let me go with Option B for simplicity — the worker also checks SENT payouts for confirmation.

Now, about the confirmation: we need a `provider.confirm(txHash)` method. Since the spec only mentions `provider.transfer`, I'll assume the provider also has a way to check status. Let me add a `ProviderService` with both methods.

Alright, let me write everything now. This is going to be comprehensive.

Actually, for the confirmation, maybe I should also have the provider throw a specific error type for confirmation. Let me keep it simple: provider has `transfer` and `confirmTransfer(txHash) -> boolean`.

Let me now structure all files:

1. `prisma/schema.prisma` - schema
2. `prisma/migrations/.../migration.sql` - migration
3. `src/main.ts` - bootstrap
4. `src/app.module.ts` - root module
5. `src/provider/provider.service.ts` - provider wrapper
6. `src/provider/provider.module.ts` - provider module
7. `src/payout/payout.types.ts` - types/enums (or keep in schema)
8. `src/payout/payout.repository.ts` - repository
9. `src/payout/payout.service.ts` - service
10. `src/payout/payout.worker.ts` - worker
11. `src/payout/payout.controller.ts` - controller
12. `src/payout/payout.module.ts` - module
13. `test/payout.spec.ts` - tests
14. `DESIGN.md` - design doc

Let me write it all out. I'll be thorough and complete.

Actually, I realize I should think carefully about what goes where given the constraints. The worker polling every N seconds — in a NestJS app, I could use a `@Cron` decorator, but let me keep it as a service method that's called by a timer in `onModuleInit` or exposed via the module.

Let me use an `onModuleInit` approach in the worker to start the interval.

OK, let me finalize my approach and write the code:

For the worker, I'll make it implement `OnModuleInit` and start a setInterval.

For the provider, I'll create an `Injectable` that wraps the SDK, with `transfer` and `confirmTransfer` methods, and it will be mockable in tests.

For tests, I'll use Vitest with a real Prisma client against a test database, mock the provider, and test the actual behaviors.

Let me also think about error codes. The error envelope requires:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Codes I'll use:
- `insufficient_funds` - when account doesn't have enough available
- `payout_not_found` - when looking up a non-existent payout
- `account_not_found` - when looking up a non-existent account
- `idempotency_conflict` - actually this isn't an error, we return the existing payout
- `duplicate_idempotency_key` - hmm, this shouldn't happen since we check first

Let me also create a global error filter (ExceptionFilter) to normalize errors.

Wait, the spec says controller validates input and calls service. Zero business logic. So the controller handles validation, and any errors thrown by the service get caught by a filter.

Let me create an `AppExceptionFilter` that normalizes errors.

OK let me write it all now. I'll be comprehensive but focused.

Let me think about the exact flow for creation one more time:

POST /payouts body: { accountId, amount, destinationAddress, idempotencyKey }

Service.createPayout():
1. Validate input (amount > 0, all fields present)
2. Check idempotency: find payout by idempotencyKey. If found, return it.
3. Find account. If not found, throw error.
4. Begin transaction:
   a. Atomically reserve funds (conditional UPDATE on accounts). Check affected rows = 1. If 0, abort (insufficient funds).
   b. Create payout (status = CREATED, with idempotencyKey).
   c. Create message (PENDING, nextAttemptAt = now(), payoutId = payout.id).
   d. Create ledger entry (HOLD type, amount = negative? No — the hold doesn't change settled balance. Let me think...)

Wait, the ledger. The spec says "double-entry-style ledger" and "The account's settled balance changes only when the provider confirms the transfer."

So a HOLD doesn't change settled balance, it just records that funds are held. But actually, the reservedBalance column already tracks this. Let me include ledger entries for:
- HOLD: records the reservation (doesn't change settled balance, but records the obligation)
- SETTLEMENT: when confirmed, debits settled balance (money leaves)
- RELEASE: when failed/cancelled, releases the hold (reserved goes back down... wait, no, reserved goes back to 0? Or... )

Actually, let me reconsider. The reservedBalance is a running total. When we reserve, we increase reservedBalance. When we settle, we decrease both settledBalance and reservedBalance (by the same amount). When we need review (no settlement), we leave reservedBalance as is.

But what about the RELEASE ledger entry? If a payout fails definitively (FAILED status), should we release the hold? The spec says: "Retry exhaustion → terminal review state, reservation intact, nothing reversed." So for NEEDS_REVIEW, we DON'T release. 

For FAILED (provider definitively rejected), what should we do? The spec doesn't explicitly say. Let me say FAILED means provider confirmed failure, so we should release the hold and create a RELEASE ledger entry.

Actually, let me look at the lifecycle: created → processing → sent → completed / failed / needs-review. 

- COMPLETED: settled (debit settled, release reserved)
- FAILED: provider definitively failed → release reserved (they're not going anywhere)
- NEEDS_REVIEW: uncertain → reservation intact

Hmm, but the spec says "Do not release the hold" for needs-review. For failed, it's reasonable to release since we know it failed.

Let me keep it simple:
- COMPLETED → settle: decrease settledBalance, decrease reservedBalance, ledger SETTLEMENT entry
- FAILED → release reserved (decrease reservedBalance), ledger RELEASE entry
- NEEDS_REVIEW → do nothing to balances, reservation intact

But wait, when do we create the HOLD ledger entry? On creation when we reserve. The HOLD entry just documents that X amount was held.

Hmm, but if the hold is tracked by reservedBalance, the ledger entry is purely informational. Let me include it anyway for the "double-entry-style" requirement.

Actually, let me reconsider the ledger. Double-entry means: every transaction has two sides (debit and credit). So:
- Reserve: Account reserved goes up by amount (credit reserved), but no corresponding debit. This is single-entry in a way. 

Let me think differently. The "account" in double-entry might be split into two sub-accounts: settled and reserved. So:
- Reserve: debit settled (hypothetical), credit reserved → net zero change to total balance
- Settlement: debit reserved, credit external (the blockchain) → settled goes down
- Release: credit reserved, debit... nothing (the funds were never actually sent)

I think for simplicity, I'll track ledger entries as:
- HOLD: records that X was reserved from an account (negative from settled perspective, positive to reserved)
- SETTLEMENT: money left the account (negative amount)
- RELEASE: hold was released (positive amount back to settled)

But the key constraint is: settledBalance only changes on SETTLEMENT. So HOLD and RELEASE entries are recorded but don't change settledBalance — they change reservedBalance.

Wait, actually, let me simplify. Let me track what the spec asks: "Keep a double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."

So the ledger records ALL balance movements. The constraint is that settledBalance changes only on confirmation. Reserved balance changes on reservation and release/settlement.

Let me define ledger entries:
- HOLD: amount is the amount reserved. Account's reserved balance increased. (recorded, settled unaffected)
- SETTLEMENT: amount is negative (money went out). Account's settled balance decreased. (on confirmation)
- RELEASE: amount is positive (hold released). Account's reserved balance decreased. (on failure/cancel)

And the service tracks settledBalance and reservedBalance directly, while ledger entries are an audit trail. The actual balance columns are the source of truth; ledger is written alongside changes.

OK, I think I've over-thought this. Let me just write the code:

When reserving (creation): 
- UPDATE accounts SET reserved_balance = reserved_balance + amount (conditional on available >= amount)
- Ledger entry: type HOLD, amount = -amount (represents deduction from available)

Wait, the sign convention is confusing. Let me say:
- Ledger amount is always relative to the account's perspective: negative = money out, positive = money back in.
- HOLD: amount = 0 (no settled change), but records the reservation. Actually, HOLD doesn't change any balance column. It's purely informational.
- Actually, let me just track: HOLD records the reservation with the amount held. SETTLEMENT records the actual debit. RELEASE records the return.

Let me make it concrete:
- On reserve: CREATE ledger {accountId, amount: 0, type: HOLD, payoutId} — just records the hold exists. reservedBalance updated separately.
- On settlement: CREATE ledger {accountId, amount: -payoutAmount, type: SETTLEMENT, payoutId} — money out. settledBalance -= amount.
- On release (fail): CREATE ledger {accountId, amount: payoutAmount, type: RELEASE, payoutId} — money back. reservedBalance -= amount.

Hmm, HOLD with amount 0 doesn't feel great. Let me say:
- HOLD: amount is the amount that was held (positive number). It represents a claim against available funds. The double entry is: reserved goes up, available (settled - reserved) goes down.
- The actual balance columns track this automatically via UPDATE queries.

I'll keep it simple in code and just make ledger entries for audit purposes.

OK enough deliberation, let me write code.

Let me also think about the test structure. I'll use Vitest with describe/it blocks. For each test:
- Create a fresh database state (truncate tables)
- Mock the provider as needed
- Run the scenario
- Assert on the outcome

I need a way to truncate the database between tests. I'll use `$executeRaw` to truncate with CASCADE.

Let me also consider: should I include the migration file? The spec says "Every schema change ships with a migration." But since this is a from-scratch implementation, the schema IS the migration. I'll include a migration file that matches the schema.

OK, let me now write all the files. I'll be very thorough.

For the message queue polling query:
```sql
SELECT * FROM messages 
WHERE status = 'PENDING' AND next_attempt_at <= NOW()
ORDER BY next_attempt_at
LIMIT 10
FOR UPDATE SKIP LOCKED
```

In Prisma: `$queryRaw`

Let me also create a `Config` service or just use environment variables/constants.

Let me define constants:
- MAX_RETRIES = 3 (bounded retries)
- POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000

Now let me write the actual code. Let me be careful with TypeScript types, especially BigInt.

Actually, let me think about one more thing: the `confirmTransfer` in provider. The spec only mentions `provider.transfer({to, amount}) -> {txHash}`. So I need to assume how confirmation works. 

`// ASSUMPTION: The provider also exposes confirmTransfer(txHash: string) => Promise<boolean>` which returns whether the transfer has been confirmed on-chain. This is needed for the settlement step which occurs after send.`

Let me start writing all files now:

---

Actually wait, let me reconsider the structure. I want to make sure I have:
1. A global exception filter for the error envelope format
2. Validation in the controller (input validation)
3. Clean separation

Let me also include an `AppExceptionFilter` that implements NestJS's `ExceptionFilter` interface.

And for the controller, validation can be done manually (since we need to validate BigInt etc.) or with class-validator. Let me keep it simple with manual validation in the controller (or a DTO with class-validator).

Let me use a simple DTO:

```ts
export class CreatePayoutDto {
  accountId: string;
  amount: bigint; // this won't validate well with class-validator since BigInt isn't well supported
  destinationAddress: string;
  idempotencyKey: string;
}
```

Actually, BigInt validation with class-validator is tricky. Let me just do manual validation in the controller: check that all fields are present, amount is a BigInt and > 0.

Let me write all files now. I'll aim for a complete, working solution.

One more thing: the test needs to verify "concurrent creation against one account". In Node.js (single-threaded), true concurrency isn't possible, but if the reservation uses a database-level conditional UPDATE, two sequential calls that overlap at the DB level will serialize. I can simulate concurrency by running two `createPayout` calls concurrently with `Promise.all` — since Node is single-threaded, they'll run until they hit the await for the DB transaction, at which point the DB will serialize them based on row locks.

Actually, the key is that the conditional UPDATE is atomic at the DB level. So even if two requests run "concurrently" in Node, the DB will handle them sequentially for the same row, and only one will succeed (the one that sees sufficient funds first). The second will see insufficient available funds after the first has reserved.

But there's a subtlety: I need to make sure the two transactions don't both read the same balance before either writes. With a conditional UPDATE like:

```sql
UPDATE accounts SET reserved_balance = reserved_balance + 6000
WHERE id = $1 AND (settled_balance - reserved_balance) >= 6000
```

This is atomic — the DB evaluates the condition at the time of the UPDATE. If two transactions run concurrently:
- T1: UPDATE succeeds (condition met), reserved goes from 0 to 6000, available now 4000-6000 = -2000... wait, if settled is 10000 and reserved is 0, available is 10000. After T1: reserved = 6000, available = 4000.
- T2: UPDATE checks: (10000 - 6000) >= 6000 → 4000 >= 6000 → false. UPDATE affects 0 rows. T2 fails.

Perfect. Exactly what we want.

Let me now write the full solution.

I need to be careful about one thing: the transaction that includes the conditional UPDATE, payout creation, and message creation. If I use Prisma's `$transaction`, all of these are in one transaction. Let me write that.

```ts
await prisma.$transaction(async (tx) => {
  // 1. Conditional reserve
  const result = await tx.$queryRaw<{ affectedRows: number }[]>`
    UPDATE accounts 
    SET reserved_balance = reserved_balance + ${amount}
    WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
  `;
  if (result[0]?.affectedRows === 0) {
    throw new InsufficientFundsError();
  }
  
  // 2. Create payout
  const payout = await tx.payout.create({ data: {...} });
  
  // 3. Create message
  await tx.message.create({ data: {...} });
});
```

This ensures all-or-nothing.

Alright, I'm now going to write every file. Let me be comprehensive and correct.

For the tests, I'll test against the actual service layer with mocked provider and a test database.

Let me also think about what helper functions I need. A `BigInt` validation function for the controller.

Let me now write:

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function main() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(3000);
}
main();
```

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { ProviderModule } from './provider/provider.module';

@Module({
  imports: [ProviderModule, PayoutModule],
})
export class AppModule {}
```

Now let me write all the payout files and provider files.

Here's my plan for the provider:

```ts
// src/provider/provider.service.ts
@Injectable()
export class ProviderService {
  async transfer(to: string, amount: bigint): Promise<{ txHash: string }> {
    // ASSUMPTION: wraps external blockchain provider SDK
    // provider.transfer({to, amount}) -> {txHash}
    // may throw, time out, or succeed slowly
    return provider.transfer({ to, amount });
  }
  
  async confirmTransfer(txHash: string): Promise<boolean> {
    // ASSUMPTION: provider has a confirm method
    return provider.confirm(txHash);
  }
}
```

For tests, I'll mock this service.

OK let me just write it all now. I've thought enough.

Actually one more thing about the worker. The spec says "processMessages() runs every N seconds". Let me implement this as a worker service that starts a timer when the module initializes:

```ts
// src/payout/payout.worker.ts
@Injectable()
export class PayoutWorker implements OnModuleInit {
  private intervalId?: NodeJS.Timeout;
  
  constructor(private readonly payoutService: PayoutService) {}
  
  onModuleInit() {
    this.intervalId = setInterval(() => {
      this.payoutService.processMessages().catch(console.error);
    }, Number(process.env.POLL_INTERVAL_MS) || 5000);
  }
  
  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
```

In tests, I'll manually call `processMessages()` instead of waiting for the interval.

Let me finalize everything now and write the complete code.

Here's my comprehensive plan:

Files to produce:
1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_initial/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/provider/provider.service.ts`
6. `src/provider/provider.module.ts`
7. `src/payout/payout.types.ts` (error classes + constants)
8. `src/payout/payout.controller.ts`
9. `src/payout/payout.service.ts`
10. `src/payout/payout.repository.ts`
11. `src/payout/payout.worker.ts`
12. `src/payout/payout.module.ts`
13. `test/payout.spec.ts`
14. `DESIGN.md`

Plus potentially:
15. `src/common/filters/exception.filter.ts` (global error filter)

Let me write them all now.

Let me think carefully about the repository methods. The repository is the ONLY layer that touches the database. So all Prisma calls go through it.

```ts
// src/payout/payout.repository.ts
@Injectable()
export class PayoutRepository {
  constructor(private prisma: PrismaService) {}
  
  // Account
  async findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }
  
  async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
    const result = await this.prisma.$executeRaw`
      UPDATE accounts 
      SET reserved_balance = reserved_balance + ${amount}
      WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
    `;
    // Check affected rows - ASSUMPTION: Prisma $executeRaw returns row count in a known format
    // For postgresql via node-postgres, it returns command tags. Let me handle this carefully.
    // Actually, $executeRaw returns the result of the query execution. For UPDATE, it returns
    // an array with affected row count information.
    // Let me use $executeRaw and check the row count.
    return this.checkAffectedRows(result) > 0;
  }
  
  // ... more methods
}
```

Hmm, the affected rows check with `$executeRaw` in Prisma is a bit tricky. Let me use `$queryRaw` with RETURNING:

```ts
async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
  const rows = await this.prisma.$queryRaw<{ id: string }[]>`
    UPDATE accounts 
    SET reserved_balance = reserved_balance + ${amount}
    WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
    RETURNING id
  `;
  return rows.length > 0;
}
```

This is cleaner — we get the affected rows via RETURNING and check if any were returned.

Let me also check: does Prisma's `$queryRaw` support UPDATE ... RETURNING? Yes, Prisma 4.x+ supports this via `$queryRaw`. And since we're using PostgreSQL, it natively supports RETURNING.

OK let me write everything now for real.

Let me think about the PrismaService:

```ts
// src/provider/prisma.service.ts or src/common/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super();
  }
}
```

This is standard NestJS setup. I'll include it.

Actually, let me include it in the provider module or a common module.

Let me also add `@nestjs/prisma` — no, let me keep it simple with just `PrismaClient` extended.

OK, final code writing now. Let me produce all files in order.

I realize I should also think about how tests set up Prisma. In the test:

```ts
beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  // Reset DB
  await prisma.$executeRaw`TRUNCATE accounts CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

And for mocking the provider:

```ts
const providerMock = {
  transfer: vi.fn(),
  confirmTransfer: vi.fn(),
};
```

And I'll use NestJS's module testing utility:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [PayoutModule, ProviderModule],
  providers: [
    { provide: ProviderService, useValue: providerMock },
    PrismaService,
  ],
}).compile();
```

Let me write it all. Here we go:

Actually, I realize I need to be very careful about one thing: Prisma's BigInt handling. In recent Prisma versions, BigInt fields are returned as `bigint` in TypeScript if you configure `rejectOnMissing` and use the right Prisma version. But in some configurations, they come back as `string`. Let me add the ` Prisma.Config` for bigInt:

Actually, in Prisma Client with PostgreSQL, BigInt columns return BigInt values if the Prisma Client is configured for it. As of Prisma 4.5+, it returns `bigint` natively. Let me just assume that works.

Also, for the `provider.transfer` mock in tests, I need it to accept `bigint` for amount.

Let me now write the complete code. I'll be comprehensive.

One more thing: for the `payout.worker.ts`, it should be registered in the module's providers. Let me make sure.

And I should include the `PrismaService` in a module that's imported by the payout module.

Let me structure modules:
- `CommonModule` (PrismaService)
- `ProviderModule` (ProviderService)
- `PayoutModule` (PayoutModule imports CommonModule and ProviderModule)

OK now I'll write the code.

Let me carefully count my deliverables:
✓ Prisma schema + migration
✓ NestJS module: controller, service, worker
✓ Tests for concurrent creation, duplicate delivery, retry exhaustion
✓ DESIGN.md

Let me produce it all now.

One last consideration on the error codes per the envelope:
- `insufficient_funds` for when a payout can't be created due to lack of available balance
- `account_not_found` for when account doesn't exist
- `payout_not_found` for when a payout doesn't exist

All with the format: `{ "error": { "code": "...", "message": "...", "details": {} } }`

Now let me write.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id              String        @id @default(cuid())
  settledBalance  BigInt        @default(0)
  reservedBalance BigInt        @default(0)
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  @@map("accounts")
}

model Payout {
  id                 String        @id @default(cuid())
  accountId          String
  amount             BigInt
  destinationAddress String
  idempotencyKey     String        @unique
  status             PayoutStatus
  txHash             String?
  createdAt          DateTime      @default(now())
  processedAt        DateTime?
  completedAt        DateTime?
  retries            Int           @default(0)
  account            Account       @relation(fields: [accountId], references: [id])
  messages           Message[]
  ledgerEntries      LedgerEntry[]
  @@map("payouts")
}

model Message {
  id            String        @id @default(cuid())
  payoutId      String        @unique
  status        MessageStatus @default(PENDING)
  attempts      Int           @default(0)
  nextAttemptAt DateTime
  payout        Payout        @relation(fields: [payoutId], references: [id])
  @@map("messages")
}

model LedgerEntry {
  id        String     @id @default(cuid())
  accountId String
  amount    BigInt
  type      LedgerType
  payoutId  String?
  createdAt DateTime   @default(now())
  account   Account    @relation(fields: [accountId], references: [id])
  payout    Payout?    @relation(fields: [payoutId], references: [id])
  @@map("ledger_entries")
}

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MessageStatus {
  PENDING
  PROCESSED
  FAILED
}

enum LedgerType {
  HOLD
  SETTLEMENT
  RELEASE
}
```

### prisma/migrations/20240101000000_initial/migration.sql
```sql
CREATE TABLE IF NOT EXISTS "accounts" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "settled_balance" BIGINT NOT NULL DEFAULT 0,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "payouts" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" VARCHAR(24) NOT NULL REFERENCES "accounts"("id"),
    "amount" BIGINT NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL UNIQUE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    "tx_hash" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "processed_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "retries" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "messages" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "payout_id" VARCHAR(24) NOT NULL UNIQUE REFERENCES "payouts"("id"),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" VARCHAR(24) PRIMARY KEY DEFAULT gen_random_uuid(),
    "account_id" VARCHAR(24) NOT NULL REFERENCES "accounts"("id"),
    "amount" BIGINT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "payout_id" VARCHAR(24) REFERENCES "payouts"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### src/common/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/common/filters/exception.filter.ts
```ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const envelope = this.toEnvelope(exception);
    response.status(envelope.status).json(envelope.payload);
  }

  private toEnvelope(exception: unknown): { status: number; payload: ErrorEnvelope } {
    if (exception instanceof KnownError) {
      return {
        status: exception.status,
        payload: {
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details ?? {},
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : (res as Record<string, unknown>).message ?? 'bad_request';
      return {
        status: exception.getStatus(),
        payload: {
          error: {
            code: 'bad_request',
            message: String(message),
            details: {},
          },
        },
      };
    }

    return {
      status: 500,
      payload: {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          details: {},
        },
      },
    };
  }
}

export class KnownError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.message = message;
    this.status = status;
    this.details = details;
  }
}
```

### src/common/common.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class CommonModule {}
```

### src/provider/provider.service.ts
```ts
import { Injectable } from '@nestjs/common';

/**
 * Wraps the external blockchain provider SDK.
 * provider.transfer({to, amount}) -> {txHash}
 * ASSUMPTION: The provider also exposes confirmTransfer(txHash: string) => Promise<boolean>
 * to check whether a previously sent transfer has landed on-chain.
 */
@Injectable()
export class ProviderService {
  async transfer(to: string, amount: bigint): Promise<{ txHash: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { provider } = require('external-provider-sdk'); // eslint-disable-line
    return provider.transfer({ to, amount });
  }

  async confirmTransfer(txHash: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { provider } = require('external-provider-sdk'); // eslint-disable-line
    return provider.confirm(txHash);
  }
}
```

### src/provider/provider.module.ts
```ts
import { Module } from '@nestjs/common';
import { ProviderService } from './provider.service';

@Module({
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
```

### src/payout/payout.types.ts
```ts
export enum PayoutStatus {
  CREATED = 'CREATED',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

export enum MessageStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

export enum LedgerType {
  HOLD = 'HOLD',
  SETTLEMENT = 'SETTLEMENT',
  RELEASE = 'RELEASE',
}

export const MAX_RETRIES = 3;
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5000;

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  MAX_RETRIES,
} from './payout.types';
import type { Payout, Message, Account, LedgerEntry } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Account ---

  async findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  /**
   * Atomic reserve: increments reserved_balance iff (settled - reserved) >= amount.
   * Uses a single conditional UPDATE. Returns true only if the row was actually updated.
   */
  async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE accounts
      SET reserved_balance = reserved_balance + ${amount}
      WHERE id = ${accountId}
        AND (settled_balance - reserved_balance) >= ${amount}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async updateAccountBalances(
    accountId: string,
    settledDelta: bigint,
    reservedDelta: bigint,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE accounts
      SET settled_balance = settled_balance + ${settledDelta},
          reserved_balance = reserved_balance + ${reservedDelta}
      WHERE id = ${accountId}
    `;
  }

  // --- Payout ---

  async findByIdempotencyKey(key: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }

  async createPayout(data: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<Payout> {
    return this.prisma.payout.create({
      data: {
        ...data,
        status: PayoutStatus.CREATED,
      },
    });
  }

  async updatePayoutStatus(
    payoutId: string,
    status: PayoutStatus,
  ): Promise<Payout | null> {
    return this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { status },
    }).then((r) => (r.count > 0 ? this.prisma.payout.findUnique({ where: { id: payoutId } }) : null));
  }

  async findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async incrementPayoutRetries(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { retries: { increment: 1 } },
    });
  }

  async findPayoutsByStatus(status: PayoutStatus): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { status } });
  }

  // --- Message queue ---

  async createMessage(payoutId: string): Promise<Message> {
    return this.prisma.message.create({
      data: {
        payoutId,
        status: MessageStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * SELECT ... FOR UPDATE SKIP LOCKED — PostgreSQL-locked row claim.
   * Returns pending messages whose retry window has opened.
   */
  async claimPendingMessages(): Promise<Message[]> {
    return this.prisma.$queryRaw<Message[]>`
      SELECT m.* FROM messages m
      JOIN payouts p ON p.id = m.payoutId
      WHERE m.status = ${MessageStatus.PENDING}
        AND m.next_attempt_at <= NOW()
        AND p.status = ${PayoutStatus.CREATED}
      ORDER BY m.next_attempt_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markMessageFailed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED },
    });
  }

  async scheduleRetry(messageId: string, attempts: number): Promise<void> {
    const backoffMs = Math.min(2 ** attempts * 1000, 30000);
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs),
      },
    });
  }

  // --- Ledger ---

  async createLedgerEntry(data: {
    accountId: string;
    amount: bigint;
    type: LedgerType;
    payoutId?: string;
  }): Promise<LedgerEntry> {
    return this.prisma.ledgerEntry.create({
      data: {
        ...data,
      },
    });
  }

  // --- Payout status transitions for idempotent worker handling ---

  /**
   * Conditionally transition payout CREATED → PROCESSING.
   * Returns the payout if the transition happened (caller won the race), null otherwise.
   */
  async tryStartProcessing(payoutId: string): Promise<Payout | null> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE payouts
      SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
      WHERE id = ${payoutId} AND status = ${PayoutStatus.CREATED}
      RETURNING id
    `;
    if (result.length === 0) return null;
    return this.prisma.payout.findUnique({ where: { id: payoutId } });
  }

  /**
   * Mark payout as SENT with txHash inside a transaction.
   */
  async markSent(
    tx: Parameters<PrismaService['$transaction']>[0],
    payoutId: string,
    txHash: string,
    messageId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE payouts
      SET status = ${PayoutStatus.SENT}, tx_hash = ${txHash}, processed_at = NOW()
      WHERE id = ${payoutId}
    `;
    await tx.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markNeedsReview(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { status: PayoutStatus.NEEDS_REVIEW },
    });
  }

  async settlePayout(
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Debit settled balance, release reserved hold
      await tx.updateAccountBalances(accountId, -amount, -amount);

      // Ledger entry: money out on confirmation
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: -amount,
          type: LedgerType.SETTLEMENT,
          payoutId,
        },
      });

      await tx.payout.updateMany({
        where: { id: payoutId },
        data: { status: PayoutStatus.COMPLETED, completedAt: new Date() },
      });
    });
  }

  async failPayout(
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Release the hold: reserved goes back down
      await tx.updateAccountBalances(accountId, 0, -amount);

      // Ledger entry: hold released
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: amount,
          type: LedgerType.RELEASE,
          payoutId,
        },
      });

      await tx.payout.updateMany({
        where: { id: payoutId },
        data: { status: PayoutStatus.FAILED },
      });
    });
  }

  async resetDatabase(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE accounts, ledger_entries, payouts, messages CASCADE`;
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PayoutRepository } from './payout.repository';
import { ProviderService } from '../provider/provider.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  CreatePayoutInput,
  MAX_RETRIES,
  POLL_INTERVAL_MS,
} from './payout.types';
import { KnownError } from '../common/filters/exception.filter';
import type { Payout } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  /**
   * POST /payouts — create a payout if the account has sufficient available funds.
   * Idempotent on idempotencyKey. Reserve + payout creation + message queue
   * all happen in one transaction.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = input;

    // Validate input
    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new KnownError('invalid_amount', 'Amount must be a positive integer', 400);
    }
    if (!accountId || !destinationAddress || !idempotencyKey) {
      throw new KnownError('invalid_input', 'All fields are required', 400);
    }

    // Idempotency: return existing payout if key was already seen
    const existing = await this.payoutRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    // Check account exists
    const account = await this.payoutRepo.findAccount(accountId);
    if (!account) {
      throw new KnownError('account_not_found', 'Account not found', 404);
    }

    // Single transaction: reserve funds → create payout → queue message
    const payout = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional reserve — only one concurrent caller can win per account
      const reserved = await this.payoutRepo.reserveFundsAtomic(accountId, amount);
      if (!reserved) {
        throw new KnownError('insufficient_funds', 'Insufficient available funds', 409);
      }

      // Create payout (status = CREATED, no money moved from settled balance)
      const created = await tx.payout.create({
        data: {
          accountId,
          amount,
          destinationAddress,
          idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      // Queue message in the same transaction — no orphaned reservation
      await tx.message.create({
        data: {
          payoutId: created.id,
          status: MessageStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      });

      // Ledger entry: HOLD documents the obligation without changing settled balance
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: 0n,
          type: LedgerType.HOLD,
          payoutId: created.id,
        },
      });

      return created;
    });

    return payout;
  }

  /**
   * Polling worker — processes pending messages and checks SENT payouts for confirmation.
   * Safe against redelivery via conditional status transitions.
   */
  async processMessages(): Promise<void> {
    // 1. Process pending messages (send transfers)
    const messages = await this.payoutRepo.claimPendingMessages();

    for (const msg of messages) {
      await this.processSingleMessage(msg);
    }

    // 2. Check SENT payouts for on-chain confirmation
    const sentPayouts = await this.payoutRepo.findPayoutsByStatus(PayoutStatus.SENT);
    for (const payout of sentPayouts) {
      await this.attemptSettle(payout);
    }
  }

  /**
   * Process a single message: call provider, handle success/failure with bounded retries.
   */
  private async processSingleMessage(msg: {
    id: string;
    payoutId: string;
    attempts: number;
  }): Promise<void> {
    // Conditional transition CREATED → PROCESSING
    // If this returns null, another worker already grabbed it — this is a duplicate delivery
    const payout = await this.payoutRepo.tryStartProcessing(msg.payoutId);
    if (!payout) {
      // Another worker is already processing this payout — mark this message done
      await this.payoutRepo.markMessageProcessed(msg.id);
      return;
    }

    try {
      // Call external provider — NOT inside DB transaction
      const { txHash } = await this.provider.transfer(
        payout.destinationAddress,
        payout.amount,
      );

      // On success: mark payout SENT and message PROCESSED in a transaction
      await this.prisma.$transaction(async (tx) => {
        await this.payoutRepo.markSent(tx, payout.id, txHash, msg.id);
      });
    } catch {
      // Transient failure (throw, timeout, or slow)
      const attempts = msg.attempts + 1;

      if (attempts >= MAX_RETRIES) {
        // Retry exhausted — move to terminal review state, reservation stays intact
        await this.payoutRepo.markNeedsReview(payout.id);
        await this.payoutRepo.markMessageFailed(msg.id);
        // Do NOT reverse the reservation: the provider may have already settled.
      } else {
        // Schedule a retry with exponential backoff
        await this.payoutRepo.scheduleRetry(msg.id, attempts);
      }
    }
  }

  /**
   * Attempt to confirm a SENT payout and settle if confirmed.
   */
  private async attemptSettle(payout: {
    id: string;
    accountId: string;
    amount: bigint;
    txHash?: string | null;
  }): Promise<void> {
    if (!payout.txHash) return;

    try {
      const confirmed = await this.provider.confirmTransfer(payout.txHash);
      if (confirmed) {
        await this.payoutRepo.settlePayout(payout.id, payout.accountId, payout.amount);
      }
    } catch {
      // Provider confirm call failed — leave as SENT, will retry on next poll
    }
  }
}
```

Wait, I have an issue — `reserveFundsAtomic` doesn't exist in the repository. Let me fix the repository to add it. Actually, I used `reserveFunds` which already does the conditional update. Let me reconcile — I'll rename or add an alias.

Let me add `reserveFundsAtomic` as an alias or replace the call. Let me update the repository.

Actually let me just fix it: in the repository I already have `reserveFunds` that does the conditional UPDATE with RETURNING. Let me change the service to call `reserveFunds` instead.

Wait, but `reserveFunds` is called INSIDE the transaction in the service. The problem is that `reserveFunds` uses `this.prisma.$queryRaw` which doesn't know about the transaction context. I need a version that accepts a transaction client.

Let me fix the repository to handle both cases.

### src/payout/payout.repository.ts (corrected)
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  MAX_RETRIES,
} from './payout.types';
import type { Payout, Message, Account, LedgerEntry, PrismaClient } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Account ---

  async findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  /**
   * Atomic reserve inside a transaction.
   * Increments reserved_balance iff (settled - reserved) >= amount.
   * Returns true only if the row was actually updated (the caller "won" the race).
   */
  async reserveFundsInTx(
    tx: Parameters<PrismaService['$transaction']>[0],
    accountId: string,
    amount: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE accounts
      SET reserved_balance = reserved_balance + ${amount}
      WHERE id = ${accountId}
        AND (settled_balance - reserved_balance) >= ${amount}
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Standalone reserve (not in a transaction — only used where appropriate).
   */
  async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE accounts
      SET reserved_balance = reserved_balance + ${amount}
      WHERE id = ${accountId}
        AND (settled_balance - reserved_balance) >= ${amount}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async updateAccountBalances(
    tx: Parameters<PrismaService['$transaction']>[0],
    accountId: string,
    settledDelta: bigint,
    reservedDelta: bigint,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE accounts
      SET settled_balance = settled_balance + ${settledDelta},
          reserved_balance = reserved_balance + ${reservedDelta}
      WHERE id = ${accountId}
    `;
  }

  // --- Payout ---

  async findByIdempotencyKey(key: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }

  async createPayout(data: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<Payout> {
    return this.prisma.payout.create({
      data: {
        ...data,
        status: PayoutStatus.CREATED,
      },
    });
  }

  async findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async findPayoutsByStatus(status: PayoutStatus): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { status } });
  }

  async incrementPayoutRetries(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { retries: { increment: 1 } },
    });
  }

  // --- Message queue ---

  async createMessage(payoutId: string): Promise<Message> {
    return this.prisma.message.create({
      data: {
        payoutId,
        status: MessageStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * SELECT ... FOR UPDATE SKIP LOCKED — PostgreSQL row claim.
   */
  async claimPendingMessages(): Promise<Message[]> {
    return this.prisma.$queryRaw<Message[]>`
      SELECT m.* FROM messages m
      JOIN payouts p ON p.id = m.payoutId
      WHERE m.status = ${MessageStatus.PENDING}
        AND m.next_attempt_at <= NOW()
        AND p.status = ${PayoutStatus.CREATED}
      ORDER BY m.next_attempt_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markMessageFailed(messageId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED },
    });
  }

  async scheduleRetry(messageId: string, attempts: number): Promise<void> {
    const backoffMs = Math.min(2 ** attempts * 1000, 30000);
    await this.prisma.message.updateMany({
      where: { id: messageId },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs),
      },
    });
  }

  // --- Ledger ---

  async createLedgerEntryInTx(
    tx: Parameters<PrismaService['$transaction']>[0],
    data: {
      accountId: string;
      amount: bigint;
      type: LedgerType;
      payoutId?: string;
    },
  ): Promise<LedgerEntry> {
    return tx.ledgerEntry.create({ data });
  }

  // --- Payout status transitions ---

  /**
   * Conditional CREATED → PROCESSING. Returns payout if transition happened, null otherwise.
   */
  async tryStartProcessing(payoutId: string): Promise<Payout | null> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE payouts
      SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
      WHERE id = ${payoutId} AND status = ${PayoutStatus.CREATED}
      RETURNING id
    `;
    if (result.length === 0) return null;
    return this.prisma.payout.findUnique({ where: { id: payoutId } });
  }

  async markSent(
    tx: Parameters<PrismaService['$transaction']>[0],
    payoutId: string,
    txHash: string,
    messageId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE payouts
      SET status = ${PayoutStatus.SENT}, tx_hash = ${txHash}, processed_at = NOW()
      WHERE id = ${payoutId}
    `;
    await tx.message.updateMany({
      where: { id: messageId },
      data: { status: MessageStatus.PROCESSED },
    });
  }

  async markNeedsReview(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId },
      data: { status: PayoutStatus.NEEDS_REVIEW },
    });
  }

  async settlePayout(
    tx: Parameters<PrismaService['$transaction']>[0],
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await tx.updateAccountBalances(accountId, -amount, -amount);

    await tx.ledgerEntry.create({
      data: {
        accountId,
        amount: -amount,
        type: LedgerType.SETTLEMENT,
        payoutId,
      },
    });

    await tx.payout.updateMany({
      where: { id: payoutId },
      data: { status: PayoutStatus.COMPLETED, completedAt: new Date() },
    });
  }

  async failPayout(
    tx: Parameters<PrismaService['$transaction']>[0],
    payoutId: string,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await tx.updateAccountBalances(accountId, 0, -amount);

    await tx.ledgerEntry.create({
      data: {
        accountId,
        amount: amount,
        type: LedgerType.RELEASE,
        payoutId,
      },
    });

    await tx.payout.updateMany({
      where: { id: payoutId },
      data: { status: PayoutStatus.FAILED },
    });
  }

  async resetDatabase(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE accounts, ledger_entries, payouts, messages CASCADE`;
  }
}
```

### src/payout/payout.service.ts (corrected)
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PayoutRepository } from './payout.repository';
import { ProviderService } from '../provider/provider.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  CreatePayoutInput,
  MAX_RETRIES,
} from './payout.types';
import { KnownError } from '../common/filters/exception.filter';
import type { Payout } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  /**
   * POST /payouts — create a payout if the account has sufficient available funds.
   * Idempotent on idempotencyKey. Reserve, payout creation, and message queue
   * all happen in one transaction.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = input;

    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new KnownError('invalid_amount', 'Amount must be a positive integer', 400);
    }
    if (!accountId || !destinationAddress || !idempotencyKey) {
      throw new KnownError('invalid_input', 'All fields are required', 400);
    }

    // Idempotency: return existing payout if key was already seen
    const existing = await this.payoutRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const account = await this.payoutRepo.findAccount(accountId);
    if (!account) {
      throw new KnownError('account_not_found', 'Account not found', 404);
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional reserve — only one concurrent caller wins per account
      const reserved = await this.payoutRepo.reserveFundsInTx(tx, accountId, amount);
      if (!reserved) {
        throw new KnownError('insufficient_funds', 'Insufficient available funds', 409);
      }

      const created = await tx.payout.create({
        data: {
          accountId,
          amount,
          destinationAddress,
          idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      await tx.message.create({
        data: {
          payoutId: created.id,
          status: MessageStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: 0n,
          type: LedgerType.HOLD,
          payoutId: created.id,
        },
      });

      return created;
    });

    return payout;
  }

  /**
   * Polling worker — processes pending messages and confirms SENT payouts.
   */
  async processMessages(): Promise<void> {
    const messages = await this.payoutRepo.claimPendingMessages();

    for (const msg of messages) {
      await this.processSingleMessage(msg);
    }

    const sentPayouts = await this.payoutRepo.findPayoutsByStatus(PayoutStatus.SENT);
    for (const payout of sentPayouts) {
      await this.attemptSettle(payout);
    }
  }

  private async processSingleMessage(msg: {
    id: string;
    payoutId: string;
    attempts: number;
  }): Promise<void> {
    const payout = await this.payoutRepo.tryStartProcessing(msg.payoutId);
    if (!payout) {
      await this.payoutRepo.markMessageProcessed(msg.id);
      return;
    }

    try {
      const { txHash } = await this.provider.transfer(
        payout.destinationAddress,
        payout.amount,
      );

      await this.prisma.$transaction(async (tx) => {
        await this.payoutRepo.markSent(tx, payout.id, txHash, msg.id);
      });
    } catch {
      const attempts = msg.attempts + 1;

      if (attempts >= MAX_RETRIES) {
        await this.prisma.$transaction(async (tx) => {
          await this.payoutRepo.markNeedsReview(payout.id);
          await this.payoutRepo.markMessageFailed(msg.id);
        });
        // Safe direction: reservation stays intact. The provider may have already
        // settled the chain; reverting could double-pay. A human will review.
      } else {
        await this.payoutRepo.scheduleRetry(msg.id, attempts);
      }
    }
  }

  private async attemptSettle(payout: {
    id: string;
    accountId: string;
    amount: bigint;
    txHash?: string | null;
  }): Promise<void> {
    if (!payout.txHash) return;

    try {
      const confirmed = await this.provider.confirmTransfer(payout.txHash);
      if (confirmed) {
        await this.prisma.$transaction(async (tx) => {
          await this.payoutRepo.settlePayout(tx, payout.id, payout.accountId, payout.amount);
        });
      }
    } catch {
      // Provider unreachable — leave as SENT, retry next poll cycle
    }
  }
}
```

### src/payout/payout.worker.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { POLL_INTERVAL_MS } from './payout.types';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private intervalId?: NodeJS.Timeout;

  constructor(private readonly payoutService: PayoutService) {}

  onModuleInit(): void {
    this.intervalId = setInterval(() => {
      this.payoutService.processMessages().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Worker error:', err);
      });
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutInput } from './payout.types';
import { KnownError } from '../common/filters/exception.filter';
import type { Payout } from '@prisma/client';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(201)
  async createPayout(@Body() body: unknown): Promise<Payout> {
    const input = this.validateAndExtract(body);
    return this.payoutService.createPayout(input);
  }

  private validateAndExtract(body: unknown): CreatePayoutInput {
    if (body === null || body === undefined || typeof body !== 'object') {
      throw new KnownError('invalid_input', 'Request body must be a JSON object', 400);
    }

    const b = body as Record<string, unknown>;

    const accountId = b.accountId;
    const amount = b.amount;
    const destinationAddress = b.destinationAddress;
    const idempotencyKey = b.idempotencyKey;

    if (typeof accountId !== 'string' || !accountId) {
      throw new KnownError('invalid_input', 'accountId is required', 400);
    }
    if (typeof destinationAddress !== 'string' || !destinationAddress) {
      throw new KnownError('invalid_input', 'destinationAddress is required', 400);
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
      throw new KnownError('invalid_input', 'idempotencyKey is required', 400);
    }
    if (typeof amount === 'number' && Number.isInteger(amount) && amount > 0) {
      // Accept number that is a safe integer, coerce to bigint
      return {
        accountId,
        amount: BigInt(amount),
        destinationAddress,
        idempotencyKey,
      };
    }
    if (typeof amount === 'bigint' && amount > 0n) {
      return { accountId, amount, destinationAddress, idempotencyKey };
    }
    throw new KnownError('invalid_amount', 'amount must be a positive integer (bigint in minor units)', 400);
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ProviderModule } from '../provider/provider.module';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';

@Module({
  imports: [CommonModule, ProviderModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutModule } from '../src/payout/payout.module';
import { ProviderModule } from '../src/provider/provider.module';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PrismaService } from '../src/common/prisma.service';
import { ProviderService } from '../src/provider/provider.service';
import { KnownError } from '../src/common/filters/exception.filter';
import { PayoutStatus, MessageStatus, LedgerType } from '../src/payout/payout.types';

vi.mock('external-provider-sdk', () => ({
  provider: {
    transfer: vi.fn(),
    confirm: vi.fn(),
  },
}));

describe('PayoutService', () => {
  let payoutService: PayoutService;
  let payoutRepo: PayoutRepository;
  let prisma: PrismaService;
  let providerMock: ReturnType<typeof vi.fn>[];

  const ACCOUNT_ID = 'acc-test-1';
  const LARGE_AMOUNT = 100000000n; // 1,000,000 in minor units

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PayoutModule, ProviderModule],
      providers: [
        {
          provide: ProviderService,
          useValue: {
            transfer: vi.fn(),
            confirmTransfer: vi.fn(),
          },
        },
        PrismaService,
      ],
    }).compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutRepo = moduleRef.get<PayoutRepository>(PayoutRepository);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    providerMock = [
      (moduleRef.get<ProviderService>(ProviderService) as unknown as { transfer: ReturnType<typeof vi.fn> }).transfer,
      (moduleRef.get<ProviderService>(ProviderService) as unknown as { confirmTransfer: ReturnType<typeof vi.fn> }).confirmTransfer,
    ];

    await prisma.resetDatabase();
    // Seed account with funds
    await prisma.account.create({
      data: {
        id: ACCOUNT_ID,
        settledBalance: LARGE_AMOUNT,
        reservedBalance: 0n,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('concurrent creation against one account', () => {
    it('exactly one payout is created when two concurrent requests race for limited funds', async () => {
      const amount = 60000000n;
      const key1 = 'idem-key-concurrent';

      // Provider is not called — we only test the reservation phase
      const promise1 = payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr1',
        idempotencyKey: key1,
      });

      const promise2 = payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr2',
        idempotencyKey: key1 + '-2',
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Exactly one succeeds
      const successCount = [result1, result2].filter(
        (r) => r.status === PayoutStatus.CREATED,
      ).length;
      expect(successCount).toBe(1);

      // One throws insufficient_funds
      const errors: KnownError[] = [];
      // Re-run to capture errors properly
      const results: Array<Payout | KnownError | null> = [];
      const runs = await Promise.allSettled([promise1, promise2]);
      // The promises above already executed; let's check the results differently

      // Check DB state
      const payouts = await prisma.payout.findMany({
        where: { accountId: ACCOUNT_ID },
      });
      expect(payouts.length).toBe(1);
      expect(payouts[0].status).toBe(PayoutStatus.CREATED);
      expect(payouts[0].amount).toBe(amount);

      // Account should show one reservation
      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
      // Settled should NOT have changed
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('idempotency key', () => {
    it('same idempotencyKey returns original payout without double-reserving', async () => {
      const amount = 50000000n;
      const key = 'idem-key-same';

      const payout1 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-1',
        idempotencyKey: key,
      });

      const payout2 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-2', // different address
        idempotencyKey: key,
      });

      // Same payout returned
      expect(payout2.id).toBe(payout1.id);

      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
    });
  });

  describe('duplicate message delivery', () => {
    it('same message delivered twice results in one provider transfer', async () => {
      const amount = 50000000n;
      // Create payout and message manually for this test
      await prisma.$transaction(async (tx) => {
        await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-once',
            idempotencyKey: 'idem-dup-msg',
            status: PayoutStatus.CREATED,
          },
        });
        await tx.message.create({
          data: {
            payoutId: await (async () => {
              const p = await tx.payout.findUnique({ where: { idempotencyKey: 'idem-dup-msg' } });
              return p!.id;
            })(),
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerMock[0].mockResolvedValue({ txHash: '0xabc123' });

      // Run the worker twice — simulates duplicate delivery
      await payoutService.processMessages();
      await payoutService.processMessages();

      // Provider transfer called exactly once
      expect(providerMock[0]).toHaveBeenCalledTimes(1);
      expect(providerMock[0]).toHaveBeenCalledWith('addr-once', amount);

      const payouts = await prisma.payout.findMany();
      expect(payouts[0].status).toBe(PayoutStatus.SENT);

      const messages = await prisma.message.findMany();
      expect(messages[0].status).toBe(MessageStatus.PROCESSED);
    });
  });

  describe('retry exhaustion', () => {
    it('after max retries, payout enters NEEDS_REVIEW and reservation stays intact', async () => {
      const amount = 50000000n;
      await prisma.$transaction(async (tx) => {
        await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-retry',
            idempotencyKey: 'idem-retry',
            status: PayoutStatus.CREATED,
          },
        });
        const payout = await tx.payout.findUnique({
          where: { idempotencyKey: 'idem-retry' },
        });
        await tx.message.create({
          data: {
            payoutId: payout!.id,
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerMock[0].mockRejectedValue(new Error('provider timeout'));

      // Run processMessages() MAX_RETRIES + 1 times (but message is consumed after first run)
      // Each run processes the pending message; after failure with attempts >= MAX_RETRIES,
      // the message goes to FAILED and the payout goes to NEEDS_REVIEW.
      // On subsequent runs, there are no pending messages.
      await payoutService.processMessages(); // First attempt — fails, schedules retry (attempts=1)

      // Advance time past next retry window and run again
      const msg = await prisma.message.findFirst();
      expect(msg).not.toBeNull();
      expect(msg!.status).toBe(MessageStatus.PENDING);
      expect(msg!.attempts).toBe(1);

      // Fast-forward nextAttemptAt
      await prisma.message.updateMany({
        where: { id: msg!.id },
        data: { nextAttemptAt: new Date(0) },
      });

      await payoutService.processMessages(); // Second attempt — fails, attempts=2

      const msg2 = await prisma.message.findFirst();
      await prisma.message.updateMany({
        where: { id: msg2!.id },
        data: { nextAttemptAt: new Date(0) },
      });

      await payoutService.processMessages(); // Third attempt — fails, attempts=3 >= MAX_RETRIES

      // Now payout should be NEEDS_REVIEW, message FAILED
      const payouts = await prisma.payout.findMany();
      expect(payouts[0].status).toBe(PayoutStatus.NEEDS_REVIEW);

      const messages = await prisma.message.findMany();
      expect(messages[0].status).toBe(MessageStatus.FAILED);

      // Reservation stays intact — reservedBalance unchanged
      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
      // Settled balance unchanged
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('settlement on confirmation', () => {
    it('settled balance changes only after provider confirmation', async () => {
      const amount = 50000000n;
      // Create a payout in SENT status with txHash
      await prisma.payout.create({
        data: {
          accountId: ACCOUNT_ID,
          amount,
          destinationAddress: 'addr-settle',
          idempotencyKey: 'idem-settle',
          status: PayoutStatus.SENT,
          txHash: '0xconfirmed',
        },
      });

      providerMock[1].mockResolvedValue(true);

      await payoutService.processMessages();

      const payout = await prisma.payout.findUnique({
        where: { idempotencyKey: 'idem-settle' },
      });
      expect(payout!.status).toBe(PayoutStatus.COMPLETED);

      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      // Settled decreased
      expect(account!.settledBalance).toBe(LARGE_AMOUNT - amount);
      // Reserved released
      expect(account!.reservedBalance).toBe(0n);

      // Ledger entry exists for settlement
      const entries = await prisma.ledgerEntry.findMany({
        where: { payoutId: payout!.id },
      });
      const settlement = entries.find((e) => e.type === LedgerType.SETTLEMENT);
      expect(settlement).toBeDefined();
      expect(settlement!.amount).toBe(-amount);
    });
  });
});
```

Hmm, there's an issue in the first test — I called `promise1` and `promise2` before doing `Promise.allSettled`, which means they already executed. Let me fix the concurrent test. Also the test has a bug where the promises are consumed before `Promise.allSettled`. Let me fix it.

Also I need a test for the controller and a Vitest config. Let me also fix the concurrent test.

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['test/**/*.spec.ts'],
  },
});
```

### test/payout.spec.ts (fixed)
```ts
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutModule } from '../src/payout/payout.module';
import { ProviderModule } from '../src/provider/provider.module';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PrismaService } from '../src/common/prisma.service';
import { ProviderService } from '../src/provider/provider.service';
import { KnownError } from '../src/common/filters/exception.filter';
import { PayoutStatus, MessageStatus, LedgerType } from '../src/payout/payout.types';

vi.mock('external-provider-sdk', () => ({
  provider: {
    transfer: vi.fn(),
    confirm: vi.fn(),
  },
}));

describe('PayoutService', () => {
  let payoutService: PayoutService;
  let payoutRepo: PayoutRepository;
  let prisma: PrismaService;
  let providerTransfer: ReturnType<typeof vi.fn>;
  let providerConfirm: ReturnType<typeof vi.fn>;

  const ACCOUNT_ID = 'acc-test-1';
  const LARGE_AMOUNT = 100000000n;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PayoutModule, ProviderModule],
      providers: [
        {
          provide: ProviderService,
          useValue: {
            transfer: vi.fn(),
            confirmTransfer: vi.fn(),
          },
        },
        PrismaService,
      ],
    }).compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutRepo = moduleRef.get<PayoutRepository>(PayoutRepository);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    const provider = moduleRef.get<ProviderService>(ProviderService);
    providerTransfer = provider.transfer;
    providerConfirm = provider.confirmTransfer;

    await prisma.resetDatabase();
    await prisma.account.create({
      data: { id: ACCOUNT_ID, settledBalance: LARGE_AMOUNT, reservedBalance: 0n },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('concurrent creation against one account', () => {
    it('exactly one payout is created when two concurrent requests race for limited funds', async () => {
      const amount = 60000000n;

      // Fire both at the same time — DB serializes them
      const results = await Promise.allSettled([
        payoutService.createPayout({
          accountId: ACCOUNT_ID,
          amount,
          destinationAddress: 'addr-1',
          idempotencyKey: 'idem-concurrent-1',
        }),
        payoutService.createPayout({
          accountId: ACCOUNT_ID,
          amount,
          destinationAddress: 'addr-2',
          idempotencyKey: 'idem-concurrent-2',
        }),
      ]);

      const payouts = results.map((r) =>
        r.status === 'fulfilled' ? { status: r.value.status, id: r.value.id } : { status: 'error', error: r.reason },
      );

      const successful = payouts.filter((p) => p.status === PayoutStatus.CREATED);
      const failed = payouts.filter((p) => p.status === 'error');

      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0]!.error).toBeInstanceOf(KnownError);
      expect((failed[0]!.error as KnownError).code).toBe('insufficient_funds');

      const dbPayouts = await prisma.payout.findMany({ where: { accountId: ACCOUNT_ID } });
      expect(dbPayouts.length).toBe(1);
      expect(dbPayouts[0].status).toBe(PayoutStatus.CREATED);

      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account!.reservedBalance).toBe(amount);
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('idempotency key', () => {
    it('retrying the same idempotencyKey returns original payout with no additional reservation', async () => {
      const amount = 50000000n;

      const payout1 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-first',
        idempotencyKey: 'idem-same-key',
      });

      const payout2 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-different',
        idempotencyKey: 'idem-same-key',
      });

      expect(payout2.id).toBe(payout1.id);

      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account!.reservedBalance).toBe(amount);

      const messages = await prisma.message.findMany({
        where: { payoutId: payout1.id },
      });
      expect(messages.length).toBe(1);
    });
  });

  describe('duplicate message delivery', () => {
    it('same message picked up twice by worker results in exactly one provider transfer', async () => {
      const amount = 50000000n;

      await prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-once',
            idempotencyKey: 'idem-dup',
            status: PayoutStatus.CREATED,
          },
        });
        await tx.message.create({
          data: {
            payoutId: payout.id,
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerTransfer.mockResolvedValue({ txHash: '0xabc123' });

      // Worker runs twice — simulates redelivery of same message
      await payoutService.processMessages();
      await payoutService.processMessages();

      expect(providerTransfer).toHaveBeenCalledTimes(1);
      expect(providerTransfer).toHaveBeenCalledWith('addr-once', amount);

      const payout = await prisma.payout.findFirst({ where: { accountId: ACCOUNT_ID } });
      expect(payout!.status).toBe(PayoutStatus.SENT);
    });
  });

  describe('retry exhaustion', () => {
    it('exhausted retries lead to NEEDS_REVIEW with reservation and settled balance intact', async () => {
      const amount = 50000000n;

      await prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-retry',
            idempotencyKey: 'idem-retry',
            status: PayoutStatus.CREATED,
          },
        });
        await tx.message.create({
          data: {
            payoutId: payout.id,
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerTransfer.mockRejectedValue(new Error('timeout'));

      // 3 attempts exhaust MAX_RETRIES
      for (let i = 0; i < 3; i++) {
        await payoutService.processMessages();
        if (i < 2) {
          // Fast-forward the retry window
          const msg = await prisma.message.findFirst();
          if (msg) {
            await prisma.message.updateMany({
              where: { id: msg.id },
              data: { nextAttemptAt: new Date(0) },
            });
          }
        }
      }

      const payout = await prisma.payout.findFirst({ where: { accountId: ACCOUNT_ID } });
      expect(payout!.status).toBe(PayoutStatus.NEEDS_REVIEW);

      const messages = await prisma.message.findMany();
      expect(messages.length).toBe(1);
      expect(messages[0].status).toBe(MessageStatus.FAILED);
      expect(messages[0].attempts).toBeGreaterThanOrEqual(3);

      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      // Reservation intact
      expect(account!.reservedBalance).toBe(amount);
      // Settled balance untouched
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('settlement on confirmation', () => {
    it('settled balance and reserved balance only change after provider confirms', async () => {
      const amount = 50000000n;

      await prisma.payout.create({
        data: {
          accountId: ACCOUNT_ID,
          amount,
          destinationAddress: 'addr-confirm',
          idempotencyKey: 'idem-settle',
          status: PayoutStatus.SENT,
          txHash: '0xconfirmed-tx',
        },
      });

      providerConfirm.mockResolvedValue(true);

      await payoutService.processMessages();

      const payout = await prisma.payout.findUnique({
        where: { idempotencyKey: 'idem-settle' },
      });
      expect(payout!.status).toBe(PayoutStatus.COMPLETED);

      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account!.settledBalance).toBe(LARGE_AMOUNT - amount);
      expect(account!.reservedBalance).toBe(0n);

      const entries = await prisma.ledgerEntry.findMany({
        where: { payoutId: payout!.id },
      });
      const settlement = entries.find((e) => e.type === LedgerType.SETTLEMENT);
      expect(settlement).toBeDefined();
      expect(settlement!.amount).toBe(-amount);
    });
  });
});

describe('PayoutController', () => {
  let payoutService: PayoutService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PayoutModule, ProviderModule],
      providers: [
        {
          provide: ProviderService,
          useValue: { transfer: vi.fn(), confirmTransfer: vi.fn() },
        },
        PrismaService,
      ],
    }).compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
  });

  it('validates input and rejects non-bigint amounts', async () => {
    const { PayoutController } = await import('../src/payout/payout.controller');
    // The controller requires a NestJS context; for controller validation tests,
    // we test the validation logic directly.
    // ASSUMPTION: Controller validation is tested via service-level tests above.
    // Direct controller instantiation requires HTTP context.
    expect(true).toBe(true);
  });
});
```

Hmm, the controller test is weak. Let me improve it by using NestJS's controller testing approach.

Actually, let me simplify and remove the weak second describe block. The main test file should focus on the core scenarios. Let me make the concurrent test and other tests stronger.

Wait, I realize there might be an issue with the concurrent test in Node.js. Node is single-threaded, so `Promise.allSettled` will start the first call, which will run synchronously until the first await inside `createPayout`. That first await is the `$transaction` call. The second call starts and also reaches its `$transaction`. The DB serializes them. But in practice, the first call will acquire the row lock on the account first, do the conditional update, create the payout, create the message, commit. Then the second call will try its conditional update and find insufficient funds. This should work correctly.

Let me also think about a potential issue: in the retry exhaustion test, after the first `processMessages()` call, the message gets scheduled for retry (attempts=1). But the worker doesn't immediately re-pick it up because `nextAttemptAt` is in the future. So I need to fast-forward it. My test does that correctly.

But wait, there's a subtle issue: the `claimPendingMessages` query requires `p.status = CREATED`. After the first attempt, the payout status is changed to PROCESSING by `tryStartProcessing`. So on the second call, `claimPendingMessages` won't find this message because the payout is no longer CREATED.

This is actually correct behavior! The message is in PENDING but the payout is PROCESSING. The `claimPendingMessages` query filters out messages whose payout is not CREATED. So after the first failure and retry scheduling, the message is still PENDING but the payout is PROCESSING. On the next poll, after we fast-forward `nextAttemptAt`, the query still won't pick it up because `p.status = CREATED` is no longer true.

This is a bug in my design! I need to fix the `claimPendingMessages` query or the status flow. Let me think about this.

The issue is: when `tryStartProcessing` transitions the payout from CREATED to PROCESSING, the message is still PENDING (until it succeeds or fails). But my `claimPendingMessages` query requires the payout to be CREATED. After the transition, the message won't be found.

The fix: either:
1. The `claimPendingMessages` query shouldn't filter on payout status — it should just find PENDING messages. The `tryStartProcessing` conditional update already handles the concurrency safety.
2. Or, after failure and retry scheduling, the payout should go back to CREATED.

Option 1 is cleaner. Let me fix the query:

```sql
SELECT m.* FROM messages m
WHERE m.status = 'PENDING'
  AND m.next_attempt_at <= NOW()
ORDER BY m.next_attempt_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED
```

And the `tryStartProcessing` check is what ensures we only process payouts that haven't been claimed yet (the payout is still CREATED when the conditional UPDATE succeeds).

Wait, but then what happens when a message is picked up, processing starts (payout becomes PROCESSING), and the provider call is in-flight, and the message gets redelivered (crash)? The redelivery will pick up this PENDING message again, but `tryStartProcessing` will return null (payout is PROCESSING now), so the redelivery is correctly handled as a no-op.

But what about after failure? If processing fails and we schedule a retry:
- Payout stays PROCESSING (or do we change it back?)
- Message stays PENDING with updated nextAttemptAt

Actually, I think the flow should be:
- After failure: payout stays PROCESSING (it might still succeed on retry)
- After success: payout goes to SENT
- After retry exhaustion: payout goes to NEEDS_REVIEW

And the `claimPendingMessages` should NOT filter on payout status. Let me fix this.

But wait, there's another issue. If payout is PROCESSING and the worker crashes and restarts, the message is still PENDING. The next poll picks it up again, `tryStartProcessing` returns null (payout is PROCESSING), so it marks message as PROCESSED. But wait — we don't want to lose the retry! The payout is stuck in PROCESSING forever.

Hmm. Let me reconsider. The key insight is that for the at-least-once delivery, the safety comes from the idempotent handling. Let me redesign:

**Option A**: Payout stays in PROCESSING during retries. After retry exhaustion, it goes to NEEDS_REVIEW. If `tryStartProcessing` returns null, it means another worker is handling it (or it was already handled). Mark the message as PROCESSED.

But then if a worker starts processing, the provider call hangs (no crash, just very slow), and another worker picks up the same message... `tryStartProcessing` will return the payout (since it's still PROCESSING? No, the condition is `status = CREATED`). Hmm.

Let me reconsider the `tryStartProcessing` condition. If the payout is PROCESSING, it's already being processed. So the condition should be: can I transition to PROCESSING? Only from CREATED. So if it's PROCESSING, another worker is handling it.

But then if the worker that started processing is just slow (not crashed), the retry is delayed. That's fine — bounded by the worker's processing time.

What if the worker crashes during processing? Payout is PROCESSING, message is PENDING. On restart, worker picks up the message, `tryStartProcessing` returns null (payout is PROCESSING), marks message PROCESSED. But the payout is stuck! Nobody will retry it.

This is a problem. Let me think about a different approach.

**Option B**: On failure, transition payout back to CREATED (so it can be picked up again), and rely on the `retries` counter or message attempts to enforce the bound.

Let me change the approach:
- When the worker picks up a message, it doesn't change the payout status to PROCESSING. Instead, it just calls the provider.
- On success: payout → SENT, message → PROCESSED.
- On failure: check `retries` on the payout. If `retries < MAX_RETRIES`, increment retries, schedule retry (message stays PENDING with new nextAttemptAt). If `retries >= MAX_RETRIES`, payout → NEEDS_REVIEW, message → FAILED.

This way, the payout stays CREATED throughout, and each retry picks it up fresh. The conditional update isn't needed for status transition (since we don't transition it). But the `claimPendingMessages` filter `p.status = CREATED` is fine.

Actually, let me use the status transition as a guard (to handle the case where two workers try to process the same message simultaneously), but don't let it get stuck. Let me use:

- `tryStartProcessing`: conditional CREATED → PROCESSING. If it fails, another worker is handling it.
- On failure: change payout back to CREATED before scheduling retry? No, that's racy.

OK let me just go with the simplest correct design:

**Final design**:
- `claimPendingMessages` does NOT filter on payout status — it finds PENDING messages with next_attempt_at passed.
- `tryStartProcessing`: CREATED → PROCESSING. Returns null if payout is not CREATED.
- If `tryStartProcessing` returns null: mark message PROCESSED, skip. (Another worker is handling it.)
- On provider success: payout → SENT.
- On provider failure: 
  - Increment attempts. If attempts >= MAX_RETRIES → payout → NEEDS_REVIEW. 
  - Otherwise → keep payout as PROCESSING, schedule retry on message.

But then the stuck-while-processing scenario... Actually, since we're using `FOR UPDATE SKIP LOCKED` and `tryStartProcessing`, the only way two workers both try is if they both claim the message in separate transactions. With `FOR UPDATE SKIP LOCKED`, only one worker gets the row. The other gets nothing. So there's no concurrency issue.

But with the `SKIP LOCKED` query, one worker gets the message and processes it. The status goes to PROCESSING. If the provider call takes a long time and the worker doesn't crash, the next poll won't pick up the same message because it's no longer PENDING — it's still PENDING but with updated nextAttemptAt in the future. Actually, the message IS still PENDING (I was marking it PROCESSED only when `tryStartProcessing` returned null). 

Wait, let me trace through:
1. Worker poll: gets message M (payout P is CREATED, message M is PENDING)
2. Worker: tryStartProcessing(P) → success, P is now PROCESSING
3. Worker: calls provider.transfer → timeout
4. Worker: failure — schedule retry for M (M still PENDING, nextAttemptAt = future, attempts = 1)
5. Worker poll: gets M again? No — M.nextAttemptAt is in the future, so it's not returned by the query.
6. But P is still PROCESSING. P's status won't change until the retry succeeds or fails.

This works! Let me trace the crash scenario:
1. Worker poll: gets M (P is CREATED)
2. Worker: tryStartProcessing(P) → success, P is PROCESSING
3. Worker: calls provider → crash!
4. Worker dies. M is still PENDING (scheduleRetry wasn't called).
5. Worker restarts. Poll: gets M again (P is PROCESSING, M is PENDING, nextAttemptAt = now since scheduleRetry wasn't called).
6. Worker: tryStartProcessing(P) → returns null (P is PROCESSING).
7. Worker: marks M as PROCESSED. Done.
8. P is stuck in PROCESSING.

This is the problem. After a crash, the payout is stuck.

The fix: on the retry path (after a crash or after explicit retry), we need to ensure the payout can be processed again. Let me add a check: when `tryStartProcessing` returns null, check the payout status. If it's PROCESSING AND the message attempts have been made before, treat it as a retry.

Actually, the simplest fix is: don't use the conditional update as the sole guard. Instead, also record in the message what happened.

Let me go with a different approach entirely. Let me simplify:

**Simplified approach**: No conditional payout status update. Instead:
1. Worker picks PENDING messages.
2. For each message, check payout status:
   - If SENT/COMPLETED/FAILED/NEEDS_REVIEW: mark message PROCESSED, skip (already handled).
   - If CREATED/PROCESSING: proceed with provider.transfer.
3. On success: update payout to SENT, message to PROCESSED.
4. On failure: increment message attempts and payout retries. If attempts >= MAX: payout NEEDS_REVIEW, message FAILED. Else schedule retry.
5. The payout status stays PROCESSING during retries.

This avoids the stuck problem because:
- If worker crashes after getting the message but before updating it, the message is still PENDING.
- On restart, the message is picked up again. Payout is PROCESSING. Since we check status and handle it (PROCESSING is not "already done"), we proceed to call the provider again. If the provider call succeeds, we update to SENT. If it fails again, we retry or mark NEEDS_REVIEW.

But wait, calling provider.transfer twice might result in two on-chain transfers! That violates the "one transfer" requirement.

OK, this is the crux of the problem. We need to ensure that a payout is only sent once. Let me think about this differently.

The provider call `provider.transfer({to, amount})` is a side effect. We need exactly one side effect per payout. The conditional update (CREATED → PROCESSING) is the mechanism to ensure only one worker proceeds.

So the design should be:
1. Conditional update CREATED → PROCESSING (only one worker wins).
2. Winner calls provider.
3. If success: payout → SENT.
4. If failure: payout stays PROCESSING, message scheduled for retry.
5. On retry, payout is still PROCESSING. Worker needs a different mechanism to allow retry.

Solution: the `tryStartProcessing` should allow transition from PROCESSING as well, but only if the message hasn't been processed yet AND we haven't exceeded retries. Or, use a different flag.

Let me redesign with explicit status for "in progress":

- Payout status: CREATED → PROCESSING → SENT → COMPLETED | NEEDS_REVIEW | FAILED
- After a failed attempt, the payout stays PROCESSING, and the message is rescheduled.
- `tryStartProcessing` should allow re-processing: it checks if payout is PROCESSING AND the message is PENDING (waiting for retry).

Actually, let me use a simpler guard. The message is the unit of work. As long as the message is PENDING, the payout hasn't been sent yet (SENT means provider succeeded). So:

```ts
async tryStartProcessing(payoutId: string): Promise<Payout | null> {
  // Only allow processing if payout hasn't been sent yet
  const result = await this.prisma.$queryRaw<{ id: string }[]>`
    UPDATE payouts
    SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
    WHERE id = ${payoutId} AND status IN (${PayoutStatus.CREATED}, ${PayoutStatus.PROCESSING})
    AND EXISTS (SELECT 1 FROM messages WHERE payout_id = ${payoutId} AND status = ${MessageStatus.PENDING})
    RETURNING id
  `;
  if (result.length === 0) return null;
  return this.prisma.payout.findUnique({ where: { id: payoutId } });
}
```

Hmm, that's complicated. Let me think more carefully.

Actually, the simplest correct design:

**The conditional update CREATED → PROCESSING is the lock.** When a worker wins this lock, it has exclusive right to process this payout. If it fails and schedules a retry, it should release the lock (transition back to CREATED) so that the retry can pick it up again.

But releasing the lock (PROCESSING → CREATED) is itself racy — what if another worker has already picked it up? No, they can't, because the message is PENDING and only one worker can claim it with SKIP LOCKED.

Wait, actually, after the failure, the message is rescheduled (nextAttemptAt in future). On the next poll, the message might be picked up by another worker. If the payout is still PROCESSING, that other worker... what happens?

Let me redesign this more carefully:

**Design with explicit retry handling:**

1. `claimPendingMessages` finds PENDING messages with `nextAttemptAt <= NOW()` (regardless of payout status).
2. For each message:
   a. Try conditional update on payout:
      - If payout is CREATED: transition to PROCESSING. This is a "fresh" start.
      - If payout is PROCESSING: this is a retry (message was rescheduled). Allow processing.
      - Otherwise (SENT, COMPLETED, etc.): mark message PROCESSED, skip.
   b. Call provider.transfer.
   c. On success: payout → SENT, message → PROCESSED.
   d. On failure: schedule retry (message stays PENDING, new nextAttemptAt). If attempts >= MAX → payout NEEDS_REVIEW, message FAILED.

So the conditional update should be:
```sql
UPDATE payouts SET status = PROCESSING, processed_at = NOW()
WHERE id = $1 AND status IN (CREATED, PROCESSING)
RETURNING id
```

But this is not truly conditional — any PROCESSING payout can be re-processed. What if two workers both see the payout as PROCESSING? With SKIP LOCKED on the message, only one gets the message. So only one worker processes it at a time. OK that's fine.

But there's still the duplicate call concern: what if worker A picks up message M, payout is PROCESSING, A calls provider (succeeds), payout → SENT. But then worker B had also picked up a different message for the same payout? No — each payout has exactly one message (unique constraint on payoutId in messages). So this can't happen.

What about: worker A picks up M, payout is PROCESSING, A calls provider (fails), schedules retry. On retry, worker C picks up M, payout is still PROCESSING, C calls provider. If A's failure was a timeout and the transfer actually succeeded, C's call will result in a double transfer.

This is the fundamental challenge. The provider might have succeeded after the timeout. We can't call it again safely.

BUT — the spec says the provider may throw, time out, or succeed slowly. If it timed out (threw a timeout error), we don't know if it succeeded. The bounded retry is supposed to handle this. The issue is: calling the provider again after a timeout could result in a double transfer.

The spec says: "Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe and explain why."

So the bounded retry is acceptable even with potential double-calls. The alternative (NOT retrying) means we never know if a timed-out transfer succeeded, and we'd be stuck in PROCESSING forever.

Actually wait, the spec says: "the worker's error path reverses the reservation. That reversal is the one that loses real money, because the transfer may still land." So the current design reverses the reservation on error. The fix is to NOT reverse (leave reservation intact, mark NEEDS_REVIEW).

So the bounded retries on the provider call are acceptable per the spec. If a retry results in a double transfer (provider timed out on first call but actually went through), that's the cost of bounded retries, and NEEDS_REVIEW handles it (human will investigate and may need to handle a double payment, but at least the reservation wasn't reversed, so we're not losing money — we might have paid twice, but we know the exact amount).

OK so the design is:
1. Conditional update on payout: CREATED → PROCESSING (lock). Only one worker gets this lock.
2. On retry: payout stays PROCESSING. When the message is rescheduled and picked up again, `tryStartProcessing` should allow it.

Let me just use a simpler `tryStartProcessing` that works for both initial and retry:

```ts
async tryStartProcessing(payoutId: string): Promise<Payout | null> {
  const rows = await this.prisma.$queryRaw<{ id: string }[]>`
    UPDATE payouts
    SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
    WHERE id = ${payoutId} AND status <> ${PayoutStatus.SENT}
    RETURNING id
  `;
  if (rows.length === 0) return null;
  return this.prisma.payout.findUnique({ where: { id: payoutId } });
}
```

This allows re-processing of PROCESSING payouts but blocks SENT/COMPLETED/FAILED/NEEDS_REVIEW. Combined with the message being PENDING (not PROCESSED), this correctly handles retries.

But there's still the double-call concern. If we call provider.transfer twice (timeout on first, retry on second), the provider might process both. That's the trade-off of bounded retries.

Actually, let me reconsider. The claimPendingMessages query already uses SKIP LOCKED. And each payout has exactly one message. So only one worker processes a payout at a time. The double-call scenario would be: worker A calls provider (timeout), schedules retry. Later, worker B picks up the same message (payout is PROCESSING), calls provider again. If A's transfer actually went through, B's call is a duplicate.

This is inherent to the design and the spec accepts it ("the worker may see the same message more than once" and retries are bounded). The spec specifically says retry exhaustion leads to NEEDS_REVIEW (safe), not that retries never cause double-transfers.

Actually, let me re-read: "Delivery is at-least-once: your worker may see the same message more than once." This means the QUEUE message can be redelivered. If the worker successfully processes (sends) and marks the message PROCESSED, but then crashes before the DB commit... the message gets redelivered. The second delivery should find payout already SENT and skip.

So: if provider.call succeeded and payout → SENT, but message → PROCESSED wasn't committed (crash), the message is redelivered. `tryStartProcessing` returns null (payout is SENT). Mark message PROCESSED. Done. No double transfer.

The only double-transfer risk is if the provider call succeeds but the response is lost (different from timeout). The bounded retry will try again and might double-pay. That's the risk, and the NEEDS_REVIEW state handles it afterward.

OK I think the design is sound. Let me finalize the code with this understanding.

Let me update `tryStartProcessing`:

```ts
async tryStartProcessing(payoutId: string): Promise<Payout | null> {
  const rows = await this.prisma.$queryRaw<{ id: string }[]>`
    UPDATE payouts
    SET status = ${PayoutStatus.PROCESSING}, processed_at = NOW()
    WHERE id = ${payoutId} AND status <> ${PayoutStatus.SENT}
      AND status <> ${PayoutStatus.COMPLETED}
      AND status <> ${PayoutStatus.NEEDS_REVIEW}
    RETURNING id
  `;
  if (rows.length === 0) return null;
  return this.prisma.payout.findUnique({ where: { id: payoutId } });
}
```

And update `claimPendingMessages` to not filter on payout status:

```sql
SELECT m.* FROM messages m
WHERE m.status = PENDING AND m.next_attempt_at <= NOW()
ORDER BY m.next_attempt_at ASC
LIMIT 10 FOR UPDATE SKIP LOCKED
```

Now let me also fix the retry exhaustion test. After the first attempt, the payout goes to PROCESSING. The message is rescheduled. On subsequent polls, the message is picked up (payout is PROCESSING → `tryStartProcessing` succeeds, payout stays PROCESSING). After 3 attempts (MAX_RETRIES = 3), payout → NEEDS_REVIEW, message → FAILED.

Wait, let me trace through more carefully:

Initial state: payout CREATED, message PENDING, attempts=0.

**processMessages() call 1:**
1. claimPendingMessages: finds message (payout is CREATED, message is PENDING, nextAttemptAt = now).
2. tryStartProcessing: payout CREATED → PROCESSING. Returns payout.
3. provider.transfer: throws (mock).
4. Schedule retry: attempts = 1, nextAttemptAt = now + backoff.
5. Payout stays PROCESSING.

**processMessages() call 2** (after fast-forwarding nextAttemptAt):
1. claimPendingMessages: finds message (payout is PROCESSING ✓, message is PENDING, nextAttemptAt = past).
2. tryStartProcessing: payout PROCESSING (not SENT, not COMPLETED, not NEEDS_REVIEW) → stays PROCESSING. Returns payout.
3. provider.transfer: throws.
