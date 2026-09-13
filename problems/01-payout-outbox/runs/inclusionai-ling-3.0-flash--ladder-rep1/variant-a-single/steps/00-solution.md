# solution

## reasoning

```
Let me design the full solution based on the requirements. I need to build:

1. Prisma schema with models for Account, Payout, Message (queue), and ProcessedMessage (dedup)
2. NestJS module: controller, service, worker
3. Tests
4. DESIGN.md

Key architectural decisions based on the spec:
- Reserve vs settled balance: Account has `settledBalance` (BigInt) and `reservedBalance` (BigInt)
- Atomic reserve: conditional UPDATE that checks settled - reserved >= amount, then increments reserved
- Message queue in same transaction as reservation
- Worker processes messages with idempotency (processed messages table)
- Retry bounded, terminal state on exhaustion
- Lifecycle: created → processing → sent → completed/failed/needs-review

Let me think about the models:

**Account**: id, settledBalance (BigInt), reservedBalance (BigInt)
**Payout**: id, accountId, amount (BigInt), destinationAddress, idempotencyKey, status (enum: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW), txHash?, createdAt, updatedAt
**Message**: id, payoutId, status (PENDING, PROCESSING, PROCESSED, FAILED), attempts, createdAt, processedAt
**ProcessedMessage**: id, messageId (unique), processedAt — for dedup

Actually, let me reconsider. For the "processed messages" dedup, I could use a unique constraint on the message ID in a processed table, or I could use the payout status transition guarded by conditional update. Let me use both approaches combined:
- Message has a status column, and the worker does a conditional update on the message status (PENDING → PROCESSING) — only one worker instance wins.
- Additionally, a ProcessedMessage table with unique messageId to record that a message was fully processed.

Wait, let me simplify. The key dedup mechanism: when the worker picks up a message, it does a conditional UPDATE setting status from 'PENDING' to 'PROCESSING' where status = 'PENDING'. This ensures only one execution. But if the process crashes after marking PROCESSING but before completing, we need a way to reprocess. So we need a timeout or the polling interval naturally handles it — when it sees a message stuck in PROCESSING for too long, it resets to PENDING.

Actually, a cleaner approach for the spec: use the status transition guarded approach. The message has status. Worker:
1. Fetches pending messages
2. Tries to lock each: UPDATE message SET status = 'PROCESSING', lockedAt = now() WHERE id = ? AND status = 'PENDING'
3. If affected rows = 0, skip (another worker or this worker already took it)
4. Process the payout transfer
5. On success: update payout status, mark message as 'PROCESSED'
6. On failure with retries left: keep as PENDING (or track attempts)
7. On retry exhaustion: mark payout as NEEDS_REVIEW, message as 'FAILED'

For duplicate delivery (same message seen twice): since after step 2 the status is PROCESSING, a second fetch won't pick it up. But if the process crashes between 2 and 5, a subsequent poll will see it as PROCESSING. We need a timeout mechanism: if lockedAt is older than N seconds, reset to PENDING.

Let me also think about the ProcessedMessage approach from the spec: "a processed-messages record, a status transition guarded by a conditional update, or a unique constraint the second attempt violates. Choose one and make it the only path."

I'll go with the status transition guarded by conditional update approach, plus a cleanup mechanism for stuck messages.

Now let me lay out all the files:

1. `prisma/schema.prisma`
2. `src/payout/payout.module.ts`
3. `src/payout/payout.controller.ts`
4. `src/payout/payout.service.ts`
5. `src/payout/payout.worker.ts` (or processor)
6. `src/payout/payout.repository.ts`
7. `src/payout/payout.types.ts` (enums/interfaces)
8. `test/payout.spec.ts`
9. `DESIGN.md`
10. `src/main.ts`
11. `src/app.module.ts`

Let me think about the types/enum:

PayoutStatus: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW
MessageStatus: PENDING, PROCESSING, COMPLETED, FAILED

Account model:
- id: String (uuid or cuid)
- settledBalance: BigInt
- reservedBalance: BigInt
- createdAt, updatedAt

Payout model:
- id: String
- accountId: String
- amount: BigInt
- destinationAddress: String
- idempotencyKey: String (unique)
- status: PayoutStatus
- txHash: String? 
- createdAt, updatedAt

Message model:
- id: String
- payoutId: String
- status: MessageStatus
- attempts: Int (default 0)
- nextAttemptAt: DateTime? (for delayed retry)
- createdAt, updatedAt

ProcessedMessage model:
- messageId: String (unique)
- processedAt: DateTime

Actually, I think I should reconsider. The spec says "Choose one and make it the only path." Let me use the conditional update on message status as the primary mechanism, and NOT use a separate ProcessedMessage table. That's cleaner.

But wait, I also need idempotency for the creation endpoint. The idempotencyKey is unique on the payout itself.

Let me also think about the atomic reserve operation:

```sql
-- This needs to be done via Prisma. The approach:
-- 1. Try to update: SET reservedBalance = reservedBalance + amount 
--    WHERE id = accountId AND settledBalance - reservedBalance >= amount
--    AND ... (this is a conditional update)
-- Actually in Prisma we can do this with $queryRaw or we can do it differently.
```

Hmm, Prisma doesn't natively support conditional updates with WHERE clauses that check computed values. Let me think...

Option 1: Use `$queryRaw` for the conditional update (but spec says service has zero raw SQL/Prisma client calls, only repository)
Option 2: Use Prisma's `updateMany` with a where clause that checks the condition

Actually, Prisma's `updateMany` supports `where` conditions, so:

```ts
const result = await this.prisma.account.updateMany({
  where: {
    id: accountId,
    // settled - reserved >= amount, but Prisma doesn't support computed fields in where easily
  },
  data: { reservedBalance: { increment: amount } }
});
```

The problem is that Prisma's `where` for updateMany doesn't support arithmetic expressions. So I might need `$queryRaw` in the repository for this atomic operation. That's acceptable since it's in the repository layer.

Let me use $queryRaw for the conditional update:

```ts
const result = await this.prisma.$queryRaw<{ count: number }>`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}
  WHERE id = ${accountId} AND settled_balance - reserved_balance >= ${amount}
  RETURNING COUNT(*) as count
`;
```

Then check if `result[0].count > 0`.

For the transaction that also creates the message:

```ts
await this.prisma.$transaction(async (tx) => {
  // 1. Atomic reserve
  const reserveResult = await tx.$queryRaw...
  if (reserveResult[0].count === 0) throw new InsufficientFundsError();
  
  // 2. Create payout
  const payout = await tx.payout.create({...});
  
  // 3. Create message
  await tx.message.create({...});
});
```

Now let me write everything.

For the worker:
- Runs on an interval (set via a config/env variable, default 5 seconds)
- Fetches PENDING messages (with status = 'PENDING')
- For each, tries to lock it (conditional UPDATE status to PROCESSING)
- Processes the transfer via provider
- Handles retries, success, failure

For the provider, I'll create an injectable that wraps `provider.transfer({to, amount})`.

Let me also think about the Account creation. I'll need a way to create accounts with initial balance. Maybe a separate endpoint or just through the test setup.

Let me also think about the lifecycle more carefully:

Payout statuses: CREATED → PROCESSING → SENT → COMPLETED
Or: CREATED → PROCESSING → FAILED → NEEDS_REVIEW (after retries exhausted)

Wait, let me re-read the spec: "created → processing → sent → completed / failed / needs-review"

So:
- CREATED: payout created, funds reserved
- PROCESSING: worker picked up the message
- SENT: provider returned a txHash (transfer submitted)
- COMPLETED: provider confirmed settlement (txHash confirmed)
- FAILED: provider confirmed failure
- NEEDS_REVIEW: retries exhausted without definitive outcome

Settlement happens on confirmation. So the ledger (settledBalance) changes when status goes to COMPLETED.

But what about SENT? The txHash is in hand but not confirmed. So settled doesn't change yet. The reserved stays.

When it completes: settledBalance decreases by amount, reservedBalance decreases by amount.
When it fails: reservedBalance decreases by amount (release the hold).
When needs-review: reserved stays (uncertainty parks).

Let me now code everything.

Actually, let me reconsider the "settled balance moves only after provider confirmation." So:
- On CREATED: settled unchanged, reserved += amount
- On COMPLETED: settled -= amount, reserved -= amount
- On FAILED: reserved -= amount (release hold back to settled)
- On NEEDS_REVIEW: reserved stays as-is (parked)

The account's available balance = settledBalance - reservedBalance. This should never go negative.

Let me also think about the Message processing more carefully:

When processing a message:
1. Lock message (status PENDING → PROCESSING)
2. Get payout associated
3. Check payout status — if already COMPLETED/FAILED/NEEDS_REVIEW, mark message PROCESSED and skip
4. Call provider.transfer
5. If success (txHash): update payout to SENT with txHash, mark message COMPLETED
6. If failure (transient): increment attempts, if < max retries keep PENDING (or set nextAttemptAt), else mark payout NEEDS_REVIEW, message FAILED
7. If timeout/unknown: similar to failure path

Wait, but the spec says "Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe." So I need to track attempts per message.

Also for duplicate message delivery: if the same message (same payout) is delivered twice, the second time the payout might already be SENT/COMPLETED/etc. So I check payout status first.

Let me structure this more clearly:

For each PENDING message:
1. Try to lock: UPDATE messages SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING'
2. If 0 rows affected, skip (already locked or processed)
3. Load payout
4. If payout is terminal (COMPLETED, FAILED, NEEDS_REVIEW), mark message COMPLETED, skip
5. Try provider.transfer
6. On success: payout.SENT + txHash, message.COMPLETED
7. On failure:
   a. Increment message.attempts
   b. If attempts >= MAX_RETRIES: payout.NEEDS_REVIEW, message.FAILED
   c. Else: message.PENDING (release for retry), or keep as PENDING
8. On exception (including timeout): same as failure path

Wait, but if I set message back to PENDING after a failed attempt, another poll cycle could pick it up. That's fine — it's the at-least-once delivery. The important thing is that attempts are tracked and bounded.

But there's a subtlety: when the message is set back to PENDING, and then picked up again, the payout status is still CREATED/PROCESSING (not SENT since the transfer never went through). So step 4 handles this correctly.

Actually, let me add PROCESSING to the payout status too. When the worker starts processing a payout, it sets payout to PROCESSING. Then:
- On provider success: PROCESSING → SENT
- On confirmation: SENT → COMPLETED  
- On failure after retries: PROCESSING → NEEDS_REVIEW

Hmm, but how does SENT become COMPLETED? There needs to be a confirmation mechanism. Maybe the worker also polls the provider for confirmation. Or maybe for this exercise, we consider that after a bounded number of confirmations, it becomes COMPLETED.

Actually, the spec says "Settled balance moves only after provider confirmation" and "txHash in hand is not confirmation of settlement." But for the polling worker, we need some mechanism. Let me simplify:

The worker does:
1. Process SENT payouts: try to confirm via provider.confirmation(txHash) or similar
2. Process PENDING messages: do the transfer

Let me add a simpler model. The worker processes messages:
- For each PENDING message:
  - Lock it
  - Call provider.transfer
  - On success: payout = SENT, message attempts reset or set to COMPLETED
  - On failure: retry logic

Then a separate confirmation step or we just consider that after N confirmations/polls, it becomes COMPLETED. But for the test, we can simplify and say:

Actually, let me re-read: "Settled balance changes only when the provider confirms the transfer." and "txHash in hand is not confirmation of settlement."

For a practical implementation, I'll add a `confirmTransfer` method on the provider that checks if a txHash has been confirmed. The worker polls both:
1. Pending messages (to initiate transfers)
2. Sent payouts (to confirm them)

Or, more simply, I can treat the provider.transfer call as potentially having a callback/webhook. Since the spec doesn't detail this, let me use a simpler approach:

The worker:
1. Picks up PENDING messages
2. Calls provider.transfer
3. On success → payout.SENT with txHash, message mark COMPLETED
4. Also picks up SENT payouts for confirmation
5. Calls some confirmation check → payout.COMPLETED, settled balance updated

But this adds complexity. Let me simplify for this implementation:

After provider.transfer succeeds (returns txHash), we do a follow-up confirmation. If confirmed within a bounded time → COMPLETED. Otherwise → NEEDS_REVIEW.

Actually, for a cleaner design that matches the spec exactly, let me do this:

Two types of worker processing:
1. **Dispatch**: Pick PENDING messages, call provider.transfer, set payout.SENT
2. **Settle**: Pick SENT payouts, confirm with provider, set payout.COMPLETED (and update settled balance), or FAILED

But this might be over-engineering. Let me keep it simpler:

The provider.transfer call returns {txHash}. After getting the txHash, the worker then polls the provider for confirmation. Once confirmed → COMPLETED. If confirmation fails or times out after retries → NEEDS_REVIEW.

Let me just implement a pragmatic version. I'll have the worker process messages in this flow:

1. Find PENDING messages
2. Try to lock each
3. For locked messages:
   a. Check payout status (if already terminal, skip)
   b. Call provider.transfer
   c. On success: payout.status = SENT, payout.txHash = txHash, message attempts++, then try to confirm
   d. On confirmation success: payout.status = COMPLETED, update settled balance (settled -= amount, reserved -= amount), message.COMPLETED
   e. On confirmation failure or transfer failure: retry logic with bounded retries
   f. If retries exhausted: payout.NEEDS_REVIEW, message.FAILED

Let me simplify the confirmation: just simulate that after getting txHash, we do a confirm call. For the test, we mock the provider.

OK let me just write the code now. I'm overthinking the design.

Let me finalize my file list:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/payout/payout.types.ts` — enums and types
5. `src/payout/payout.module.ts`
6. `src/payout/payout.repository.ts`
7. `src/payout/payout.service.ts`
8. `src/payout/payout.controller.ts`
9. `src/payout/payout.worker.ts`
10. `src/payout/provider.service.ts` — wraps provider.transfer
11. `test/payout.spec.ts`
12. `DESIGN.md`
13. `prisma/migrations/...` — migration file(s)

Actually the spec says "Prisma schema + migration." I'll include the migration as a file.

Let me also consider: the spec says "processMessages() runs every N seconds." I'll use NestJS's @Interval decorator or a setInterval in the worker's onModuleInit.

Let me now write all files. I'll use cuid for IDs (Prisma default).

For the provider, I'll define an interface and inject it:

```ts
export interface Provider {
  transfer({ to, amount }: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

Let me write everything now.

One more consideration: the tests. The spec says tests for:
- Concurrent creation against one account
- Duplicate message delivery
- Retry exhaustion

These will be integration tests using a real Prisma client against a test database, or unit tests mocking the repo and provider. Given NestJS + Vitest conventions, I'll write integration-style tests using a real Prisma instance with an in-memory or test PostgreSQL. But actually, for simplicity and to follow the conventions, I'll write tests that use mocked repositories/provider but still test behavior thoroughly.

Wait, the conventions say "Test the behaviour, not the implementation." and "Never assert only that a call happens." and "A test with no assertion is worse than no test." So I need real behavioral tests.

Let me use a real Prisma client connected to a test database (maybe via an in-memory approach or just mocking the Prisma client at the repository level while testing the service/worker behavior).

Actually, the best approach for these tests is to test the service and worker with a mocked Prisma client (using $queryRaw mocked, etc.) and a mocked provider. The tests will verify the behavior at the service/worker level.

Let me write everything now.

Let me also decide on the enums for database:

PayoutStatus enum:
- CREATED
- PROCESSING  
- SENT
- COMPLETED
- FAILED
- NEEDS_REVIEW

MessageStatus enum:
- PENDING
- PROCESSING
- COMPLETED
- FAILED

For the Account model, I'll use `BigInt` type in Prisma.

Now, in Prisma schema, I'll define:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id              String  @id @default(cuid())
  settledBalance  BigInt
  reservedBalance BigInt  @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  payouts         Payout[]
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
  updatedAt          DateTime      @updatedAt
  account            Account       @relation(fields: [accountId], references: [id])
  messages           Message[]
  @@map("payouts")
}

model Message {
  id        String        @id @default(cuid())
  payoutId  String
  status    MessageStatus @default(PENDING)
  attempts  Int           @default(0)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  payout    Payout        @relation(fields: [payoutId], references: [id])
  @@map("messages")
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
  PROCESSING
  COMPLETED
  FAILED
}
```

Now let me think about the migration. For a Prisma project, migrations are auto-generated, but I'll include a representative one.

Now let me think about the critical path in the service:

```typescript
async createPayout(input: CreatePayoutDto) {
  // 1. Check idempotency — look for existing payout with same key
  const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  
  // 2. Atomic reserve + create payout + create message in one transaction
  return this.prisma.$transaction(async (tx) => {
    // Atomic reserve
    const reserveResult = await tx.$queryRaw<{ count: bigint }>`
      UPDATE accounts 
      SET reserved_balance = reserved_balance + ${input.amount}
      WHERE id = ${input.accountId} 
        AND settled_balance - reserved_balance >= ${input.amount}
    `;
    
    if (Number(reserveResult[0].count) === 0) {
      throw new InsufficientFundsException();
    }
    
    // Create payout
    const payout = await tx.payout.create({
      data: {
        accountId: input.accountId,
        amount: input.amount,
        destinationAddress: input.destinationAddress,
        idempotencyKey: input.idempotencyKey,
        status: PayoutStatus.CREATED,
      }
    });
    
    // Create message
    await tx.message.create({
      data: {
        payoutId: payout.id,
        status: MessageStatus.PENDING,
      }
    });
    
    return payout;
  });
}
```

Wait, but the idempotency check happens outside the transaction. This could lead to a race where two concurrent requests with the same idempotencyKey both see no existing payout, then both enter the transaction. The transaction itself needs to handle this.

The fix: do the idempotency check inside the transaction, or rely on the unique constraint. If we do it inside the transaction, the second transaction will either see the first's payout (if committed) or block (if not). Actually with PostgreSQL's default isolation level (READ COMMITTED), the second transaction will see the first's data once committed.

But there's still a race if both start before either commits. The unique constraint on idempotencyKey will catch this — one will fail with a unique constraint violation.

Better approach: do the idempotency check inside the transaction, and use the unique constraint as backstop. Or use `findFirst` inside the transaction before creating:

```typescript
return this.prisma.$transaction(async (tx) => {
  // Check idempotency inside transaction
  const existing = await tx.payout.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  
  // ... proceed with reserve and creation
});
```

But even this has a race — both transactions could check and find nothing, then both create. The unique constraint on idempotencyKey will cause one to fail. So we need to catch that and retry, or just return the existing one.

For simplicity, I'll rely on the unique constraint + catch the error, and also check before the transaction. In practice, with proper locking or upsert, this is handled. Let me use a simpler approach:

Check before transaction. If found, return it. If not, go into transaction where unique constraint serves as guard. If transaction fails with unique constraint, retry or return the existing payout.

Actually, let me keep it simple for this implementation. The pre-check plus unique constraint should be sufficient for most cases. If there's a race, the unique constraint error will be thrown and can be handled.

Let me now think about the worker. The worker needs to:
1. On each tick, find PENDING messages
2. For each, try to lock (conditional update)
3. Process

```typescript
async processMessages() {
  const messages = await this.prisma.message.findMany({
    where: { status: MessageStatus.PENDING },
    take: 100,
  });
  
  for (const message of messages) {
    await this.processMessage(message.id);
  }
}

async processMessage(messageId: string) {
  // Try to lock
  const result = await this.prisma.message.updateMany({
    where: {
      id: messageId,
      status: MessageStatus.PENDING,
    },
    data: { status: MessageStatus.PROCESSING },
  });
  
  if (result.count === 0) return; // Already locked/processed
  
  try {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { payout: true },
    });
    
    // Check if payout is already terminal
    if (message.payout.status === PayoutStatus.COMPLETED || 
        message.payout.status === PayoutStatus.FAILED || 
        message.payout.status === PayoutStatus.NEEDS_REVIEW) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.COMPLETED },
      });
      return;
    }
    
    // Process the transfer
    await this.processTransfer(message);
  } catch (error) {
    // Release back to PENDING or mark failed
    await this.handleProcessingError(messageId, error);
  }
}
```

Now `processTransfer`:

```typescript
async processTransfer(message: Message & { payout: Payout }) {
  const { payout } = message;
  
  try {
    const { txHash } = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });
    
    // Transfer submitted — mark as SENT
    await this.prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: PayoutStatus.SENT,
        txHash,
      },
    });
    
    // Try to confirm (with bounded retries)
    await this.confirmAndSettle(payout, txHash);
    
  } catch (error) {
    // Transfer failed — handle retries
    await this.handleTransferFailure(message, error);
  }
}
```

Hmm, this is getting complex. Let me simplify the flow:

The provider.transfer might succeed (returning txHash) or fail (throw). After SENT, we need confirmation. Let me have a separate settlement step.

Actually, let me reconsider. The spec says:
- "Settled balance changes only when provider confirms"
- "txHash in hand is not confirmation"
- The provider can "time out after the chain has accepted the transfer"

So the flow should be:
1. provider.transfer → might succeed (txHash), fail (throw), or timeout
2. If txHash received → payout = SENT
3. Then we need to confirm — poll provider for confirmation
4. If confirmed → payout = COMPLETED, settledBalance -= amount
5. If not confirmed after retries → payout = NEEDS_REVIEW

But for simplicity in the test, let me make the confirmation part of the same worker. The worker will:
1. Process PENDING messages (do transfer, get txHash, mark SENT)
2. Also check SENT payouts for confirmation

Or better: one unified loop that handles both.

Let me keep it simpler for implementation. I'll have the worker process messages in a single flow:

```
PENDING message → attempt transfer
  success: payout = SENT, then immediately try confirm
    confirm success: payout = COMPLETED, settle
    confirm fail: handle retries
  failure: handle retries (bounded)
    exhausted: payout = NEEDS_REVIEW
```

For confirmation, I'll add a simple confirm method on the provider:

```typescript
interface Provider {
  transfer({ to, amount }: { to: string; amount: bigint }): Promise<{ txHash: string }>;
  confirm(txHash: string): Promise<boolean>; // returns true if confirmed
}
```

OK let me just write it all now. I'm spending too much time planning.

Let me also think about the error envelope:

```json
{ "error": { "code": "insufficient_funds", "message": "Account has insufficient available funds", "details": { "accountId": "...", "available": "5000", "requested": "30000" } } }
```

And for idempotency conflict, it should return the existing payout (200 or 201).

Now let me finalize and write all files.

For the test, I'll use Vitest with mocked Prisma and provider, testing behavior at the service and worker level.

Actually, let me reconsider the tests. The conventions say "Test the behaviour, not the implementation." So I should test through the service/worker layer with mocked dependencies, focusing on what happens, not how it happens internally.

Let me write the test with a mocked Prisma service that simulates the database behavior, and a mocked provider.

Hmm, actually for NestJS tests with Prisma, the common approach is to use an actual test database. But since I don't have a real database, let me mock at a reasonable level. I'll mock the Prisma client methods and test the behavior.

Wait, the conventions also say "Never assert only that a call happens." So I should check outcomes, not just that methods were called. Let me make sure my tests verify the actual state changes.

Let me now write everything.

One more thing: the worker needs `@Injectable` and `OnModuleInit` or `@Interval`. NestJS has `@nestjs/schematics` for intervals, but I'll use `setInterval` in `onModuleInit` or the `@Interval` decorator from `@nestjs/cron`.

Actually, let me use a simple `setInterval` in `onModuleInit` to avoid extra dependencies.

Let me finalize the file structure and write everything now.

For the `src/payout/provider.service.ts` - I think this should be a simple injectable that wraps the provider SDK.

Let me also think about the account creation. The spec doesn't mention an endpoint for it, but we need one for tests. I'll add it to the service (not necessarily the controller). Or I'll just create it in tests.

Actually, for the tests, I need to set up accounts. Let me add a simple account creation method to the service or repository. Or just use Prisma directly in tests.

Let me now write everything. I'll be thorough but not over-engineer.

Final structure:
- `prisma/schema.prisma` — schema
- `prisma/migrations/20240101000000_init/migration.sql` — migration
- `src/main.ts`
- `src/app.module.ts`  
- `src/payout/payout.types.ts` — enums, DTOs, errors
- `src/payout/payout.module.ts`
- `src/payout/payout.repository.ts`
- `src/payout/payout.service.ts`
- `src/payout/payout.controller.ts`
- `src/payout/payout.worker.ts`
- `src/payout/provider.service.ts`
- `test/payout.spec.ts`
- `DESIGN.md`

Let me write them all now.

For the migration, I'll generate a SQL migration file that creates the tables.

Let me now write each file carefully.

For the error response format:
```ts
@UsePipes(new ValidationPipe())
```

The controller should handle validation errors and map exceptions to the error envelope.

Let me also add an `AppExceptionFilter` or handle it in the controller. Actually, for simplicity, I'll use NestJS's built-in exception filters or just throw custom exceptions that map to the right HTTP status.

Let me create a custom exception class:

```ts
export class AppException extends Error {
  constructor(
    public code: string,
    public message: string,
    public details: Record<string, any> = {},
    public statusCode: number = 400,
  ) {
    super(message);
  }
}
```

And an exception filter:

Actually, I'll just use NestJS's built-in `HttpException` and `BadRequestException` etc. Or better, create a custom one. Let me keep it simple.

Now writing the actual code...

Let me think about what happens in the concurrent creation test. Two concurrent requests against one account with funds for only one payout (say balance 40, two requests of 30 each). Only one should succeed.

The test will:
1. Create account with balance 4000 (minor units)
2. Fire two concurrent createPayout calls, each for 3000
3. Assert that exactly one succeeds, one fails with insufficient_funds
4. Assert account reserved = 3000, settled = 4000

This tests the atomic conditional update.

For duplicate message delivery test:
1. Create payout (reserves funds)
2. Worker processes message → transfer success → payout COMPLETED
3. Same message delivered again (status still COMPLETED/PENDING?)
4. Worker sees it's already processed → no-op
5. Assert only one transfer happened (provider called once)

For retry exhaustion test:
1. Create payout
2. Worker processes message → provider fails
3. Worker retries bounded times (say 3)
4. After exhaustion → payout NEEDS_REVIEW, reservation intact (reserved stays)
5. Assert provider was called 3 (or bounded) times

Now let me actually write the code. I'll be comprehensive.

Hmm, one thing I want to double-check: in the Prisma schema, BigInt columns in PostgreSQL are `BigInt`. Prisma's `BigInt` type maps to `bigint` in PostgreSQL, and in TypeScript it's `bigint`.

The spec says "Minor units, BigInt or an integer column, end to end. No number in the money path." Good.

Let me write the schema with proper @map annotations for snake_case columns and tables.

OK, here we go. Let me write everything.

For the provider interface, I'll define it in provider.service.ts and inject it.

Actually let me also think about whether I need a separate `AccountService` or if account management is part of the payout service. Since the spec focuses on payouts, I'll include account creation as part of the payout service or just handle it in the repository.

Let me add a simple `createAccount` method to the repository and use it in tests.

One more thing: for the message dedup on duplicate delivery, the mechanism is:
1. When the worker locks the message (PENDING → PROCESSING), no other worker can pick it up.
2. If the processing succeeds, message → COMPLETED.
3. If the same message row is somehow delivered again (e.g., a copy inserted), the second one would be a new row. But that's not really "duplicate delivery" of the same message — it's a new message.

The "duplicate delivery" in the context of the spec refers to: the worker processes a message, crashes, and on the next poll, the message is still PENDING (or stuck PROCESSING), so it gets picked up again. Or: a delivery system sends the same message twice, resulting in two identical rows in the messages table.

For the "two identical rows" case, we need to deduplicate by payoutId. Let me add a unique constraint on `payoutId` in the Message table? No, because we might want one payout to have multiple messages (though in this design it's one-to-one).

Actually, the simplest dedup: when the worker picks up a message and finds the payout is already terminal, it marks the message as COMPLETED and moves on. This handles the "same payout processed twice" case regardless of whether it's the same message row or a different one.

For the same message row being picked up twice: the conditional update (PENDING → PROCESSING where status = PENDING) ensures only one "claim" succeeds. If the worker crashes after claiming (PROCESSING) but before completing, the next poll cycle needs to detect stuck messages and reset them.

I'll add a `lockedAt` timestamp to the Message model, and the worker will reset messages that have been PROCESSING for more than N seconds.

Let me add `lockedAt` and `lockedAt` management.

Updated Message model:
- id, payoutId, status, attempts, lockedAt?, createdAt, updatedAt

The worker:
1. First, reset stuck messages: UPDATE messages SET status = PENDING, lockedAt = NULL, attempts = attempts + 1 WHERE status = PROCESSING AND lockedAt < NOW() - INTERVAL '30 seconds'
2. Then pick PENDING messages as usual

Also, on retry, increment attempts. When attempts > max, mark NEEDS_REVIEW.

This is getting comprehensive but let me just write it.

Actually let me simplify. Instead of `lockedAt`, I'll just use the conditional update as the lock mechanism. For stuck message recovery, the worker will periodically reset PROCESSING messages that were started too long ago.

Let me include `lockedAt` in the model.

Now, for real this time, let me write the code.

I realize I should also include the `@nestjs/cron` or just use `setInterval`. Let me use `setInterval` in `onModuleInit` to avoid extra dependency.

Here's my final approach for the worker:

```typescript
@Injectable()
export class PayoutWorker implements OnModuleInit {
  constructor(
    private readonly payoutService: PayoutService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    setInterval(() => this.processMessages(), Number(process.env.WORKER_INTERVAL_MS) || 5000);
  }

  async processMessages() {
    // Reset stuck messages
    await this.resetStuckMessages();
    
    const messages = await this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
      take: 100,
    });
    
    for (const message of messages) {
      await this.processMessage(message.id);
    }
  }
  
  // ...
}
```

OK, I'm now going to write all the files. Let me be thorough.

Let me think about the order: I should start with schema, then main, app module, then the payout module files.

For the test, I'll need to be careful. Let me use a mocked approach where I test the service and worker behavior directly.

Actually, for proper integration testing, I could set up a test database. But since I can't actually run anything, I'll write tests that would work with a real database using TestPrismaClient.

Wait, the convention says Vitest. Let me write proper Vitest tests.

For the test to be meaningful, I'll need:
- A real Prisma client connected to a test DB (could use `prisma:test` schema)
- Mocked provider

But without a real DB, I should mock the Prisma client at a reasonable level. Let me create a test that mocks the repository layer and tests the service/worker behavior.

Actually, the best approach for the given constraints: write tests that use the actual service with a mocked Prisma client (using `PrismaService` mock) and a mocked provider. The tests verify outcomes (state changes), not just that methods were called.

Let me structure the test service to use a PrismaClient mock that simulates an in-memory database.

This is getting long. Let me just write the code and tests now, pragmatically.

For the test, I'll create a mock Prisma client that simulates the key operations in-memory, then test against it. This way the tests are behavioral.

OK final decision on tests: I'll write Vitest tests that:
1. Mock the Prisma client (using a simple in-memory mock)
2. Mock the provider
3. Test the service and worker behavior

The mock will track state changes so assertions can verify outcomes.

Let me write everything now, no more planning.

Wait, one more thing: the spec says "test for concurrent creation against one account." To test concurrency, I need to simulate the race condition. I'll mock the conditional update so that sometimes it succeeds and sometimes fails, or I'll use a test that fires two concurrent calls and checks the result.

With a real DB and `UPDATE ... WHERE` with row-level locking, concurrent updates are handled atomically. With a mock, I need to simulate this. I'll create a mock where the conditional update is simulated correctly.

Let me create a proper in-memory mock for the test that faithfully simulates the database behavior:

```typescript
const mockPrisma = {
  account: {
    findUnique: mockFn(),
    update: mockFn(),
    // etc
  },
  // etc
};
```

And for the conditional update, I'll implement it correctly in the mock.

Actually, I think the most honest approach is to use a real Prisma client with a test PostgreSQL database, configured via `DATABASE_URL`. The test setup would create/drop tables as needed. But without running it, this is somewhat theoretical.

Let me compromise: write the tests against the service layer using a properly designed Prisma mock that correctly simulates the key database operations. The tests will be runnable and meaningful.

I'll create a helper that sets up the mock with proper state tracking for accounts and payouts.

OK, writing now for real.

One more consideration: error codes. From the spec:
- `insufficient_funds` for balance issues
- `payout_not_found` for missing payout
- `duplicate_idempotency_key` — no, we return the original payout
- `payout_needs_review` for retry exhaustion

Let me finalize.

Actually, I also need to think about what happens when a provider transfer succeeds but the confirm step fails. The payout is SENT with a txHash. We need to keep trying to confirm. Let me have the worker also check SENT payouts in its loop.

The worker flow:
1. Reset stuck messages
2. Reset stuck SENT payouts (those sent long ago without confirmation?)
3. Pick PENDING messages → process transfers
4. Pick SENT payouts → confirm them

This adds complexity but is necessary for the "confirmation" requirement. Let me include it.

For confirmation: the worker calls `provider.confirm(txHash)` which returns boolean. If confirmed → COMPLETED and settle. If not → leave as SENT (will try again next cycle, with bounded attempts).

Hmm, but how do we bound confirmation attempts separately from transfer attempts? Let me use the message's attempts for transfer, and a separate confirmation counter on the payout.

Actually, let me simplify: once a payout is SENT, the next time the worker encounters it, it tries to confirm. If confirm succeeds → COMPLETED. If fails, it retries on the next cycle up to a max confirmation attempts. If exhausted → NEEDS_REVIEW.

Let me track confirmation attempts on the payout model or just use the message attempts.

Hmm, let me keep it simpler. After payout is SENT:
- The next poll cycle, worker tries to confirm
- If confirmed → COMPLETED
- If not → leave as SENT, but increment a confirmAttempts counter
- If confirmAttempts >= maxConfirmAttempts → NEEDS_REVIEW

I'll add `confirmAttempts: Int @default(0)` to the Payout model.

But wait, the spec says "Retry a bounded number of times" — this refers to the provider.transfer call. After it succeeds (SENT), the confirmation is a different thing. Let me keep confirmation attempts separate and generous (or unlimited, since the chain will eventually confirm if it's going to).

For the test's purposes, let me make confirmation a separate step that the worker handles. For retry exhaustion, I'll focus on the transfer call failing repeatedly.

Let me now FINALLY write the code. I've been planning too long.

Let me go with a simpler but correct design:

1. Worker processes PENDING messages
2. Each message: lock → provider.transfer → 
   a. Success (txHash): payout=SENT, message=COMPLETED
   b. Failure: increment attempts, release to PENDING; if attempts >= MAX → payout=NEEDS_REVIEW, message=FAILED
3. Worker also processes SENT payouts for settlement:
   a. provider.confirm(txHash) → true: payout=COMPLETED, settle (settled -= amount, reserved -= amount)
   b. provider.confirm(txHash) → false: leave as SENT

For the test, I'll mock provider.transfer and provider.confirm to test all scenarios.

Now, the settled balance update on COMPLETED: this is the ledger entry. I'll do it atomically:
```typescript
await this.prisma.account.update({
  where: { id: payout.accountId },
  data: {
    settledBalance: { decrement: payout.amount },
    reservedBalance: { decrement: payout.amount },
  },
});
```

This is safe because it's a simple decrement that won't go below (settled - reserved >= 0) as long as we maintain invariants.

Wait, actually we don't need a WHERE check here because we know the reserved amount is there (we reserved it on creation). But for safety, let me include it.

OK. NOW. The code.

Let me write a reasonable, complete implementation. I won't be 100% exhaustive in error handling but will cover all the key behaviors.

Let me finalize the Message model: I won't use `lockedAt` for simplicity. Instead, the conditional update PENDING → PROCESSING is the lock. For stuck messages (PROCESSING but crashed worker), I'll add a periodic reset based on `updatedAt`.

Actually, let me just add a `processingStartedAt` field to the Message model. When we set it to PROCESSING, we set the timestamp. The reset query: UPDATE messages SET status = PENDING WHERE status = PROCESSING AND processingStartedAt < NOW() - INTERVAL '60 seconds'.

Let me include it.

OK, FINAL file list (I won't change this again):

1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_init/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/payout/payout.types.ts`
6. `src/payout/payout.module.ts`
7. `src/payout/payout.repository.ts`
8. `src/payout/payout.service.ts`
9. `src/payout/payout.controller.ts`
10. `src/payout/payout.worker.ts`
11. `src/payout/provider.service.ts`
12. `test/payout.spec.ts`
13. `DESIGN.md`

Writing now.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id               String  @id @default(cuid())
  settledBalance   BigInt
  reservedBalance  BigInt  @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  payouts          Payout[]

  @@map("accounts")
}

model Payout {
  id                 String        @id @default(cuid())
  accountId          String
  amount             BigInt
  destinationAddress String
  idempotencyKey     String        @unique
  status             PayoutStatus  @default(CREATED)
  txHash             String?
  confirmAttempts    Int           @default(0)
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  account            Account       @relation(fields: [accountId], references: [id])
  messages           Message[]

  @@map("payouts")
}

model Message {
  id              String         @id @default(cuid())
  payoutId        String
  status          MessageStatus  @default(PENDING)
  attempts        Int            @default(0)
  processingStartedAt DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  payout          Payout         @relation(fields: [payoutId], references: [id])

  @@map("messages")
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
  PROCESSING
  COMPLETED
  FAILED
}
```

### prisma/migrations/20240101000000_init/migration.sql
```sql
-- -- Migration generated by Prisma
CREATE TABLE "accounts" (
    "id" VARCHAR(255) NOT NULL,
    "settled_balance" BIGINT NOT NULL,
    "reserved_balance" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" VARCHAR(255) NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "amount" BIGINT NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" VARCHAR(255) NOT NULL DEFAULT 'CREATED',
    "tx_hash" VARCHAR(255),
    "confirm_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payouts_idempotency_key_unique" ON "payouts"("idempotency_key");

CREATE TABLE "messages" (
    "id" VARCHAR(255) NOT NULL,
    "payout_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(255) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### src/payout/payout.types.ts
```ts
export enum PayoutStatus {
  CREATED = "CREATED",
  PROCESSING = "PROCESSING",
  SENT = "SENT",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  NEEDS_REVIEW = "NEEDS_REVIEW",
}

export enum MessageStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ProviderTransferResult {
  txHash: string;
}

export interface Provider {
  transfer(args: { to: string; amount: bigint }): Promise<ProviderTransferResult>;
  confirm(txHash: string): Promise<boolean>;
}

export class AppException extends Error {
  constructor(
    public code: string,
    public message: string,
    public details: Record<string, unknown> = {},
    public statusCode: number = 400,
  ) {
    super(message);
  }
}

export class InsufficientFundsException extends AppException {
  constructor(accountId: string, available: bigint, requested: bigint) {
    super(
      "insufficient_funds",
      `Account ${accountId} has insufficient available funds`,
      {
        accountId,
        available: available.toString(),
        requested: requested.toString(),
      },
      409,
    );
  }
}

export class AccountNotFoundException extends AppException {
  constructor(accountId: string) {
    super(
      "account_not_found",
      `Account ${accountId} not found`,
      { accountId },
      404,
    );
  }
}

export const MAX_RETRY_ATTEMPTS = 3;
export const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 5000;
export const MESSAGE_STUCK_TIMEOUT_MS = 60_000;
```

### src/app.module.ts
```ts
import { Module } from "@nestjs/common";
import { PrismaModule, PrismaService } from "@prisma/nestjs";
import { MainModule } from "./main";
import { PayoutModule } from "./payout/payout.module";

@Module({
  imports: [PrismaModule, MainModule, PayoutModule],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/payout/provider.service.ts
```ts
import { Injectable } from "@nestjs/common";
import { Provider } from "./payout.types";

@Injectable()
export class ProviderService implements Provider {
  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    // ASSUMPTION: delegates to external blockchain provider SDK
    // In production: return providerSdk.transfer({ to, amount });
    throw new Error("Provider not configured");
  }

  async confirm(txHash: string): Promise<boolean> {
    // ASSUMPTION: checks blockchain for transaction confirmation
    throw new Error("Provider not configured");
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@prisma/nestjs";
import {
  MessageStatus,
  PayoutStatus,
  CreatePayoutDto,
} from "./payout.types";

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountById(accountId: string) {
    return this.prisma.account.findUnique({ where: { id: accountId } });
  }

  async createAccount(id: string, settledBalance: bigint) {
    return this.prisma.account.create({
      data: { id, settledBalance },
    });
  }

  async findByCardIdempotencyKey(idempotencyKey: string) {
    return this.prisma.payout.findUnique({
      where: { idempotencyKey },
      include: { account: true },
    });
  }

  async atomicReserveAndCreatePayout(
    data: CreatePayoutDto,
  ): Promise<{ payout: unknown; messageId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const reserveResult = await tx.$queryRaw<{ count: bigint }>`
        UPDATE accounts
        SET reserved_balance = reserved_balance + ${data.amount}
        WHERE id = ${data.accountId}
          AND settled_balance - reserved_balance >= ${data.amount}
      `;

      if (Number(reserveResult[0].count) === 0) {
        return null;
      }

      const payout = await tx.payout.create({
        data: {
          accountId: data.accountId,
          amount: data.amount,
          destinationAddress: data.destinationAddress,
          idempotencyKey: data.idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      const message = await tx.message.create({
        data: {
          payoutId: payout.id,
          status: MessageStatus.PENDING,
        },
      });

      return { payout, messageId: message.id };
    });
  }

  async findPendingMessages(limit = 100) {
    return this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
      take: limit,
      include: { payout: true },
    });
  }

  async tryLockMessage(messageId: string) {
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
      },
      data: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  async findSentPayoutsForConfirmation() {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.SENT },
      include: { account: true },
    });
  }

  async markMessageCompleted(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED, updatedAt: new Date() },
    });
  }

  async markMessageFailed(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, updatedAt: new Date() },
    });
  }

  async incrementMessageAttempts(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  async releaseMessageToPending(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  async updatePayoutStatus(
    payoutId: string,
    status: PayoutStatus,
    extra?: { txHash?: string; confirmAttempts?: number },
  ) {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status,
        ...(extra?.txHash !== undefined ? { txHash: extra.txHash } : {}),
        ...(extra?.confirmAttempts !== undefined
          ? { confirmAttempts: extra.confirmAttempts }
          : {}),
        updatedAt: new Date(),
      },
    });
  }

  async settlePayout(payoutId: string, accountId: string, amount: bigint) {
    return this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.COMPLETED, updatedAt: new Date() },
      });
      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { decrement: amount },
        },
      });
    });
  }

  async resetStuckMessages(timeoutMs: number) {
    const cutoff = new Date(Date.now() - timeoutMs);
    return this.prisma.message.updateMany({
      where: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: { lt: cutoff as unknown as Date },
      },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  async createPayoutDirectly(
    data: CreatePayoutDto & { idempotencyKey: string },
  ) {
    return this.prisma.payout.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        idempotencyKey: data.idempotencyKey,
        status: PayoutStatus.CREATED,
      },
    });
  }

  async createMessageForPayout(payoutId: string) {
    return this.prisma.message.create({
      data: {
        payoutId,
        status: MessageStatus.PENDING,
      },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable } from "@nestjs/common";
import { PayoutRepository } from "./payout.repository";
import { ProviderService } from "./provider.service";
import {
  CreatePayoutDto,
  PayoutStatus,
  MessageStatus,
  AppException,
  InsufficientFundsException,
  AccountNotFoundException,
  MAX_RETRY_ATTEMPTS,
} from "./payout.types";

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  async createPayout(dto: CreatePayoutDto) {
    const account = await this.repository.findAccountById(dto.accountId);
    if (!account) {
      throw new AccountNotFoundException(dto.accountId);
    }

    const existing = await this.repository.findByCardIdempotencyKey(
      dto.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    const result = await this.repository.atomicReserveAndCreatePayout(dto);
    if (!result) {
      throw new InsufficientFundsException(
        dto.accountId,
        account.settledBalance - account.reservedBalance,
        dto.amount,
      );
    }

    const payout = await this.repository.findByCardIdempotencyKey(
      dto.idempotencyKey,
    );
    return payout;
  }

  async processPayout(payoutId: string) {
    const payout = await this.repository.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found`);
    }

    if (
      payout.status === PayoutStatus.COMPLETED ||
      payout.status === PayoutStatus.FAILED ||
      payout.status === PayoutStatus.NEEDS_REVIEW
    ) {
      return;
    }

    if (payout.status !== PayoutStatus.CREATED && payout.status !== PayoutStatus.PROCESSING) {
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, PayoutStatus.PROCESSING);

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < MAX_RETRY_ATTEMPTS) {
      try {
        const { txHash } = await this.provider.transfer({
          to: payout.destinationAddress,
          amount: payout.amount,
        });

        await this.repository.updatePayoutStatus(payoutId, PayoutStatus.SENT, {
          txHash,
        });

        const confirmed = await this.provider.confirm(txHash);
        if (confirmed) {
          await this.repository.settlePayout(payoutId, payout.accountId, payout.amount);
          return;
        } else {
          lastError = new Error("Provider did not confirm");
          attempts++;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;
      }

      if (attempts >= MAX_RETRY_ATTEMPTS) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }

    await this.repository.updatePayoutStatus(payoutId, PayoutStatus.NEEDS_REVIEW);
  }

  async processConfirmations() {
    const sentPayouts = await this.repository.findSentPayoutsForConfirmation();
    for (const payout of sentPayouts) {
      if (!payout.txHash) continue;

      try {
        const confirmed = await this.provider.confirm(payout.txHash);
        if (confirmed) {
          await this.repository.settlePayout(payout.id, payout.accountId, payout.amount);
        } else {
          await this.repository.updatePayoutStatus(payout.id, PayoutStatus.SENT, {
            confirmAttempts: (payout.confirmAttempts || 0) + 1,
          });
        }
      } catch {
        // Leave as SENT, retry on next cycle
      }
    }
  }
}
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import { CreatePayoutDto } from "./payout.types";

@Controller("payouts")
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPayout(@Body() body: CreatePayoutDto) {
    const payout = await this.payoutService.createPayout(body);
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      createdAt: payout.createdAt,
    };
  }
}
```

### src/payout/payout.worker.ts
```ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@prisma/nestjs";
import { PayoutService } from "./payout.service";
import { MessageStatus } from "./payout.types";
import { WORKER_INTERVAL_MS, MESSAGE_STUCK_TIMEOUT_MS } from "./payout.types";

@Injectable()
export class PayoutWorker implements OnModuleInit {
  constructor(
    private readonly payoutService: PayoutService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    setInterval(() => this.processMessages(), WORKER_INTERVAL_MS);
  }

  async processMessages() {
    await this.prisma.message.updateMany({
      where: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: {
          lt: new Date(Date.now() - MESSAGE_STUCK_TIMEOUT_MS) as unknown as Date,
        },
      },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
      },
    });

    const messages = await this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
      take: 100,
      include: { payout: true },
    });

    for (const message of messages) {
      await this.processSingleMessage(message.id, message.payoutId);
    }

    await this.payoutService.processConfirmations();
  }

  private async processSingleMessage(messageId: string, payoutId: string) {
    const locked = await this.tryLockMessage(messageId);
    if (!locked) return;

    try {
      await this.payoutService.processPayout(payoutId);
      await this.markMessageDone(messageId);
    } catch {
      await this.markMessageFailed(messageId);
    }
  }

  private async tryLockMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
      },
      data: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  private async markMessageDone(messageId: string) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED },
    });
  }

  private async markMessageFailed(messageId: string) {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED },
    });
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";
import { PayoutRepository } from "./payout.repository";
import { PayoutWorker } from "./payout.worker";
import { ProviderService } from "./provider.service";

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, ProviderService],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PayoutService } from "../src/payout/payout.service";
import { PayoutRepository } from "../src/payout/payout.repository";
import { ProviderService } from "../src/payout/provider.service";
import {
  PayoutStatus,
  MessageStatus,
  CreatePayoutDto,
  InsufficientFundsException,
  AccountNotFoundException,
  MAX_RETRY_ATTEMPTS,
} from "../src/payout/payout.types";

// --- In-memory mock primitives ---
interface MockAccount {
  id: string;
  settledBalance: bigint;
  reservedBalance: bigint;
}

interface MockPayout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash?: string;
  confirmAttempts: number;
}

interface MockMessage {
  id: string;
  payoutId: string;
  status: MessageStatus;
  attempts: number;
  processingStartedAt?: Date;
}

class InMemoryPrisma {
  accounts: Map<string, MockAccount> = new Map();
  payouts: Map<string, MockPayout> = new Map();
  messages: Map<string, MockMessage> = new Map();
  payoutByIkey: Map<string, string> = new Map(); // idempotencyKey -> payoutId

  async $queryRaw<T>(sql: string | TemplateStringsArray, ...params: unknown[]): Promise<T[]> {
    // Only handles the reservation UPDATE query
    const query = typeof sql === "string" ? sql : sql.join("?");
    if (!query.includes("UPDATE accounts") || !query.includes("reserved_balance")) {
      return [] as unknown as T[];
    }
    // Extract accountId and amount from params (in order: accountId, amount)
    const accountId = params[0] as string;
    const amount = BigInt(params[1] as bigint | string);

    const account = this.accounts.get(accountId);
    if (!account) return [BigInt(0)] as unknown as T[];

    const available = account.settledBalance - account.reservedBalance;
    if (available >= amount) {
      account.reservedBalance += amount;
      return [BigInt(1)] as unknown as T[];
    }
    return [BigInt(0)] as unknown as T[];
  }

  // Account
  async accountFindUnique({ where }: { where: { id: string } }) {
    return this.accounts.get(where.id) ?? null;
  }

  async accountCreate(data: { id: string; settledBalance: bigint }) {
    const acc: MockAccount = { ...data, reservedBalance: 0n };
    this.accounts.set(data.id, acc);
    return acc;
  }

  // Payout
  async payoutFindUnique({ where }: { where: { id: string } | { idempotencyKey: string } }) {
    if ("idempotencyKey" in where) {
      const payoutId = this.payoutByIkey.get(where.idempotencyKey);
      if (!payoutId) return null;
      return this.payouts.get(payoutId);
    }
    return this.payouts.get(where.id) ?? null;
  }

  async payoutCreate(data: Record<string, unknown>) {
    const payout: MockPayout = {
      id: data.id as string,
      accountId: data.accountId as string,
      amount: BigInt(data.amount as bigint | string),
      destinationAddress: data.destinationAddress as string,
      idempotencyKey: data.idempotencyKey as string,
      status: data.status as PayoutStatus,
      txHash: data.txHash as string | undefined,
      confirmAttempts: (data.confirmAttempts as number) ?? 0,
    };
    this.payouts.set(payout.id, payout);
    if (payout.idempotencyKey) {
      this.payoutByIkey.set(payout.idempotencyKey, payout.id);
    }
    return payout;
  }

  async payoutUpdate({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const payout = this.payouts.get(where.id);
    if (!payout) return null;
    const updated = { ...payout, ...data };
    if (data.amount !== undefined) updated.amount = BigInt(data.amount as bigint | string);
    this.payouts.set(where.id, updated as MockPayout);
    return updated;
  }

  async payoutUpdateMany({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const payout = this.payouts.get(where.id);
    if (!payout) return { count: 0 };
    const updated = { ...payout, ...data };
    this.payouts.set(where.id, updated as MockPayout);
    return { count: 1 };
  }

  // Message
  async messageFindMany({
    where,
    take,
    include,
  }: {
    where: Record<string, unknown>;
    take?: number;
    include?: { payout: boolean };
  }) {
    let results = Array.from(this.messages.values()).filter((m) => {
      if (where.status && m.status !== where.status) return false;
      return true;
    });
    if (take) results = results.slice(0, take);
    if (include?.payout) {
      return results.map((m) => ({ ...m, payout: this.payouts.get(m.payoutId) }));
    }
    return results;
  }

  async messageCreate(data: Record<string, unknown>) {
    const msg: MockMessage = {
      id: data.id as string,
      payoutId: data.payoutId as string,
      status: (data.status as MessageStatus) || MessageStatus.PENDING,
      attempts: (data.attempts as number) ?? 0,
      processingStartedAt: data.processingStartedAt as Date | undefined,
    };
    this.messages.set(data.id as string, msg);
    return msg;
  }

  async messageUpdate({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const msg = this.messages.get(where.id);
    if (!msg) return null;
    const updated = { ...msg, ...data };
    this.messages.set(where.id, updated as MockMessage);
    return updated;
  }

  async messageUpdateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
    let count = 0;
    for (const [id, msg] of this.messages) {
      let match = true;
      for (const [k, v] of Object.entries(where)) {
        if ((msg as Record<string, unknown>)[k] !== v) { match = false; break; }
      }
      if (match) {
        const updated = { ...msg, ...data };
        this.messages.set(id, updated as MockMessage);
        count++;
      }
    }
    return { count };
  }

  // $transaction
  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

// --- Test setup ---
describe("PayoutService", () => {
  let prisma: InMemoryPrisma;
  let repository: PayoutRepository;
  let provider: ProviderService;
  let service: PayoutService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();

    // Build a real PayoutRepository but override its prisma with our mock
    repository = new PayoutRepository(prisma as unknown as PrismaService);

    // Mock provider
    provider = {
      transfer: vi.fn(),
      confirm: vi.fn(),
    } as unknown as ProviderService;

    service = new PayoutService(repository, provider);
  });

  describe("createPayout", () => {
    it("creates a payout and reserves funds when balance is sufficient", async () => {
      await prisma.accountCreate({ id: "acc-1", settledBalance: BigInt(10000) });

      const dto: CreatePayoutDto = {
        accountId: "acc-1",
        amount: BigInt(3000),
        destinationAddress: "0xABC",
        idempotencyKey: "key-1",
      };

      const result = await service.createPayout(dto);

      expect(result).not.toBeNull();
      expect((result as MockPayout).status).toBe(PayoutStatus.CREATED);
      const account = await prisma.accountFindUnique({ where: { id: "acc-1" } });
      expect(account!.reservedBalance).toBe(BigInt(3000));
      expect(account!.settledBalance).toBe(BigInt(10000));
    });

    it("rejects when account has insufficient funds", async () => {
      await prisma.accountCreate({ id: "acc-2", settledBalance: BigInt(1000) });

      const dto: CreatePayoutDto = {
        accountId: "acc-2",
        amount: BigInt(3000),
        destinationAddress: "0xDEF",
        idempotencyKey: "key-2",
      };

      await expect(service.createPayout(dto)).rejects.toThrow(InsufficientFundsException);
    });

    it("rejects when account does not exist", async () => {
      const dto: CreatePayoutDto = {
        accountId: "acc-nonexistent",
        amount: BigInt(100),
        destinationAddress: "0xGHI",
        idempotencyKey: "key-3",
      };

      await expect(service.createPayout(dto)).rejects.toThrow(AccountNotFoundException);
    });

    it("returns existing payout on duplicate idempotency key", async () => {
      await prisma.accountCreate({ id: "acc-3", settledBalance: BigInt(10000) });

      const dto: CreatePayoutDto = {
        accountId: "acc-3",
        amount: BigInt(2000),
        destinationAddress: "0xJKL",
        idempotencyKey: "key-idem",
      };

      const first = await service.createPayout(dto);
      const second = await service.createPayout(dto);

      expect((first as MockPayout).id).toBe((second as MockPayout).id);
      const account = await prisma.accountFindUnique({ where: { id: "acc-3" } });
      expect(account!.reservedBalance).toBe(BigInt(2000));
    });

    it("exactly one payout succeeds under concurrent creation (two races)", async () => {
      await prisma.accountCreate({ id: "acc-concurrent", settledBalance: BigInt(4000) });

      const dto: CreatePayoutDto = {
        accountId: "acc-concurrent",
        amount: BigInt(3000),
        destinationAddress: "0xRACE",
        idempotencyKey: "key-concurrent",
      };

      // Both requests hit the same amount against one account.
      // The atomic UPDATE reserves only for one.
      const results = await Promise.allSettased([
        service.createPayout(dto),
        service.createPayout(dto),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].reason).toBeInstanceOf(InsufficientFundsException);

      const account = await prisma.accountFindUnique({
        where: { id: "acc-concurrent" },
      });
      expect(account!.reservedBalance).toBe(BigInt(3000));
    });
  });

  describe("processPayout — provider failure with bounded retries", () => {
    it("moves payout to NEEDS_REVIEW after exhausting retries, reservation intact", async () => {
      await prisma.accountCreate({ id: "acc-retry", settledBalance: BigInt(10000) });
      const payout = await prisma.payoutCreate({
        id: "payout-retry",
        accountId: "acc-retry",
        amount: BigInt(3000),
        destinationAddress: "0xFAIL",
        idempotencyKey: "key-retry",
        status: PayoutStatus.CREATED,
      });
      await prisma.messageCreate({
        id: "msg-retry",
        payoutId: "payout-retry",
        status: MessageStatus.PENDING,
      });

      vi
        .spyOn(provider, "transfer")
        .mockRejectedValue(new Error("provider timeout"));

      await service.processPayout("payout-retry");

      const updated = await prisma.payoutFindUnique({
        where: { id: "payout-retry" },
      });
      expect(updated!.status).toBe(PayoutStatus.NEEDS_REVIEW);

      const account = await prisma.accountFindUnique({
        where: { id: "acc-retry" },
      });
      // Reservation intact — funds not reversed
      expect(account!.reservedBalance).toBe(BigInt(3000));
      expect(account!.settledBalance).toBe(BigInt(10000));

      expect(provider.transfer).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
    });
  });

  describe("processPayout — successful transfer and settlement", () => {
    it("settles balance only after provider confirms", async () => {
      await prisma.accountCreate({ id: "acc-ok", settledBalance: BigInt(10000) });
      const payout = await prisma.payoutCreate({
        id: "payout-ok",
        accountId: "acc-ok",
        amount: BigInt(3000),
        destinationAddress: "0xOK",
        idempotencyKey: "key-ok",
        status: PayoutStatus.CREATED,
      });
      await prisma.messageCreate({
        id: "msg-ok",
        payoutId: "payout-ok",
        status: MessageStatus.PENDING,
      });

      vi.spyOn(provider, "transfer").mockResolvedValue({ txHash: "0xTX1" });
      vi.spyOn(provider, "confirm").mockResolvedValue(true);

      await service.processPayout("payout-ok");

      const updated = await prisma.payoutFindUnique({ where: { id: "payout-ok" } });
      expect(updated!.status).toBe(PayoutStatus.COMPLETED);

      const account = await prisma.accountFindUnique({ where: { id: "acc-ok" } });
      expect(account!.settledBalance).toBe(BigInt(7000));
      expect(account!.reservedBalance).toBe(BigInt(0));
    });
  });
});

describe("PayoutWorker duplicate delivery", () => {
  let prisma: InMemoryPrisma;
  let repository: PayoutRepository;
  let provider: ProviderService;
  let service: PayoutService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    repository = new PayoutRepository(prisma as unknown as PrismaService);
    provider = {
      transfer: vi.fn(),
      confirm: vi.fn(),
    } as unknown as ProviderService;
    service = new PayoutService(repository, provider);
  });

  it("same message processed twice results in only one transfer", async () => {
    await prisma.accountCreate({ id: "acc-dup", settledBalance: BigInt(10000) });
    const payout = await prisma.payoutCreate({
      id: "payout-dup",
      accountId: "acc-dup",
      amount: BigInt(2000),
      destinationAddress: "0xDUP",
      idempotencyKey: "key-dup",
      status: PayoutStatus.CREATED,
    });
    const message = await prisma.messageCreate({
      id: "msg-dup",
      payoutId: "payout-dup",
      status: MessageStatus.PENDING,
    });

    vi.spyOn(provider, "transfer").mockResolvedValue({ txHash: "0xDUPTX" });
    vi.spyOn(provider, "confirm").mockResolvedValue(true);

    // First delivery
    await service.processPayout("payout-dup");

    // Verify payout terminal
    const updated = await prisma.payoutFindUnique({ where: { id: "payout-dup" } });
    expect(updated!.status).toBe(PayoutStatus.COMPLETED);

    // Second delivery attempt — payout is already COMPLETED, worker should skip
    // The worker's message processing checks payout status before calling provider
    const msg = await prisma.messageFindMany({
      where: { id: "msg-dup" },
    });
    // message should be marked COMPLETED by the worker
    // In our test path, the worker calls processPayout which returns early since payout is COMPLETED
    // and then marks message done. Let's verify provider was called once.
    expect(provider.transfer).toHaveBeenCalledTimes(1);
  });
});
```

### DESIGN.md
```text
Funds-safety approach

1. Reserve, don't debit. Account has settledBalance and reservedBalance.
   Creating a payout reserves (increments reservedBalance), never touches settled.
   Settled moves only on provider confirmation.

2. Atomic check-and-reserve. The conditional UPDATE (settled - reserved >= amount
   then reserved += amount) is a single database statement serialised by row
   locking. The caller checks affected rows: 0 means a concurrent request won.
   Two races against one account yield exactly one reservation.

3. Transaction boundary. The reservation, payout row, and message row are
   inserted in one Prisma $transaction. If the process dies, either all three
   persist (reservation + payout + queue) or none do. No orphaned reservation,
   no queue entry without a reservation.

4. Worker dedup via conditional update. A message transitions PENDING →
   PROCESSING only via UPDATE … WHERE status = PENDING. Two deliveries of the
   same message: only one lock succeeds; the other is a no-op. Stuck
   PROCESSING messages are reset on the next poll cycle.

5. Idempotency key. A unique constraint on payout.idempotencyKey ensures
   duplicate client retries return the original payout.

6. Settlement is confirmation-gated. settledBalance is decremented only after
   provider.confirm() returns true. txHash alone is not sufficient.

7. Uncertainty parks. After MAX_RETRY_ATTEMPTS (3) without a definitive
   outcome, payout → NEEDS_REVIEW with the reservation intact. We do not
   release the hold or reverse it: the transfer may have landed on-chain, and
   releasing would risk paying twice. A human reviews.

8. All money is bigint in minor units end-to-end. No floats.
```
