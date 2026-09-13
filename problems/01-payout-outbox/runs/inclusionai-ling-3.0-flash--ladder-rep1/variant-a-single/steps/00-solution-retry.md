# solution-retry

## reasoning

```
Let me analyze this task carefully. I need to build a crypto payout service with:

1. **Prisma schema** - with models for Account, Payout, Message (queue), and ProcessedMessage (for dedup)
2. **NestJS module** - controller, service, worker
3. **Tests** - concurrent creation, duplicate delivery, retry exhaustion
4. **DESIGN.md** - funds-safety approach

Key requirements from the specs:
- Reserve (not debit) on creation
- Atomic check+reserve (conditional update)
- Message queue in same transaction as reservation
- Worker safe against redelivery
- Idempotency key for creation
- Settlement on confirmation, not send
- Bounded retries, terminal state on exhaustion
- Integer money (BigInt)

Let me plan the architecture:

### Prisma Schema
- `Account` - id, settledBalance (BigInt), reservedBalance (BigInt)
- `Payout` - id, accountId, amount (BigInt), destinationAddress, idempotencyKey, status (enum: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW), txHash, createdAt, updatedAt
- `Message` - id, payoutId, status (PENDING, PROCESSING, COMPLETED, FAILED), attempts, createdAt
- `ProcessedMessage` - id, messageId (unique), processedAt - for dedup tracking

Actually, let me reconsider. For redelivery safety, I can use the message status with conditional updates. When the worker picks up a message, it transitions it from PENDING to PROCESSING in a single atomic operation. If it sees it again (redelivery), it's already PROCESSING so it skips.

But wait - the spec says "a processed-messages record, a status transition guarded by a conditional update, or a unique constraint the second attempt violates. Choose one and make it the only path."

I'll use status transition guarded by conditional update: `UPDATE message SET status = 'PROCESSING' WHERE id = X AND status = 'PENDING'` and check that exactly 1 row was affected.

### Flow
1. `POST /payouts` with `{accountId, amount, destinationAddress, idempotencyKey}`
   - Check idempotency: if a payout exists with this key, return it
   - Atomic reserve: `UPDATE account SET reservedBalance = reservedBalance + amount, "updatedAt" = now() WHERE id = accountId AND (settledBalance - reservedBalance) >= amount`
   - If 0 rows affected → insufficient funds error
   - Create payout record with status CREATED
   - Create message queue record (same transaction)
   - Return payout

2. Worker `processMessages()` runs every N seconds:
   - Select PENDING messages
   - For each: try conditional update to PROCESSING
   - If successful: process the payout
     - Call provider.transfer()
     - On success: update payout status to SENT with txHash
     - Create settlement ledger entry (or just update account settled balance)
     - Update message to COMPLETED
     - On failure: retry bounded times
     - If retries exhausted: payout to NEEDS_REVIEW, message to FAILED, reservation stays
   - If not successful (already PROCESSING): skip (redelivery)

3. Settlement:
   - When provider confirms (SENT → COMPLETED), debit settled balance from account and release reservation

Wait, let me re-read the spec more carefully:

- "The account's settled balance changes only when the provider confirms the transfer."
- "A payout in flight is visible as an obligation" - so reservedBalance tracks the hold
- When creating: reserve from available (settled - reserved)
- When confirming: settledBalance decreases, reservedBalance decreases (the hold is consumed)
- On failure: reservedBalance stays (for NEEDS_REVIEW)

Actually, let me think about the ledger more carefully:

- Account has `settledBalance` and `reservedBalance`
- Available = settledBalance - reservedBalance
- On payout creation: check available >= amount, then reservedBalance += amount (atomic)
- On provider confirmation: settledBalance -= amount, reservedBalance -= amount (settled is debited, hold is released)
- On failure (retries exhausted): reservedBalance stays as-is, payout goes to NEEDS_REVIEW

Actually, when we confirm the transfer:
- The settled balance should decrease (money left the account on chain)
- The reservation should be released (the hold is now a completed payment)

So: settledBalance -= amount, reservedBalance -= amount.

When creating, we just increase reservedBalance. The settled balance doesn't move.

Let me design the transaction for creation:

```
BEGIN
-- Check idempotency (read)
SELECT payout FROM payout WHERE idempotency_key = $1
IF found RETURN that payout

-- Atomic reserve
UPDATE account SET reserved_balance = reserved_balance + $2, updated_at = now() 
WHERE id = $3 AND (settled_balance - reserved_balance) >= $2
IF rows affected = 0 ROLLBACK, RETURN error

-- Create payout
INSERT INTO payout (...) VALUES (...)

-- Create message (same transaction!)
INSERT INTO message (payout_id, status) VALUES (last_payout_id, 'PENDING')

COMMIT
```

### Worker process:
```
for each message where status = 'PENDING':
  UPDATE message SET status = 'PROCESSING', attempts = attempts + 1, updated_at = now()
  WHERE id = msg.id AND status = 'PENDING'
  IF rows affected = 0: CONTINUE (redelivery or already taken)
  
  payout = get payout by message.payoutId
  
  try:
    txHash = await provider.transfer({to: payout.destinationAddress, amount: payout.amount})
    // SENT
    UPDATE payout SET status = 'SENT', tx_hash = txHash, updated_at = now() WHERE id = payout.id
    
    // Settlement on confirmation
    UPDATE account SET settled_balance = settled_balance - payout.amount, 
                        reserved_balance = reserved_balance - payout.amount,
                        updated_at = now()
    WHERE id = payout.accountId
    
    UPDATE message SET status = 'COMPLETED', updated_at = now() WHERE id = message.id
    
  catch (error):
    IF attempts >= MAX_RETRIES:
      UPDATE payout SET status = 'NEEDS_REVIEW', updated_at = now() WHERE id = payout.id
      UPDATE message SET status = 'FAILED', updated_at = now() WHERE id = message.id
      // reservation stays, settled balance doesn't change
    ELSE:
      UPDATE message SET status = 'PENDING', updated_at = now() WHERE id = message.id
      // Will be picked up again on next poll
```

Wait, but the spec says "Retry a bounded number of times." So attempts should be tracked on the message, and we should have a max retry constant.

Actually, let me reconsider the retry approach. The message has `attempts` counter. When we fail and want to retry, we set status back to PENDING and increment attempts. When attempts >= MAX, we move to terminal.

But there's a subtlety: the message goes from PENDING → PROCESSING (atomically). If we fail, we set it back to PENDING (with attempts incremented). On next poll, we might pick it up again. If attempts >= MAX, we don't try again.

Actually, let me simplify. The message records attempts. When processing:
1. Atomically claim: UPDATE message SET status='PROCESSING' WHERE id=X AND status='PENDING' → check 1 row affected
2. Try provider.transfer()
3. If success: mark payout SENT, settle account, mark message COMPLETED
4. If fail: 
   - If attempts >= MAX_RETRIES: mark payout NEEDS_REVIEW, message FAILED (done, no more retries)
   - Else: increment attempts, mark message PENDING (will retry on next poll)

For the idempotency of the worker - the atomic claim (step 1) is the guard. If the same message is delivered again, step 1 will affect 0 rows because it's already PROCESSING, so it's skipped.

### Error handling on provider timeout after chain accepted:
This is issue #3 from the L2 spec. When provider.transfer() times out after the chain accepted, we don't know if it succeeded. The safe direction: move to NEEDS_REVIEW, keep reservation, don't revert. A human investigates.

### Testing:
- Concurrent creation test: create two payouts simultaneously against same account with enough for one → only one succeeds
- Duplicate message delivery test: simulate same message processed twice → only one transfer
- Retry exhaustion test: provider fails consistently → payout goes to NEEDS_REVIEW, reservation intact

### File Layout:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts (enums/interfaces)
test/payout.spec.ts
DESIGN.md
```

Let me think about the provider. Since it's external, I'll inject it as a service that can be mocked in tests.

Let me also think about the ledger. The spec says "Keep a double-entry-style ledger." So I might need a separate `LedgerEntry` model. But actually, the account's settled balance itself is the ledger. When it changes, that IS the ledger entry. Or I could have explicit ledger entries. Let me include a `LedgerEntry` model to be explicit about it.

Actually, re-reading: "The account's settled balance changes only when the provider confirms the transfer." and "Keep a double-entry-style ledger." I think the simplest approach that satisfies both is: the settledBalance column IS the ledger. Each change is an implicit entry. Or I can have an explicit `LedgerEntry` model.

Let me include `LedgerEntry` for completeness:
- id, accountId, payoutId (nullable), amount (BigInt), type (DEBIT/CREDIT), createdAt

Actually, for this use case, the settledBalance is sufficient. Every time settledBalance changes by -amount, that's a debit entry. But to be explicit about "double-entry-style ledger", let me add it. Though it might overcomplicate. Let me keep it simple and just track settledBalance and reservedBalance on the account, and note in DESIGN.md that these are the ledger.

Hmm, actually let me include a ledger entries table. It's explicitly asked for.

Let me finalize my schema:

```prisma
model Account {
  id              String    @id @default(uuid())
  settledBalance  BigInt    @default(0)
  reservedBalance BigInt    @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
}

model Payout {
  id                 String    @id @default(uuid())
  accountId          String
  amount             BigInt
  destinationAddress String
  idempotencyKey     String    @unique
  status             String    // CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW
  txHash             String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  account            Account   @relation(fields: [accountId], references: [id])
  messages           Message[]
  ledgerEntries      LedgerEntry[]
}

model Message {
  id          String   @id @default(uuid())
  payoutId    String
  status      String   // PENDING, PROCESSING, COMPLETED, FAILED
  attempts    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  payout      Payout   @relation(fields: [payoutId], references: [id])
}

model LedgerEntry {
  id        String   @id @default(uuid())
  accountId String
  payoutId  String?
  amount    BigInt
  type      String   // DEBIT, CREDIT
  createdAt DateTime @default(now())
  account   Account  @relation(fields: [accountId], references: [id])
  payout    Payout?  @relation(fields: [payoutId], references: [id])
}
```

Wait, I should use `@@map` for snake_case table names and column names per conventions.

Let me adjust:

```prisma
model Account {
  id              String    @id @default(uuid())
  settledBalance  BigInt    @default(0) @map("settled_balance")
  reservedBalance BigInt    @default(0) @map("reserved_balance")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  @@map("accounts")
}
```

Hmm, but the convention says "Table and column: snake_case (via Prisma @map/@@map)." So I need to use @map on each field and @@map on each model.

Let me also think about the Message table. The spec says "message table in Postgres as the queue". Let me also add a unique constraint or the status-based dedup.

For the worker dedup, I'll use the conditional update approach: `UPDATE message SET status='PROCESSING' WHERE id=X AND status='PENDING'`. This is the "status transition guarded by a conditional update" approach.

Now let me think about the PollingWorker. In NestJS, I can use `@nestjs/task` or `setInterval` or `@Schedule` from `@nestjs/schedule`. Since the spec says "polling worker", I'll use a simple approach with setInterval or NestJS's @Interval decorator.

Actually, let me just use a simple setInterval in the worker, or NestJS's `@Interval` from `@nestjs/schedule` if available. To keep it simple and not add dependencies, I'll use a constructor with setInterval or use NestJS's built-in.

Actually, let me use `@nestjs/common` `@Injectable` and set up an interval in `@PostConstruct` or use the `@Interval` decorator. Since I don't know what packages are installed, let me use a simple `setInterval` approach in the service.

Let me now think about the provider SDK. It's `provider.transfer({to, amount}) -> {txHash}`. I'll create an interface for it so it can be mocked in tests.

Let me now write all the files.

### Repository layer

The repository handles all Prisma client calls. The service should never call Prisma directly.

```typescript
// payout.repository.ts
@Injectable()
export class PayoutRepository {
  constructor(private prisma: PrismaClient) {}
  
  async findByAccountId(accountId: string): Promise<Account | null> {...}
  async findByIdempotencyKey(key: string): Promise<Payout | null> {...}
  async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {...}
  async createPayout(data: {...}): Promise<Payout> {...}
  async createMessage(payoutId: string): Promise<Message> {...}
  async claimMessage(messageId: string): Promise<Message | null> {...}
  async getPayoutWithAccount(payoutId: string): Promise<...> {...}
  async markPayoutSent(payoutId: string, txHash: string): Promise<void> {...}
  async settlePayout(payoutId: string, amount: bigint, accountId: string): Promise<void> {...}
  async markPayoutNeedsReview(payoutId: string): Promise<void> {...}
  async markMessageCompleted(messageId: string): Promise<void> {...}
  async markMessageFailed(messageId: string): Promise<void> {...}
  async incrementMessageAttempts(messageId: string): Promise<void> {...}
  async releaseMessageForRetry(messageId: string): Promise<void> {...}
  async getPendingMessages(): Promise<Message[]> {...}
  async getPayoutById(id: string): Promise<Payout | null> {...}
}
```

Wait, I need to be careful. The reserve + create payout + create message must be in ONE transaction. Let me handle this in the service with `$transaction` from Prisma, but the actual queries go through the repository. Hmm, but the convention says service has zero Prisma client calls.

Let me handle this differently. I'll pass the Prisma client to the repository and have the service orchestrate transactions through the repository methods that accept a transaction client.

Actually, a common pattern is to have the service do:
```typescript
await this.prisma.$transaction(async (tx) => {
  await this.payoutRepo.reserveAndCreate(data, tx);
});
```

But that means service calls Prisma... Let me think about this differently.

The convention says: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database."

So the repository should handle transactions internally. Let me have a method like:

```typescript
async reserveAndQueue(data: CreatePayoutDto): Promise<Payout> {
  return this.prisma.$transaction(async (tx) => {
    // all operations using tx
  });
}
```

This is fine - the repository touches the database (via Prisma), and the transaction is managed within the repository.

### Types

Let me define enums for status:

```typescript
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
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum LedgerType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}
```

### Controller

```typescript
@Controller('payouts')
export class PayoutController {
  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    return this.service.create(dto);
  }
}
```

### Service

```typescript
@Injectable()
export class PayoutService {
  async create(dto: CreatePayoutDto): Promise<Payout> {
    // Delegates to repository for transaction, or handles idempotency check then calls repository
  }
  
  async processMessages(): Promise<void> {
    // Worker logic
  }
}
```

Wait, but the worker needs to process messages. Should the service have the worker logic? Let me put it in the service, and the worker is just a timer that calls the service method.

Or I can have a separate worker file that calls the service's method.

Let me have:
- `payout.service.ts` - business logic (create, process)
- `payout.worker.ts` - timer-based polling, calls service.processMessages()
- `payout.controller.ts` - HTTP endpoint
- `payout.repository.ts` - DB access

Now let me write all the files.

Let me think about the idempotency check more carefully. The spec says:
"A retry with the same key returns the original payout and reserves nothing further."

So the flow is:
1. Check if payout with idempotencyKey exists (this should be inside the transaction or at least before the transaction)
2. If exists, return it (no reservation, no message)
3. If not, do the atomic reserve + create + enqueue in one transaction

But there's a race condition: two requests with the same idempotencyKey could both check and find nothing, then both proceed. To prevent this, the idempotency check should be part of the transaction.

Actually, the safest way: create a unique constraint on `idempotency_key` in the Payout table. Then inside the transaction:
1. Try to create the payout record (with status CREATED, but we need to reserve first...)

Hmm, let me think about this differently. The idempotency check:

Option 1: Check before the transaction (fast path). If found, return it. If not, do the transaction. Risk: race between check and transaction.

Option 2: Inside the transaction, check. If found, return. If not, reserve + create + enqueue. The transaction provides isolation.

Option 3: Try to create the payout with unique idempotency key first. If it fails (unique violation), read the existing one. Then check balance and reserve.

I'll go with option 2, combined with the unique constraint as a safety net.

Actually, let me do this in the repository:

```typescript
async createWithReservation(data: {accountId, amount, destinationAddress, idempotencyKey}): Promise<Payout> {
  return this.prisma.$transaction(async (tx) => {
    // Check idempotency inside transaction
    const existing = await tx.payout.findFirst({ where: { idempotencyKey: data.idempotencyKey } });
    if (existing) return existing;
    
    // Atomic reserve
    const result = await tx.account.updateMany({
      where: { 
        id: data.accountId,
        AND: [{ settledBalance: { gte: data.amount } }, { reservedBalance: { lt: { plus: data.settledBalance, data.amount } } }]
        // Wait, I need: settledBalance - reservedBalance >= amount
      },
      data: { reservedBalance: { increment: data.amount } }
    });
    
    if (result.count === 0) throw new InsufficientFundsError();
    
    // Create payout
    const payout = await tx.payout.create({ data: {...} });
    
    // Create message
    await tx.message.create({ data: { payoutId: payout.id } });
    
    return payout;
  });
}
```

Wait, the condition for the account update: `settledBalance - reservedBalance >= amount`. In Prisma, I can't easily express this as a raw condition in the WHERE clause of updateMany. Let me think...

Actually, in Prisma, I can use:
```typescript
where: {
  id: data.accountId,
  AND: [
    { settledBalance: { gte: amount } },
    // But I need settledBalance - reservedBalance >= amount
  ]
}
```

Hmm, Prisma doesn't support computed fields in WHERE. I need raw SQL for this. Let me use a raw query:

```typescript
const result = await tx.$executeRaw`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}, updated_at = NOW()
  WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
`;
```

But the convention says "Zero raw SQL" in the service. The repository can use raw SQL since it's the DB layer. Actually let me re-read: "service holds the logic. Zero raw SQL, zero Prisma client calls." - so the service has zero raw SQL. The repository CAN use raw SQL since it's the database layer.

But actually, let me avoid raw SQL and use Prisma's features. I can check the condition after the update:

```typescript
// First, do a raw check (or use transaction with raw SQL)
// Or: use UPDATE with RETURNING equivalent
```

Actually, let me use a different approach. I'll use Prisma's `update` with a try-catch, but the condition check needs to be in SQL. Let me just use `$executeRaw` in the repository - that's fine.

Alternatively, I can do:
1. Read the account
2. Check if available >= amount
3. If so, update reservedBalance

But that's the read-then-write race the spec explicitly warns against! So I must use atomic conditional update.

Let me use raw SQL in the repository for the atomic reserve:

```typescript
const result = await this.prisma.$executeRaw`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}, updated_at = NOW()
  WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
`;
const rowsAffected = (result as any).rowCount;
```

This is in the repository, so it's fine.

Now, for the transaction that combines reserve + create payout + create message, I need to use `$transaction` which can accept a callback. Inside that callback, I can use raw SQL and Prisma operations.

Let me structure the repository:

```typescript
async createPayoutWithReservation(data: CreatePayoutDto): Promise<Payout> {
  return this.prisma.$transaction(async (tx) => {
    // Check idempotency
    const existing = await tx.payout.findFirst({ where: { idempotencyKey: data.idempotencyKey } });
    if (existing) return existing;
    
    // Atomic reserve (raw SQL for conditional update)
    const result = await tx.$executeRaw`
      UPDATE accounts 
      SET reserved_balance = reserved_balance + ${data.amount}, updated_at = NOW()
      WHERE id = ${data.accountId} AND (settled_balance - reserved_balance) >= ${data.amount}
    `;
    const rowsAffected = (result as any).rowCount;
    if (rowsAffected === 0) {
      throw new Error('INSUFFICIENT_FUNDS'); // Will be caught and converted
    }
    
    // Create payout
    const payout = await tx.payout.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        idempotencyKey: data.idempotencyKey,
        status: PayoutStatus.CREATED,
      },
    });
    
    // Create message (same transaction!)
    await tx.message.create({
      data: {
        payoutId: payout.id,
        status: MessageStatus.PENDING,
      },
    });
    
    return payout;
  });
}
```

Now for the worker side, the claim and process:

```typescript
async claimMessage(tx: PrismaTransactionClient, messageId: string): Promise<boolean> {
  const result = await tx.$executeRaw`
    UPDATE messages 
    SET status = 'PROCESSING', updated_at = NOW()
    WHERE id = ${messageId} AND status = 'PENDING'
  `;
  return (result as any).rowCount === 1;
}
```

OK, I think I have a clear picture now. Let me write all the files.

Let me also think about how to test. I'll use Vitest with:
- A test database (or mock)
- Mock provider for testing

For concurrent creation test:
1. Set up account with balance 10000 (minor units, e.g., 100.00 USDC in minor units)
2. Fire two POST /payouts simultaneously for 6000 each (only one should succeed since 6000+6000 > 10000)
3. Assert only one payout was created

For duplicate message delivery:
1. Create a payout (which creates a message)
2. Manually call the worker to process the message
3. Then manually mark the message as PENDING again (simulating redelivery)
4. Call the worker again
5. Assert only one transfer was made (payout went to COMPLETED once)

For retry exhaustion:
1. Set up provider to always fail
2. Create a payout (which creates a message)
3. Run worker multiple times (MAX_RETRIES + 1 times)
4. Assert payout is in NEEDS_REVIEW, message is FAILED, account reservation intact

Now let me think about the test setup. I'll need to set up a real Prisma + PostgreSQL for integration tests, or use an in-memory approach. For simplicity in the test file, I'll mock the provider and use a test Prisma client.

Actually, for the tests, let me use a real approach with Prisma + a test database, and mock only the provider. But setting up a real database in a test file is complex. Let me use a lighter approach: I'll test the service directly with mocked repository and provider, but with meaningful assertions.

Wait, the spec says "Test the behaviour, not the implementation" and "Never assert only that a call happens." So I should test through the controller or service with real behavior.

Let me write integration-style tests that:
1. Set up test data directly in DB (via Prisma)
2. Call the service methods
3. Assert on the state changes

For concurrent creation, I can use the repository's transaction method directly to simulate the race.

Let me now write all the files. This will be quite long.

Let me finalize the structure:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts
src/provider/provider.module.ts
src/provider/provider.service.ts (the provider SDK wrapper)
test/payout.spec.ts
DESIGN.md
```

Actually, let me simplify. The provider can just be an injectable class in the payout module.

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts
test/payout.spec.ts
DESIGN.md
```

Let me start writing.

For the Prisma schema, I need to be careful with enums. Prisma supports enum types.

```prisma
enum payout_status {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum message_status {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ledger_entry_type {
  DEBIT
  CREDIT
}
```

Now let me write all files one by one.

Let me also think about `@map` carefully. Every model needs `@@map`, every field needs `@map`.

Also, I need to think about the `updatedAt` field. Prisma's `@updatedAt` automatically updates the timestamp. Good.

One more thing: for the worker interval, I'll use `@nestjs/schedule`'s `@Interval` or just a simple setInterval. Since I'm not sure about @nestjs/schedule being installed, let me use a simple approach in the worker:

```typescript
@Injectable()
export class PayoutWorker {
  private intervalId: NodeJS.Timeout | null = null;
  
  constructor(private readonly service: PayoutService) {}
  
  startPolling(intervalMs: number = 5000) {
    this.intervalId = setInterval(() => {
      this.service.processMessages().catch(console.error);
    }, intervalMs);
  }
  
  stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

And in the module's `onModuleInit` or in main, start the polling.

OK let me write everything now.

Actually, let me reconsider the structure. Let me think about what the `processMessages` method does:

```typescript
async processMessages(): Promise<void> {
  const messages = await this.repository.getPendingMessages();
  for (const message of messages) {
    await this.processMessage(message);
  }
}

private async processMessage(message: Message): Promise<void> {
  // Claim atomically
  const claimed = await this.repository.claimMessage(message.id);
  if (!claimed) return; // redelivery or race - skip
  
  const payout = await this.repository.getPayoutById(message.payoutId);
  if (!payout) return;
  
  try {
    const txHash = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });
    
    // Mark as sent
    await this.repository.markPayoutSent(payout.id, txHash);
    
    // Settle the account (debit settled, release hold)
    await this.repository.settlePayout(payout.id, payout.amount, payout.accountId);
    
    // Create ledger entry
    await this.repository.createLedgerEntry({
      accountId: payout.accountId,
      payoutId: payout.id,
      amount: payout.amount,
      type: LedgerEntryType.DEBIT,
    });
    
    // Mark message complete
    await this.repository.markMessageCompleted(message.id);
  } catch (error) {
    // Handle failure
    const attempts = (await this.repository.getMessage(message.id)).attempts + 1;
    
    if (attempts >= MAX_RETRIES) {
      // Terminal: don't revert anything
      await this.repository.markPayoutNeedsReview(payout.id);
      await this.repository.markMessageFailed(message.id);
    } else {
      // Retry: release message back to pending
      await this.repository.incrementMessageAttempts(message.id);
      await this.repository.releaseMessageForRetry(message.id);
    }
  }
}
```

Wait, `markPayoutSent` should also release the hold? No. Let me re-read the spec:

"Settlement happens on confirmation, never on send"
"The account's settled balance changes only when the provider confirms the transfer."

So:
- On SENT: we know the transfer was submitted, but not confirmed. The reservation stays.
- On COMPLETED: the provider confirmed. Now settled balance changes and reservation is released.

But when does "COMPLETED" happen? In my model, I'm marking it COMPLETED after settlement. Let me think about the status flow:

Payout status: CREATED → PROCESSING → SENT → COMPLETED

- CREATED: just reserved
- PROCESSING: worker is trying to send
- SENT: provider accepted the transfer (got txHash), but not confirmed
- COMPLETED: provider confirmed, settlement done

Actually, maybe I should simplify:
- CREATED: reserved, waiting for processing
- SENT: provider confirmed (txHash received and confirmed)

Wait, the provider returns txHash, but as the spec says, "txHash in hand is not confirmation of settlement." But for simplicity, let me consider that `provider.transfer()` succeeding is "confirmed enough" for the settlement step, and then we mark it COMPLETED.

Actually, let me re-read: "Settlement happens on confirmation, never on send." This means we should separate the "send" from the "settle." The send is the provider call. The settle is when we update the account balance.

In the real world, the provider might call back with confirmation later. But for this exercise, I think the flow is:
1. Worker calls provider.transfer() 
2. If it succeeds (got txHash): mark payout as SENT, then settle (debit settled balance, release reservation)
3. If it fails: retry or mark NEEDS_REVIEW

Wait, but the spec says "txHash in hand is not confirmation of settlement in our model — it is the point at which the outcome becomes knowable, not known." This suggests we should NOT settle immediately upon getting txHash.

But then how do we get confirmation? In a real system, there would be a webhook or callback. For this exercise, I think we should:
1. Call provider.transfer() → get txHash → mark as SENT (but DON'T settle yet)
2. Have some way to confirm → mark as COMPLETED and settle

For simplicity, let me model it as: `provider.transfer()` returning successfully IS the confirmation for our model. We mark it SENT (transaction submitted) and then immediately settle (mark COMPLETED). Or we can have a confirmation step.

Hmm, let me just do:
- `provider.transfer()` succeeds → payout status = SENT, create message/ledger for settlement
- Settlement (debit settled balance) happens when marking SENT → or we add a "confirm" endpoint

Actually, I think for this exercise, the key point is that the settlement (account balance change) should happen as a separate step from the provider call. Let me structure it as:

1. Worker processes message
2. Calls provider.transfer()
3. If success: 
   a. Mark payout SENT (with txHash)
   b. Settle: debit settled balance, release reservation
   c. Mark message COMPLETED
4. If fail: handle retries or NEEDS_REVIEW

And we can say that "settlement" is step 3b, which is distinct from the provider call in step 2. Even though they happen in sequence in our code, they are conceptually separate: the provider call is "send", and the account update is "settle".

Actually wait, that's what I had originally. Let me re-read the spec one more time:

"6. Settlement happens on confirmation, never on send"
"txHash in hand is not confirmation of settlement in our model — it is the point at which the outcome becomes knowable, not known."

I think the intent is: we should have a separate step where we "confirm" a payout. Let me add a status SENT (provider called, got txHash, pending confirmation) and COMPLETED (confirmed, settled). The settlement (account debit) happens when we mark COMPLETED, not SENT.

For the exercise, I'll add a method to confirm a payout (which transitions SENT → COMPLETED and settles the account). In a real system, this would be triggered by a webhook. In our test, we call it directly.

So the flow:
1. Worker calls provider.transfer() → success → payout.status = SENT, txHash stored
2. Some time later, confirmation comes → payout.status = COMPLETED, settled balance debited, reservation released

For testing, I'll simulate both steps.

Let me finalize this design.

Now let me write all files.

Actually, I realize this is getting very complex. Let me simplify slightly while keeping the key safety properties:

1. On provider.transfer() success: mark payout SENT with txHash
2. After SENT, have a confirm step that marks COMPLETED and settles the account
3. Worker processes messages: calls transfer, marks SENT. Then a separate confirmation process (could be another worker or endpoint) marks COMPLETED.

For the tests, I'll test:
1. Concurrent creation (doesn't need provider)
2. Duplicate message delivery (uses the worker processing a message)
3. Retry exhaustion (provider fails)

Let me write it all now. I'll aim for clean, complete code.

One more consideration: the provider. Let me create an injectable provider service:

```typescript
@Injectable()
export class BlockchainProvider {
  async transfer({to, amount}: {to: string; amount: bigint}): Promise<{txHash: string}> {
    // ASSUMPTION: This would be the real SDK
    // For tests, this will be mocked
    throw new Error('Not implemented');
  }
}
```

Now let me write everything.

For the schema, I realize I should be more careful about the relation fields. Let me also add the `@map` decorators properly.

Let me also decide on a reasonable polling interval. 5 seconds (5000ms) seems reasonable.

MAX_RETRIES: let's say 3.

OK here goes:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts
src/provider/provider.service.ts
test/payout.spec.ts
DESIGN.md
```

Wait, should the provider be in its own module? Let me just put it as an injectable in the payout module to keep things simple.

Let me now write all the code.

Actually, let me reconsider the file structure once more. I want to be pragmatic.

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts
src/payout/payout.module.ts
test/payout.spec.ts
DESIGN.md
```

The provider can be defined as an injection token or class within the payout module.

Let me start writing.

For the tests, I'll use Vitest with supertest for HTTP tests and direct service calls for unit tests. I'll mock the blockchain provider.

Let me think about the test setup. I need to:
1. Set up a Test module with NestJS
2. Mock the provider
3. Use a real Prisma connection (or PrismaMemoryServer for testing)

For simplicity, let me use Prisma's `$executeRaw` to set up test data and clean up. The tests will:
1. Use a test database (set up via env DATABASE_URL or default)
2. Mock the provider
3. Test through the service/controller layer

Actually, for a clean Vitest setup with NestJS, I'll use `Test.createTestingModule` and mock everything except the repository (which uses Prisma). But even Prisma can be mocked for unit tests.

Hmm, let me think about what level of testing to provide. The spec says:
- Tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion

I'll write integration tests that test the service behavior directly (not mocking the repository, but mocking the provider). I'll need a real database connection.

For the concurrent test, I can directly call the service's create method from multiple parallel calls.

For duplicate delivery, I can simulate by:
1. Creating a payout (creates message)
2. Processing the message (worker picks it up)
3. Manually setting the message back to PENDING (simulating redelivery)
4. Processing again
5. Asserting only one transfer happened

For retry exhaustion:
1. Create payout with a failing provider
2. Process messages multiple times
3. Assert final state

Let me write the tests.

Actually, I'll take a slightly different approach for tests. I'll mock the repository layer and test the service/controller behavior, which is more in line with "test behavior, not implementation." But for concurrent creation, I really need to test the atomic database operation... 

Let me just write integration tests with a mocked provider and a real (or mocked) database. In practice, the concurrent creation test needs to test the database-level atomicity, so I'll mock the repository to simulate the race condition, or use a real DB.

OK let me just write pragmatic tests that clearly test the required behaviors. I'll mock the provider and test at the service level, and for concurrent creation, I'll directly test the repository's reserveFunds method.

Let me now write all the files. This will be a lot of code.

Let me draft each file mentally first:

### prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum payout_status {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum message_status {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ledger_entry_type {
  DEBIT
  CREDIT
}

model account {
  id              String       @id @default(uuid())
  settledBalance  BigInt       @default(0) @map("settled_balance")
  reservedBalance BigInt       @default(0) @map("reserved_balance")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")
  payouts         payout[]
  ledgerEntries   ledger_entry[]
  @@map("accounts")
}

model payout {
  id                 String            @id @default(uuid())
  accountId          String            @map("account_id")
  amount             BigInt
  destinationAddress String            @map("destination_address")
  idempotencyKey     String            @unique @map("idempotency_key")
  status             payout_status
  txHash             String?           @map("tx_hash")
  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")
  account            account           @relation(fields: [accountId], references: [id])
  messages           message[]
  ledgerEntries      ledger_entry[]
  @@map("payouts")
}

model message {
  id        String          @id @default(uuid())
  payoutId  String          @map("payout_id")
  status    message_status
  attempts  Int             @default(0)
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")
  payout    payout          @relation(fields: [payoutId], references: [id])
  @@map("messages")
}

model ledger_entry {
  id        String          @id @default(uuid())
  accountId String          @map("account_id")
  payoutId  String?         @map("payout_id")
  amount    BigInt
  type      ledger_entry_type
  createdAt DateTime        @default(now()) @map("created_at")
  account   account         @relation(fields: [accountId], references: [id])
  payout    payout?         @relation(fields: [payoutId], references: [id])
  @@map("ledger_entries")
}
```

### src/payout/payout.types.ts

```typescript
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
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum LedgerType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ProviderTransferRequest {
  to: string;
  amount: bigint;
}

export const MAX_RETRIES = 3;
export const WORKER_INTERVAL_MS = 5000;
```

### src/payout/payout.controller.ts

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { CreatePayoutDto } from './payout.types';
import { PayoutService } from './payout.service';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    return this.payoutService.create(dto);
  }
}
```

### src/payout/payout.service.ts

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { BlockchainProvider } from '../provider/provider.service';
import {
  CreatePayoutDto,
  MAX_RETRIES,
  MessageStatus,
  PayoutStatus,
  LedgerType,
} from './payout.types';

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient available funds');
  }
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  async create(dto: CreatePayoutDto) {
    try {
      return await this.payoutRepository.createPayoutWithReservation(dto);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new NotFoundException({
          error: {
            code: 'insufficient_funds',
            message: 'Insufficient available funds',
            details: { accountId: dto.accountId, amount: dto.amount.toString() },
          },
        });
      }
      throw error;
    }
  }

  async processMessages(): Promise<void> {
      const messages = await this.payoutRepository.getPendingMessages();
      for (const message of messages) {
        await this.processSingleMessage(message);
      }
    }
  
  private async processSingleMessage(message: any) {
    const claimed = await this.payoutRepository.claimMessage(message.id);
    if (!claimed) {
      return;
    }

    const payout = await this.payoutRepository.getPayoutById(message.payoutId);
    if (!payout) {
      await this.payoutRepository.markMessageFailed(message.id);
      return;
    }

    try {
      const { txHash } = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });

      await this.payoutRepository.markPayoutSent(payout.id, txHash);
      await this.payoutRepository.settlePayout(payout.id, payout.amount, payout.accountId);
      await this.payoutRepository.createLedgerEntry({
        accountId: payout.accountId,
        payoutId: payout.id,
        amount: payout.amount,
        type: LedgerType.DEBIT,
      });
      await this.payoutRepository.markMessageCompleted(message.id);
    } catch {
      const currentMessage = await this.payoutRepository.getMessage(message.id);
      const attempts = currentMessage.attempts + 1;

      if (attempts >= MAX_RETRIES) {
        await this.payoutRepository.markPayoutNeedsReview(payout.id);
        await this.payoutRepository.markMessageFailed(message.id);
      } else {
        await this.payoutRepository.incrementMessageAttempts(message.id);
        await this.payoutRepository.releaseMessageForRetry(message.id);
      }
    }
  }

  async confirmPayout(payoutId: string): Promise<void> {
    const payout = await this.payoutRepository.getPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException({
        error: {
          code: 'payout_not_found',
          message: 'Payout not found',
          details: { payoutId },
        },
      });
    }
    if (payout.status !== PayoutStatus.SENT) {
      throw new NotFoundException({
        error: {
          code: 'invalid_status',
          message: 'Can only confirm payouts in SENT status',
          details: { payoutId, status: payout.status },
        },
      });
    }

    await this.payoutRepository.markPayoutCompleted(payout.id);
    await this.payoutRepository.settlePayout(payout.id, payout.amount, payout.accountId);
    await this.payoutRepository.createLedgerEntry({
      accountId: payout.accountId,
      payoutId: payout.id,
      amount: payout.amount,
      type: LedgerType.DEBIT,
    });
  }
}
```

Hmm wait, I'm doing settlement in two places: in processMessages (on provider success) and in confirmPayout. Let me reconcile this.

The spec says "Settlement happens on confirmation, never on send." And "The ledger entry that moves settled balance is written when the provider confirms."

So the settlement should happen on CONFIRMATION, not on send. But what counts as confirmation? In our model:
- `provider.transfer()` returns txHash → this is "send" → mark as SENT
- Later, something confirms → mark as COMPLETED, settle account

But in `processMessages`, after `provider.transfer()` succeeds, should I settle immediately or wait for confirmation?

Per the spec: "txHash in hand is not confirmation of settlement in our model — it is the point at which the outcome becomes knowable, not known."

So I should NOT settle immediately after provider.transfer(). I should:
1. provider.transfer() succeeds → mark as SENT
2. Wait for confirmation (webhook, polling, etc.) → mark as COMPLETED and settle

For this exercise, let me separate these:
- `processMessages`: calls provider, marks as SENT if success
- `confirmPayout` (endpoint or worker): marks as COMPLETED, settles account

But then the worker's processMessages and the confirmation need to be separate. Let me adjust.

Actually, for simplicity, let me have processMessages handle both send and confirm in one go (since we're simulating). The key conceptual separation is:
- provider.transfer() = send (external blockchain call)
- settling the account = our ledger update, which happens separately

In practice, these can be in the same flow as long as they're conceptually distinct. The spec says "never on send" - meaning the settlement (account debit) should not be in the same operation as calling the provider. They're separate operations.

I'll have:
1. Worker calls provider.transfer() → on success, marks payout SENT
2. Settlement (account debit, reservation release) happens in a separate step (either via a confirm endpoint or a second worker pass)

For the tests and implementation, I'll have a `confirmPayout` method that handles settlement. In the worker, I'll separate send and confirm.

But wait, this complicates the tests. Let me just do it all in the worker for simplicity, and make the conceptual distinction clear in the code (even though it's in the same method, the provider call and the account update are separate operations). The key insight is: if provider.transfer() throws, we don't touch the account. If it succeeds, we then update the account. They're two separate operations.

Actually, let me re-read: "Settlement happens on confirmation, never on send." I think this means: in the code path, the account update (settlement) should be a separate operation that only happens after we have definitive confirmation. For our model, provider.transfer() succeeding with a txHash is the "confirmation" (even though in reality it's just "knowable, not known"). The spec itself says "or your own equivalent" for statuses, so let me be practical:

I'll have:
- Worker calls provider.transfer() 
- If success: marks SENT with txHash, then settles (separate DB operation)
- The settlement is its own DB operation, distinct from the provider call

This satisfies "Settlement happens on confirmation, never on send" because the provider call (send) and the account update (settle) are separate operations in the code. If the provider call fails, we never reach the settle step.

OK, let me finalize and write.

Actually, one more thing. The spec says "Settled balance changes only when the provider confirms the transfer." I'll interpret provider.transfer() succeeding as "confirmation" for our model, and the settlement happens as a separate step after the provider call returns.

Let me write the final version now.

I also need to handle the scenario where provider.transfer() succeeds but then we fail to settle. In that case, the payout is SENT but not settled. A separate confirmation process would handle this. But for this exercise, I'll keep it simple and handle failures at each step.

Let me also think about the `settlePayout` in the repository. It needs to:
1. Decrement settled_balance
2. Decrement reserved_balance
3. Create ledger entry

These should be atomic. Let me use a transaction for this.

Actually, the ledger entry and account update should be in the same transaction. Let me handle that.

OK, let me write the repository carefully.

```typescript
async settlePayout(payoutId: string, amount: bigint, accountId: string): Promise<void> {
  return this.prisma.$transaction(async (tx) => {
    // Debit settled balance and release reservation
    await tx.account.update({
      where: { id: accountId },
      data: {
        settledBalance: { decrement: amount },
        reservedBalance: { decrement: amount },
      },
    });
    
    // Ledger entry
    await tx.ledger_entry.create({
      data: {
        accountId,
        payoutId,
        amount,
        type: LedgerEntryType.DEBIT,
      },
    });
  });
}
```

Wait, but `decrement` on BigInt? Let me make sure Prisma handles this. Yes, Prisma supports increment/decrement on integer/BigInt fields.

Also, I should check that settledBalance >= amount before decrementing, to prevent going negative. But in our model, the payout was reserved, so the settled balance should be sufficient (the reserved amount was backed by settled balance at creation time).

Hmm, actually, the settled balance could change between creation and settlement. But for this exercise, let me assume it doesn't (no deposits/withdrawals). The reservation ensures the amount was available at creation time.

Let me now write everything. I'll be thorough but pragmatic.

For the worker, let me use a simple interval approach:

```typescript
@Injectable()
export class PayoutWorker {
  private timer: NodeJS.Timeout | null = null;
  
  constructor(private readonly payoutService: PayoutService) {}
  
  start(intervalMs = WORKER_INTERVAL_MS) {
    this.timer = setInterval(() => {
      this.payoutService.processMessages().catch(console.error);
    }, intervalMs);
  }
  
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

Now let me write all files. I'll try to be complete and correct.

Let me also think about the provider module. I'll create it as a simple injectable:

In payout.module.ts, I'll define the provider as a provider that can be easily mocked.

OK, final approach for the module:

```typescript
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    {
      provide: 'BLOCKCHAIN_PROVIDER',
      useClass: BlockchainProvider,
    },
  ],
})
export class PayoutModule {}
```

And PayoutService injects `@Inject('BLOCKCHAIN_PROVIDER') provider: BlockchainProvider`.

Let me now write all files.

Let me finalize the design for `processMessages`. The flow is:

1. Get all PENDING messages
2. For each message:
   a. Try to claim it (atomic: PENDING → PROCESSING)
   b. If not claimed (0 rows), skip (redelivery safety)
   c. Get the associated payout
   d. Call provider.transfer()
   e. If success: mark payout SENT, settle account, mark message COMPLETED
   f. If fail: check attempts. If >= MAX_RETRIES, mark NEEDS_REVIEW + FAILED. Else, release message back to PENDING.

For the settle, it's a separate DB operation from the provider call. The provider call could succeed but the settle could fail (very unlikely but possible). Let me not over-engineer this.

Now let me write all the code. Let me aim for ~15 files total.

One more thought on the repository: I need a way to get the payout for processing, including the account info. Let me have:

```typescript
async getPayoutForProcessing(messageId: string): Promise<{payout: Payout & {account: Account}, message: Message}> {
  // Join query
}
```

Actually, I'll just do separate lookups. Claim message first, then get payout, then get account if needed.

Let me now write the actual code:

---

### prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum payout_status {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum message_status {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ledger_entry_type {
  DEBIT
  CREDIT
}

model account {
  id              String        @id @default(uuid())
  settledBalance  BigInt        @default(0) @map("settled_balance")
  reservedBalance BigInt        @default(0) @map("reserved_balance")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  payouts         payout[]
  ledgerEntries   ledger_entry[]
  @@map("accounts")
}

model payout {
  id                 String          @id @default(uuid())
  accountId          String          @map("account_id")
  amount             BigInt
  destinationAddress String          @map("destination_address")
  idempotencyKey     String          @unique @map("idempotency_key")
  status             payout_status
  txHash             String?         @map("tx_hash")
  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")
  account            account         @relation(fields: [accountId], references: [id], onDelete: Restrict)
  messages           message[]
  ledgerEntries      ledger_entry[]
  @@map("payouts")
}

model message {
  id        String        @id @default(uuid())
  payoutId  String        @map("payout_id")
  status    message_status
  attempts  Int           @default(0)
  createdAt DateTime      @default(now()) @map("created_at")
  updatedAt DateTime      @updatedAt @map("updated_at")
  payout    payout        @relation(fields: [payoutId], references: [id], onDelete: Restrict)
  @@map("messages")
}

model ledger_entry {
  id        String        @id @default(uuid())
  accountId String        @map("account_id")
  payoutId  String?       @map("payout_id")
  amount    BigInt
  type      ledger_entry_type
  createdAt DateTime      @default(now()) @map("created_at")
  account   account       @relation(fields: [accountId], references: [id], onDelete: Restrict)
  payout    payout?       @relation(fields: [payoutId], references: [id])
  @@map("ledger_entries")
}
```

### src/payout/payout.types.ts

```typescript
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
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum LedgerType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export const MAX_RETRIES = 3;
export const WORKER_INTERVAL_MS = 5000;
```

### src/provider/provider.service.ts

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class BlockchainProvider {
  async transfer(request: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    // ASSUMPTION: Actual blockchain provider SDK (e.g. ethers, web3)
    // May throw, time out, or succeed slowly.
    throw new Error('BlockchainProvider.transfer not implemented — inject a mock in tests.');
  }
}
```

### src/payout/payout.repository.ts

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  CreatePayoutDto,
  PayoutStatus,
  MessageStatus,
  LedgerType,
} from './payout.types';
import { InsufficientFundsError } from './payout.service';

export interface AccountRecord {
  id: string;
  settledBalance: bigint;
  reservedBalance: bigint;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  payoutId: string;
  status: MessageStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Account ---

  async getAccount(id: string): Promise<AccountRecord | null> {
    const r = await this.prisma.account.findUnique({ where: { id } });
    return r ? this.toAccountRecord(r) : null;
  }

  // --- Idempotency ---

  async findByIdempotencyKey(key: string): Promise<PayoutRecord | null> {
    const r = await this.prisma.payout.findFirst({ where: { idempotencyKey: key } });
    return r ? this.toPayoutRecord(r) : null;
  }

  // --- Atomic reserve + create + enqueue (single transaction) ---

  async createPayoutWithReservation(dto: CreatePayoutDto): Promise<PayoutRecord> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency check inside the transaction
      const existing = await tx.payout.findFirst({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        return this.toPayoutRecord(existing);
      }

      // Atomic conditional reserve: (settled - reserved) >= amount → reserved += amount
      const result = await tx.$executeRaw`
        UPDATE accounts
        SET reserved_balance = reserved_balance + ${dto.amount},
            updated_at = NOW()
        WHERE id = ${dto.accountId}
          AND (settled_balance - reserved_balance) >= ${dto.amount}
      `;
      const rowsAffected = (result as Prisma.ClientRequestMeta & { rowCount?: number }).rowCount ?? 0;
      if (rowsAffected === 0) {
        throw new InsufficientFundsError();
      }

      const payout = await tx.payout.create({
        data: {
          accountId: dto.accountId,
          amount: dto.amount,
          destinationAddress: dto.destinationAddress,
          idempotencyKey: dto.idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      await tx.message.create({
        data: {
          payoutId: payout.id,
          status: MessageStatus.PENDING,
        },
      });

      return this.toPayoutRecord(payout);
    });
  }

  // --- Worker: claim message (atomic conditional update) ---

  async claimMessage(id: string): Promise<boolean> {
    const result = await this.prisma.$executeRaw`
      UPDATE messages
      SET status = ${MessageStatus.PROCESSING},
          updated_at = NOW()
      WHERE id = ${id} AND status = ${MessageStatus.PENDING}
    `;
    const rowsAffected = (result as Prisma.ClientRequestMeta & { rowCount?: number }).rowCount ?? 0;
    return rowsAffected === 1;
  }

  // --- Worker: message management ---

  async getPendingMessages(): Promise<MessageRecord[]> {
    const rows = await this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
    });
    return rows.map(this.toMessageRecord);
  }

  async getMessage(id: string): Promise<MessageRecord | null> {
    const r = await this.prisma.message.findUnique({ where: { id } });
    return r ? this.toMessageRecord(r) : null;
  }

  async markMessageCompleted(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.COMPLETED },
    });
  }

  async markMessageFailed(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.FAILED },
    });
  }

  async incrementMessageAttempts(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  async releaseMessageForRetry(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.PENDING },
    });
  }

  // --- Worker: payout management ---

  async getPayoutById(id: string): Promise<PayoutRecord | null> {
    const r = await this.prisma.payout.findUnique({ where: { id } });
    return r ? this.toPayoutRecord(r) : null;
  }

  async markPayoutSent(id: string, txHash: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.SENT, txHash },
    });
  }

  async markPayoutCompleted(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.COMPLETED },
    });
  }

  async markPayoutNeedsReview(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.NEEDS_REVIEW },
    });
  }

  // --- Settlement (atomic: debit settled, release hold, ledger entry) ---

  async settlePayout(accountId: string, payoutId: string, amount: bigint): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { decrement: amount },
        },
      });

      await tx.ledger_entry.create({
        data: {
          accountId,
          payoutId,
          amount,
          type: LedgerType.DEBIT,
        },
      });
    });
  }

  // --- Setup / helpers ---

  async createAccount(id: string, settledBalance: bigint): Promise<void> {
    await this.prisma.account.create({
      data: { id, settledBalance },
    });
  }

  async deletePayout(id: string): Promise<void> {
    await this.prisma.payout.delete({ where: { id } });
  }

  async resetMessageStatus(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.PENDING, attempts: 0 },
    });
  }

  // --- Mappers ---

  private toAccountRecord(r: any): AccountRecord {
    return {
      id: r.id,
      settledBalance: r.settledBalance,
      reservedBalance: r.reservedBalance,
    };
  }

  private toPayoutRecord(r: any): PayoutRecord {
    return {
      id: r.id,
      accountId: r.accountId,
      amount: r.amount,
      destinationAddress: r.destinationAddress,
      idempotencyKey: r.idempotencyKey,
      status: r.status as PayoutStatus,
      txHash: r.txHash,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toMessageRecord(r: any): MessageRecord {
    return {
      id: r.id,
      payoutId: r.payoutId,
      status: r.status as MessageStatus,
      attempts: r.attempts,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
```

### src/payout/payout.service.ts

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { BlockchainProvider } from '../provider/provider.service';
import {
  CreatePayoutDto,
  MAX_RETRIES,
  MessageStatus,
  PayoutStatus,
  LedgerType,
} from './payout.types';

export class InsufficientFundsError extends Error {}

@Injectable()
export class PayoutService {
  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  async create(dto: CreatePayoutDto) {
    try {
      return await this.payoutRepository.createPayoutWithReservation(dto);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new NotFoundException({
          error: {
            code: 'insufficient_funds',
            message: 'Insufficient available funds',
            details: { accountId: dto.accountId, amount: dto.amount.toString() },
          },
        });
      }
      throw error;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.payoutRepository.getPendingMessages();
    for (const message of messages) {
      await this.processSingleMessage(message);
    }
  }

  private async processSingleMessage(message: { id: string; payoutId: string }): Promise<void> {
    // Atomic claim: PENDING → PROCESSING. If 0 rows, another worker already claimed it.
    const claimed = await this.payoutRepository.claimMessage(message.id);
    if (!claimed) {
      return; // safe against redelivery
    }

    const payout = await this.payoutRepository.getPayoutById(message.payoutId);
    if (!payout) {
      await this.payoutRepository.markMessageFailed(message.id);
      return;
    }

    try {
      // Send: call blockchain provider (may throw, time out, or succeed)
      const { txHash } = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });

      // Mark as sent (transaction submitted, not yet confirmed)
      await this.payoutRepository.markPayoutSent(payout.id, txHash);

      // Settle on confirmation: debit settled balance, release reservation, ledger entry
      await this.payoutRepository.settlePayout(payout.accountId, payout.id, payout.amount);

      await this.payoutRepository.markMessageCompleted(message.id);
    } catch {
      // Provider failure (transient or permanent)
      const current = await this.payoutRepository.getMessage(message.id);
      const attempts = (current?.attempts ?? 0) + 1;

      if (attempts >= MAX_RETRIES) {
        // Exhausted retries: terminal review state, reservation intact, nothing reversed
        await this.payoutRepository.markPayoutNeedsReview(payout.id);
        await this.payoutRepository.markMessageFailed(message.id);
      } else {
        // Bounded retry: release for next poll cycle
        await this.payoutRepository.incrementMessageAttempts(message.id);
        await this.payoutRepository.releaseMessageForRetry(message.id);
      }
    }
  }

  async confirmPayout(payoutId: string): Promise<void> {
    const payout = await this.payoutRepository.getPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException({
        error: {
          code: 'payout_not_found',
          message: 'Payout not found',
          details: { payoutId },
        },
      });
    }
    if (payout.status !== PayoutStatus.SENT) {
      throw new NotFoundException({
        error: {
          code: 'invalid_status',
          message: 'Only SENT payouts can be confirmed',
          details: { payoutId, status: payout.status },
        },
      });
    }

    await this.payoutRepository.markPayoutCompleted(payout.id);
    await this.payoutRepository.settlePayout(payout.accountId, payout.id, payout.amount);
  }
}
```

### src/payout/payout.controller.ts

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { CreatePayoutDto } from './payout.types';
import { PayoutService } from './payout.service';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    return this.payoutService.create(dto);
  }
}
```

### src/payout/payout.worker.ts

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { WORKER_INTERVAL_MS } from './payout.types';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly payoutService: PayoutService) {}

  onModuleInit() {
    this.start(WORKER_INTERVAL_MS);
  }

  onModuleDestroy() {
    this.stop();
  }

  start(intervalMs = WORKER_INTERVAL_MS) {
    this.timer = setInterval(() => {
      this.payoutService.processMessages().catch(console.error);
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

### src/payout/payout.module.ts

```typescript
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { BlockchainProvider } from '../provider/provider.service';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    BlockchainProvider,
  ],
})
export class PayoutModule {}
```

Wait, but PayoutRepository needs PrismaClient injected. Let me check how PrismaClient is typically wired in NestJS. Usually via PrismaModule from @prisma/accelerate or a custom module. Let me check what's needed.

In a typical NestJS + Prisma setup, PrismaService is provided:

```typescript
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super();
  }
}
```

And it's provided in AppModule or a PrismaModule. The repository injects it.

Let me make sure my AppModule and main.ts are correct.

### src/app.module.ts

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PayoutModule],
  providers: [PrismaService],
})
export class AppModule {}
```

But wait, PrismaService needs to be accessible to PayoutRepository. Since PayoutRepository injects PrismaClient, and PrismaService extends PrismaClient, it should work.

But actually, I need PrismaService to be provided in a module that's visible to PayoutModule. Let me use `@Global()` or make sure it's imported.

Actually, in NestJS, providers from the root module (AppModule) are available to all imported modules by default only if they're in the exports. Let me just provide PrismaService in the PayoutModule or make it global.

Let me use a simpler approach:

### src/prisma/prisma.service.ts

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

And in AppModule:

```typescript
@Module({
  imports: [PayoutModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
```

But PrismaService needs to be imported in PayoutModule too. Let me add it to PayoutModule's imports or providers.

Actually, the cleanest approach: make PrismaService global, or include it in PayoutModule's providers.

Let me just include it in PayoutModule:

### src/payout/payout.module.ts

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { BlockchainProvider } from '../provider/provider.service';

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    PrismaService,
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    BlockchainProvider,
  ],
})
export class PayoutModule {}
```

Hmm, but then PrismaService should be exported if PayoutRepository depends on it and PayoutService depends on PayoutRepository.

In NestJS, providers within the same module are automatically injectable by each other. So PayoutRepository can inject PrismaService, and PayoutService can inject PayoutRepository, all within the same module.

Wait, but PayoutRepository is `@Injectable()` and needs `PrismaClient` injected. Let me check the constructor:

```typescript
constructor(private readonly prisma: PrismaClient) {}
```

PrismaService extends PrismaClient, so it can be injected as PrismaClient. But NestJS needs to know how to resolve PrismaClient. By default, it uses the type. Since PrismaService is the only provider that extends PrismaClient, NestJS should inject it.

Actually, NestJS resolves by token. If the constructor expects `PrismaClient`, it looks for a provider of type `PrismaClient`. But PrismaService is `PrismaService`, not `PrismaClient`. NestJS won't automatically match them.

I should use `@Inject()` or make PrismaService provide itself as PrismaClient. The common pattern is:

```typescript
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() { super(); }
}

// In module:
providers: [
  { provide: PrismaClient, useClass: PrismaService },
  PrismaService,
]
```

Or use `@Inject(PrismaClient)` in the repository.

Hmm, let me check the typical NestJS Prisma pattern. Usually it's:

```typescript
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

And then:
```typescript
constructor(private readonly prisma: PrismaService) {}
```

So the repository should inject PrismaService, not PrismaClient. Let me update:

```typescript
import { PrismaService } from '../prisma/prisma.service';

constructor(private readonly prisma: PrismaService) {}
```

But then the type of `prisma` is `PrismaService` (which extends `PrismaClient`), and all Prisma operations work through it.

OK let me adjust the repository to inject PrismaService.

Also, I need to create the provider service directory. Let me check the path: `src/provider/provider.service.ts`. That's at `src/provider/provider.service.ts`. And the import in payout.service.ts would be `../provider/provider.service`.

Let me finalize all imports and paths.

Let me also add the PrismaService file and update the module.

### src/prisma/prisma.service.ts

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/app.module.ts

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PayoutModule],
  providers: [PrismaService],
})
export class AppModule {}
```

### src/main.ts

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/payout/payout.module.ts

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { BlockchainProvider } from '../provider/provider.service';

@Module({
  controllers: [PayoutController],
  providers: [
    PrismaService,
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    BlockchainProvider,
  ],
})
export class PayoutModule {}
```

And update the repository to inject PrismaService:

```typescript
constructor(private readonly prisma: PrismaService) {}
```

Now let me write the test file.

### test/payout.spec.ts

This needs tests for:
1. Concurrent creation against one account
2. Duplicate message delivery
3. Retry exhaustion

Let me write these using Vitest with NestJS testing utilities.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayoutModule } from '../src/payout/payout.module';
import { PayoutService, InsufficientFundsError } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { BlockchainProvider } from '../src/provider/provider.service';
import {
  PayoutStatus,
  MessageStatus,
  CreatePayoutDto,
  MAX_RETRIES,
} from '../src/payout/payout.types';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PayoutService', () => {
  let service: PayoutService;
  let repository: PayoutRepository;
  let provider: BlockchainProvider;
  let prisma: PrismaService;

  const ACCOUNT_ID = 'account-1';
  const makeDto = (overrides: Partial<CreatePayoutDto>): CreatePayoutDto => ({
    accountId: ACCOUNT_ID,
    amount: BigInt(1000),
    destinationAddress: '0xabc',
    idempotencyKey: `key-${Math.random()}`,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PayoutModule],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
    repository = module.get<PayoutRepository>(PayoutRepository);
    provider = module.get<BlockchainProvider>(BlockchainProvider);
    prisma = module.get<PrismaService>(PrismaService);

    // Ensure clean state
    await prisma.message.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.ledger_entry.deleteMany();
    await prisma.account.deleteMany();

    // Create test account with sufficient funds
    await prisma.account.create({
      data: {
        id: ACCOUNT_ID,
        settledBalance: BigInt(50000),
        reservedBalance: BigInt(0),
      },
    });

    // Mock provider
    vi.spyOn(provider, 'transfer').mockResolvedValue({ txHash: '0xtx' });
  });

  describe('concurrent creation against one account', () => {
    it('exactly one payout succeeds when two requests race for limited funds', async () => {
      // Account has 50000 settled, 0 reserved. Available = 50000.
      // Two requests for 30000 each → only one should succeed (30000+30000 > 50000)
      const dto1 = makeDto({ amount: BigInt(30000), idempotencyKey: 'key-1' });
      const dto2 = makeDto({ amount: BigInt(30000), idempotencyKey: 'key-2' });

      const [result1, result2] = await Promise.all([
        service.create(dto1),
        service.create(dto2),
      ]);

      // One succeeds, one fails
      const successes = [result1, result2].filter(
        (r) => !(r instanceof Error || r?.error),
      );
      const failures = [result1, result2].filter(
        (r) => r instanceof Error || r?.error,
      );

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Verify account state: only one reservation was made
      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account?.reservedBalance).toBe(BigInt(30000));

      // Verify only one payout was created
      const payouts = await prisma.payout.findMany({ where: { accountId: ACCOUNT_ID } });
      expect(payouts.length).toBe(1);
    });
  });

  describe('duplicate message delivery', () => {
    it('processes the same message only once', async () => {
      // Create a payout (which creates a message)
      const dto = makeDto({ amount: BigInt(1000), idempotencyKey: 'idem-1' });
      const payout = await service.create(dto);

      // Process messages (worker simulates)
      await service.processMessages();

      // Verify payout is SENT and message is COMPLETED
      let dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(dbPayout?.status).toBe(PayoutStatus.SENT);

      let dbMessage = await prisma.message.findFirst({ where: { payoutId: payout.id } });
      expect(dbMessage?.status).toBe(MessageStatus.COMPLETED);

      // Simulate redelivery: reset message to PENDING (as if queue redelivered it)
      await prisma.message.update({
        where: { id: dbMessage.id },
        data: { status: MessageStatus.PENDING },
      });

      // Process again
      await service.processMessages();

      // Payout should still be SENT (no double transfer)
      dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(dbPayout?.status).toBe(PayoutStatus.SENT);

      // Message should be COMPLETED again (not FAILED)
      dbMessage = await prisma.message.findFirst({ where: { payoutId: payout.id } });
      expect(dbMessage?.status).toBe(MessageStatus.COMPLETED);

      // Provider was called only once
      expect(provider.transfer).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry exhaustion', () => {
    it('moves to NEEDS_REVIEW with reservation intact after retries are exhausted', async () => {
      const dto = makeDto({ amount: BigInt(1000), idempotencyKey: 'idem-retry' });
      const payout = await service.create(dto);

      // Make provider always fail
      vi.spyOn(provider, 'transfer').mockRejectedValue(new Error('provider error'));

      // Process messages MAX_RETRIES times
      for (let i = 0; i < MAX_RETRIES; i++) {
        await service.processMessages();
      }

      // Payout should be NEEDS_REVIEW
      const dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(dbPayout?.status).toBe(PayoutStatus.NEEDS_REVIEW);

      // Message should be FAILED
      const dbMessage = await prisma.message.findFirst({ where: { payoutId: payout.id } });
      expect(dbMessage?.status).toBe(MessageStatus.FAILED);

      // Account reservation should be intact (not released)
      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account?.reservedBalance).toBe(BigInt(1000));

      // Settled balance unchanged
      expect(account?.settledBalance).toBe(BigInt(50000));

      // No ledger entry for this payout (settlement didn't happen)
      const entries = await prisma.ledger_entry.findMany({ where: { payoutId: payout.id } });
      expect(entries.length).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('same idempotencyKey returns same payout without double reservation', async () => {
      const dto = makeDto({ amount: BigInt(1000), idempotencyKey: 'idem-safe' });

      const result1 = await service.create(dto);
      const result2 = await service.create(dto);

      // Both should return the same payout
      expect(result1.id).toBe(result2.id);

      // Account should only have one reservation
      const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
      expect(account?.reservedBalance).toBe(BigInt(1000));

      // Only one payout record
      const payouts = await prisma.payout.findMany({ where: { idempotencyKey: 'idem-safe' } });
      expect(payouts.length).toBe(1);

      // Only one message
      const messages = await prisma.message.findMany({ where: { payoutId: result1.id } });
      expect(messages.length).toBe(1);
    });
  });
});
```

Wait, there's an issue with the concurrent test. When both calls happen simultaneously, the `InsufficientFundsError` is converted to a `NotFoundException`. So one result will be the payout record and the other will be a NotFoundException. Let me adjust the test.

Also, I realize there's a subtle issue with the `create` method. If `createPayoutWithReservation` returns the existing payout for an idempotency key hit, it returns a PayoutRecord. If it throws InsufficientFundsError, the `create` method catches it and throws NotFoundException.

In the concurrent test, one call will succeed (return PayoutRecord) and the other will get InsufficientFundsError → NotFoundException.

Let me adjust:

```typescript
const [result1, result2] = await Promise.allSettled([
  service.create(dto1),
  service.create(dto2),
]);

const fulfilled = result1.status === 'fulfilled' ? result1.value : null;
const rejected = result2.status === 'rejected' ? result2.reason : null;

// Or check both
```

Let me also make the test more robust.

Also, I need to think about the `InsufficientFundsError` being caught properly. In the service, it catches `InsufficientFundsError` and throws `NotFoundException`. In the concurrent test, both are running in parallel, so:
- One thread: check idempotency (no conflict), then atomic reserve → succeeds (reserves 30000)
- Other thread: check idempotency (no conflict), then atomic reserve → fails (available = 20000 < 30000)

So one returns the payout, the other throws NotFoundException.

Let me use `Promise.allSettled`:

```typescript
const results = await Promise.allSettled([
  service.create(dto1),
  service.create(dto2),
]);

const success = results.filter(r => r.status === 'fulfilled');
const failure = results.filter(r => r.status === 'rejected');

expect(success.length).toBe(1);
expect(failure.length).toBe(1);
```

Wait, there's a potential issue: what if both succeed? If the account has 50000 and both want 30000, then the atomic reserve ensures at most one can succeed. So either one succeeds and one fails, or both fail if there were less funds. But with 50000, at most one 30000 reservation can succeed. ✓

But wait: 50000 - 0 = 50000 available. First request reserves 30000. Available becomes 20000. Second request tries to reserve 30000, but 20000 < 30000, fails. ✓

Good.

Let me also reconsider: the test might be flaky because both requests check idempotency before either does the reserve. Let me trace:

1. Thread 1: check idempotency for 'key-1' → not found
2. Thread 2: check idempotency for 'key-2' → not found
3. Thread 1: atomic reserve 30000 → succeeds (50000 - 0 >= 30000)
4. Thread 2: atomic reserve 30000 → fails (50000 - 30000 < 30000)
5. Thread 1: create payout, create message, commit
6. Thread 2: throw InsufficientFundsError

This is deterministic because the atomic reserve serializes through the database. ✓

Now for the concurrent test, I want to make it even more robust. Let me also add a test where both requests have enough funds (e.g., 10000 each against 50000) and verify both succeed:

Actually, the spec says "Two concurrent creations against one account with funds for one → exactly one payout." So the test with insufficient funds for both is correct.

Let me also verify that both payout records have messages:

Hmm, actually I realize there might be a timing issue in the test. When using `Promise.all`, both calls enter the service simultaneously. But the database transaction in `createPayoutWithReservation` serializes the critical section. The database will handle the concurrency correctly.

One thing I'm concerned about: the `InsufficientFundsError` is a custom class. Is it correctly caught? Let me check:

```typescript
async create(dto: CreatePayoutDto) {
  try {
    return await this.payoutRepository.createPayoutWithReservation(dto);
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      throw new NotFoundException({...});
    }
    throw error;
  }
}
```

And in the repository:
```typescript
if (rowsAffected === 0) {
  throw new InsufficientFundsError();
}
```

Wait, `InsufficientFundsError` is defined in `payout.service.ts` but used in `payout.repository.ts`. Let me move it to a shared location, like `payout.types.ts` or keep it in service and import it.

Actually, it's cleaner to define it where it's used (repository) and import from there in the service. Or define it in a shared types file. Let me put it in `payout.types.ts` since both files need it.

### src/payout/payout.types.ts

```typescript
export class InsufficientFundsError extends Error {}
```

And import it in both the service and repository.

OK let me also think about the test for duplicate message delivery. When I call `service.processMessages()`, it:
1. Gets pending messages
2. Claims each one (PENDING → PROCESSING)
3. Calls provider.transfer()
4. Marks SENT
5. Settles account
6. Marks COMPLETED

Then I reset message to PENDING and call again. This time:
1. Gets pending messages (the one reset to PENDING)
2. Claims it again (PENDING → PROCESSING)
3. Calls provider.transfer() again

Wait! But in my test for duplicate delivery, I want the second call to NOT call provider.transfer() again because it's a redelivery. The safety mechanism is the atomic claim (PENDING → PROCESSING). When I manually reset the message to PENDING, the second call will claim it and process it again!

This isn't testing the right thing. Let me reconsider.

The redelivery safety works like this:
1. Worker claims message (PENDING → PROCESSING)
2. Worker crashes before marking COMPLETED
3. Message is still PROCESSING
4. On restart, worker doesn't see it as PENDING, so it skips it
5. But wait, the message is stuck in PROCESSING forever!

Hmm, there's an issue. If a message is in PROCESSING state and the worker never completes it, it's stuck. The spec says "the worker may see the same message more than once" - meaning redelivery. The typical pattern is:
1. Message is PENDING
2. Worker claims it atomically (PENDING → PROCESSING)
3. Worker processes it
4. If worker crashes, the message is still PROCESSING
5. Some mechanism detects stale PROCESSING messages and resets them to PENDING

But the spec says "a processed-messages record, a status transition guarded by a conditional update, or a unique constraint the second attempt violates."

The key insight: the second DELIVERY (same message coming back) should be a no-op. In a queue system like PostgreSQL's LISTEN/NOTIFY or a polling queue, the "delivery" is the worker fetching and processing the message. The worker's claim (PENDING → PROCESSING) is the guard: if it's already PROCESSING, the claim fails and the message is skipped.

But in my test, I'm resetting the message to PENDING manually, which simulates a requeue (like a visibility timeout expiring). In that case, the message SHOULD be reprocessed.

Wait, let me re-read the spec:
"4. The worker is safe against redelivery. Delivery is at-least-once; the worker will see the same message more than once. Make the second delivery a no-op."

And in the acceptance criteria: "The same message delivered twice → one transfer."

So the test scenario is: the SAME message row is processed twice (delivery happens twice). The second time, it should be a no-op.

If the message was already moved to COMPLETED or FAILED by the first processing, then a second delivery (fetching the message) would see it's not PENDING, so it's skipped. Let me trace:

First delivery:
1. Worker queries for PENDING messages
2. Sees our message (PENDING)
3. Claims it (PENDING → PROCESSING)
4. Processes it → COMPLETED
5. Next time worker queries, it doesn't see PENDING messages

Second delivery (redelivery of the same logical message):
1. If the message is COMPLETED, the worker query for PENDING messages won't find it
2. If somehow the message is requeued as PENDING, the worker will find it again

The second case (requeue) is what happens in real queue systems. The test should simulate this and verify it's safe.

But in my current test, if I reset to PENDING and process again, the transfer WILL be called again. That's the behavior of a "redelivery after requeue." The safety mechanism isn't about requeued messages; it's about messages that are already PROCESSING.

Let me think about this differently. The acceptance says "same message delivered twice → one transfer." This means: the system receives the message twice (perhaps due to queue redelivery), but only executes the transfer once.

The key mechanism is: the atomic claim (PENDING → PROCESSING with row count check). If the message is in PROCESSING and the worker sees it again (or a second worker tries to claim it), the claim fails (0 rows affected), and it's skipped.

But for this to work in a polling model, the message needs to stay in a state that the worker doesn't process. If I use PENDING → PROCESSING, then messages in PROCESSING are skipped. But they could be stuck there if the worker crashes.

In a real system, you'd have a "stale PROCESSING" detector. But for this exercise, let me use a different approach for the dedup:

Option: Use a `processed_messages` table. When a message is successfully processed, insert a record into `processed_messages`. On redelivery, check if a record exists. If so, skip.

But the spec says "Choose one and make it the only path." I already chose "status transition guarded by conditional update." Let me stick with that.

Let me reconsider the test. The "duplicate delivery" test should:
1. Create a payout with a message (PENDING)
2. Worker processes it: claims message (PENDING → PROCESSING), calls provider, marks COMPLETED
3. Now, simulate a scenario where the same message is delivered again

The "same message delivered again" in the context of at-least-once delivery means: the queue system delivers the message again. In our PostgreSQL queue model, this means the message row is somehow delivered again. But since we've already marked it COMPLETED, a normal poll won't pick it up.

I think the correct test is:
1. Create a payout
2. Start processing
3. During processing, before the message is marked COMPLETED, another worker picks up the same message
4. The second worker's claim should fail (message is PROCESSING), so it's a no-op

But this requires precise timing. A simpler test:

1. Create a payout with a message in PENDING state
2. Have two workers (or call processMessages twice in parallel)
3. Only one should process the message

Actually, let me think of this even more simply:

1. Create a payout (message PENDING)
2. Call processMessages() → processes the message (PENDING → PROCESSING → COMPLETED)
3. Now, manually put the message back to PROCESSING (simulating a stale/requeued message)
4. Call processMessages() again
5. The claim fails (PROCESSING → PROCESSING with WHERE status = PROCESSING is 0 rows, or we can keep it as PROCESSING and it won't be picked up)

Wait, step 3 doesn't make sense. Let me try:

1. Create a payout (message PENDING)
2. Process it via processMessages()
3. Message is now COMPLETED
4. A duplicate "delivery" means the queue system tries to deliver it again
5. Since it's COMPLETED, it won't be picked up by `getPendingMessages()`
6. Result: no second transfer

But this is trivially true. The test would just verify that COMPLETED messages aren't reprocessed. Let me make it more meaningful.

Actually, I think the better test for "duplicate message delivery" is:

1. Create a payout
2. Worker starts processing (claims message as PROCESSING)
3. Simulate that the same message is fetched by a second worker (or same worker, second call)
4. The second call should NOT process it again

To simulate step 2+3, I can:
1. Create a payout
2. Manually claim the message (PENDING → PROCESSING) via the repository
3. Call processMessages()
4. The message is PROCESSING, so `getPendingMessages()` won't find it
5. Nothing happens

But this is also trivially true because the message isn't in PENDING status.

Hmm. Let me think about what the spec really wants. The acceptance is "The same message delivered twice → one transfer." This means:

In a system with at-least-once delivery, a single logical message can be delivered multiple times to the consumer. The consumer must handle this gracefully.

For our PostgreSQL queue model:
- Message has status PENDING, PROCESSING, COMPLETED, FAILED
- Worker: SELECT messages WHERE status = PENDING (get pending messages)
- Worker: UPDATE message SET status = PROCESSING WHERE id = X AND status = PENDING (claim atomically)
- Worker: process the payout
- Worker: UPDATE message SET status = COMPLETED

Now, "duplicate delivery" in this context means:
1. Worker fetches message (status PENDING)
2. Worker claims it (status → PROCESSING)
3. Worker starts processing
4. Worker crashes BEFORE marking COMPLETED
5. Message is stuck at PROCESSING
6. Some mechanism requeues it (back to PENDING)
7. Worker picks it up again (this is the duplicate delivery)
8. Worker should process it (it's legitimate - the first attempt didn't complete)

But wait, the spec says "the second delivery should be a no-op." If it's a no-op, then the transfer would never happen if the worker crashed mid-processing!

I think "no-op" means "no-op" only if the first attempt successfully completed the transfer. If the worker crashed, the transfer might not have happened, and the message SHOULD be reprocessed.

Hmm, let me re-read: "Delivery is at-least-once: your worker may see the same message more than once." and "Make the second delivery a no-op."

OK I think the intent is: the provider transfer may have succeeded, but the worker crashed before marking it complete. In that case:
- The transfer already happened (first delivery succeeded)
- The second delivery should NOT trigger another transfer (no-op)

So the no-op guard should check whether the transfer was already made, not just the message status. The payout status would be SENT (transfer was made), and even if the message is requeued, the worker should check: "has this payout already been sent?" If yes, skip.

Let me adjust the worker logic:

```typescript
private async processSingleMessage(message: { id: string; payoutId: string }): Promise<void> {
  const claimed = await this.payoutRepository.claimMessage(message.id);
  if (!claimed) return;

  const payout = await this.payoutRepository.getPayoutById(message.payoutId);
  if (!payout) {
    await this.payoutRepository.markMessageFailed(message.id);
    return;
  }

  // If payout is already SENT or beyond, this is a redelivery - skip
  if (payout.status === PayoutStatus.SENT || payout.status === PayoutStatus.COMPLETED) {
    await this.payoutRepository.markMessageCompleted(message.id);
    return;
  }

  // ... rest of processing
}
```

This is a better guard. The message might be requeued (PENDING again), but when processing, we check the payout status first. If the payout was already sent, skip.

But the acceptance says "the second delivery a no-op." And in my test, I should simulate:
1. Process a message (transfer made, payout SENT, message COMPLETED)
2. Somehow the message is delivered again (re-queued as PENDING)
3. Worker processes it, sees payout is SENT, marks message COMPLETED (no-op transfer)

Let me adjust the test:

```typescript
it('processes the same message only once even when redelivered', async () => {
  // Create a payout
  const dto = makeDto({ amount: BigInt(1000), idempotencyKey: 'idem-dup' });
  const payout = await service.create(dto);

  // Process messages (first delivery)
  await service.processMessages();

  // Verify payout is SENT and message is COMPLETED
  let dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
  expect(dbPayout?.status).toBe(PayoutStatus.SENT);
  expect(provider.transfer).toHaveBeenCalledTimes(1);

  // Simulate redelivery: re-queue the message as PENDING
  const message = await prisma.message.findFirst({ where: { payoutId: payout.id } });
  await prisma.message.update({
    where: { id: message.id },
    data: { status: MessageStatus.PENDING, attempts: 0 },
  });

  // Process again (second delivery)
  await service.processMessages();

  // Payout should still be SENT (no second transfer)
  dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
  expect(dbPayout?.status).toBe(PayoutStatus.SENT);

  // Provider should still have been called only once
  expect(provider.transfer).toHaveBeenCalledTimes(1);

  // Message should be COMPLETED again
  const dbMessage = await prisma.message.findFirst({ where: { payoutId: payout.id } });
  expect(dbMessage?.status).toBe(MessageStatus.COMPLETED);
});
```

This tests that even when the message is requeued (redelivered), the transfer isn't made again.

But wait - I need to add the payout status check in the service! When the worker claims a message and sees the payout is already SENT, it should skip the provider call. Let me update the service.

OK let me now finalize everything. I'll update the processSingleMessage method:

```typescript
private async processSingleMessage(message: { id: string; payoutId: string }): Promise<void> {
  const claimed = await this.payoutRepository.claimMessage(message.id);
  if (!claimed) return;

  const payout = await this.payoutRepository.getPayoutById(message.payoutId);
  if (!payout) {
    await this.payoutRepository.markMessageFailed(message.id);
    return;
  }

  // If payout already sent or completed, this is a redelivery - no-op
  if (payout.status === PayoutStatus.SENT || payout.status === PayoutStatus.COMPLETED) {
    await this.payoutRepository.markMessageCompleted(message.id);
    return;
  }

  try {
    const { txHash } = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    await this.payoutRepository.markPayoutSent(payout.id, txHash);
    await this.payoutRepository.settlePayout(payout.accountId, payout.id, payout.amount);
    await this.payoutRepository.markMessageCompleted(message.id);
  } catch {
    const current = await this.payoutRepository.getMessage(message.id);
    const attempts = (current?.attempts ?? 0) + 1;

    if (attempts >= MAX_RETRIES) {
      await this.payoutRepository.markPayoutNeedsReview(payout.id);
      await this.payoutRepository.markMessageFailed(message.id);
    } else {
      await this.payoutRepository.incrementMessageAttempts(message.id);
      await this.payoutRepository.releaseMessageForRetry(message.id);
    }
  }
}
```

Wait, but there's a subtle issue. When I call `markMessageCompleted`, the message is set to COMPLETED. Then in the next poll, `getPendingMessages` won't find it. But the message might already be COMPLETED from the first processing. If I requeue it to PENDING and process again, my status check catches it. Good.

Actually, I realize my test for duplicate delivery above already works with this update. Let me proceed.

Now, for the retry exhaustion test, let me trace:
1. Create payout with amount 1000 → account reserved 1000
2. Provider fails consistently
3. First processMessages: claim message, provider fails, increment attempts (1), release to PENDING
4. Second processMessages: claim message, provider fails, increment attempts (2), release to PENDING
5. Third processMessages: claim message, provider fails, increment attempts (3), release to PENDING
6. Fourth processMessages: claim message, provider fails, attempts (3 >= MAX_RETRIES=3), mark NEEDS_REVIEW, mark FAILED

Wait, let me trace the attempts more carefully:
- Initial: attempts = 0, status = PENDING
- Process 1: claim (PENDING → PROCESSING), provider fails, attempts becomes 1, release to PENDING
- Process 2: claim (PENDING → PROCESSING), provider fails, attempts becomes 2, release to PENDING
- Process 3: claim (PENDING → PROCESSING), provider fails, attempts becomes 3, check: 3 >= 3 → NEEDS_REVIEW, FAILED

So after 3 processing attempts (3 calls to processMessages that successfully claim the message), the payout is NEEDS_REVIEW.

In my test:
```typescript
for (let i = 0; i < MAX_RETRIES; i++) {
  await service.processMessages();
}
```

This runs processMessages 3 times. Each time, if the message is PENDING, it claims and processes it. After 3 iterations, attempts should be 3 (>= MAX_RETRIES), payout should be NEEDS_REVIEW.

But wait: in each iteration, the flow is:
1. getPendingMessages → finds the message (PENDING)
2. claimMessage → PENDING → PROCESSING
3. provider fails
4. attempts = current.attempts + 1
5. If attempts >= MAX_RETRIES → NEEDS_REVIEW/FAILED
   Else → increment attempts, release to PENDING

Let me trace:
- Iteration 1: current.attempts = 0, after: attempts = 1, released to PENDING (1 < 3)
- Iteration 2: current.attempts = 1, after: attempts = 2, released to PENDING (2 < 3)
- Iteration 3: current.attempts = 2, after: attempts = 3, 3 >= 3 → NEEDS_REVIEW/FAILED

So 3 iterations are needed. And `MAX_RETRIES = 3`. In my test, `for (let i = 0; i < MAX_RETRIES; i++)` runs 3 times. ✓

Now let me also consider: what if the message status is PROCESSING after the claim but the provider fails? The release sets it back to PENDING. OK.

Also, what about the first call to processMessages where the message might be claimed but then the provider succeeds? In my retry test, the provider always fails, so it goes through the error path every time.

Wait, there's another issue. In `processSingleMessage`, I have:

```typescript
if (payout.status === PayoutStatus.SENT || payout.status === PayoutStatus.COMPLETED) {
  await this.payoutRepository.markMessageCompleted(message.id);
  return;
}
```

This handles the case where a message is requeued but the payout is already SENT. But in the retry test, the payout never reaches SENT (provider always fails), so this check doesn't trigger. Good.

But wait: what if after the first failure, the message is released to PENDING, and then on the next poll, a different worker instance or process sees it? The status check would pass (payout is not SENT), and it would try again. This is correct for retry.

Let me now make sure the retry exhaustion test correctly expects the provider to be called 3 times (once per processing attempt).

OK, I think my design is solid. Let me finalize all the code now.

One more thing: I need to make sure the `PrismaClient` types include my models and enums. After running `npx prisma generate`, the types are generated. But since I'm writing code, I need to reference the types. In the repository, I use `any` for the result of `$executeRaw` which is fine.

Also, I need to make sure `@prisma/client` is imported correctly.

Let me also think about potential issues:

1. In `settlePayout`, I use `{ decrement: amount }` in Prisma. For BigInt, this should work if the schema defines the field as `BigInt`.

2. The `onDelete: Restrict` in the schema ensures we can't delete accounts that have related records. Good for safety.

3. The `@unique` on `idempotencyKey` provides an additional safety net for idempotency, in case the transaction-level check fails (which shouldn't happen but defense in depth).

Now let me also write the DESIGN.md:

### DESIGN.md

```markdown
# Funds-Safety Design

1. **Reserve, don't debit.** Accounts track `settled_balance` (confirmed funds) and `reserved_balance` (held for in-flight payouts). Creation only moves reserved; settled changes on settlement.

2. **Atomic check-and-reserve.** The conditional UPDATE `(settled - reserved) >= amount` is a single database statement the DB serializes. Concurrent racers: exactly one wins.

3. **Transactional enqueue.** The message row is inserted in the same transaction as the reservation. No orphaned reservations or orphaned queue entries.

4. **Claim-guarded worker.** Messages transition PENDING→PROCESSING via a conditional UPDATE (1 row affected = claimed). Redelivery hits 0 rows → no-op. A payout already SENT/COMPLETED is also skipped.

5. **Idempotency keys.** A retry with the same `idempotencyKey` returns the existing payout; no second reservation or message.

6. **Settle on confirmation.** Provider success marks SENT; settlement (debit settled, release hold) is a separate operation. If provider.transfer() throws, settlement never runs.

7. **Retry exhaustion = terminal review.** After MAX_RETRIES failures, payout goes to NEEDS_REVIEW with reservation intact. No reversal, because the transfer may have already landed — reverting loses real money.

8. **Integer money.** All amounts are BigInt minor units end-to-end. No float.
```

That's about 10-20 lines. Good.

Now let me finalize and assemble everything. Let me also double-check the file paths and imports.

File structure:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/prisma/prisma.service.ts
src/provider/provider.service.ts
src/payout/payout.module.ts
src/payout/payout.controller.ts
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/payout/payout.worker.ts
src/payout/payout.types.ts
test/payout.spec.ts
DESIGN.md
```

Import paths:
- payout.service.ts → ../provider/provider.service
- payout.repository.ts → ./payout.service (for InsufficientFundsError) or ./payout.types
- payout.worker.ts → ./payout.service
- payout.controller.ts → ./payout.service
- payout.module.ts → ../prisma/prisma.service, ./payout.controller, etc., ../provider/provider.service

Let me verify all imports are correct.

payout.service.ts imports:
- @nestjs/common (Injectable, NotFoundException)
- ./payout.repository (PayoutRepository)
- ../provider/provider.service (BlockchainProvider)
- ./payout.types (CreatePayoutDto, MAX_RETRIES, MessageStatus, PayoutStatus, LedgerType, InsufficientFundsError)

payout.repository.ts imports:
- @nestjs/common (Injectable)
- @prisma/client (PrismaClient, Prisma)
- ./payout.types (CreatePayoutDto, PayoutStatus, MessageStatus, LedgerType, InsufficientFundsError)
- ./payout.service (InsufficientFundsError) — WAIT, I have it in types too. Let me just keep it in types.

Actually, let me just define InsufficientFundsError in payout.types.ts and import it from there in both files. That avoids the circular dependency (service imports repository, repository imports service).

Wait, does the repository need to import from service? Let me check:
- repository.ts: needs InsufficientFundsError to throw it
- service.ts: needs to catch it

If both import from types.ts, no circular dependency.

OK let me put InsufficientFundsError in types.ts.

But wait, payout.types.ts is imported by payout.service.ts. And payout.service.ts is imported by payout.repository.ts? No, actually payout.repository.ts does NOT import payout.service.ts. Let me check:

payout.repository.ts:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { CreatePayoutDto, PayoutStatus, MessageStatus, LedgerType, InsufficientFundsError } from './payout.types';
```

It imports from payout.types.ts only. No circular dependency.

payout.service.ts:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { BlockchainProvider } from '../provider/provider.service';
import { CreatePayoutDto, MAX_RETRIES, MessageStatus, PayoutStatus, LedgerType, InsufficientFundsError } from './payout.types';
```

Also no circular dependency.

Good. Let me finalize.

Now, one thing about the repository - it injects `PrismaService` but I wrote the type as `PrismaClient`. Let me fix:

```typescript
constructor(private readonly prisma: PrismaService) {}
```

And I need to import PrismaService from the correct path.

Actually, since PrismaService extends PrismaClient, using PrismaClient as the type parameter doesn't matter. I can use either. Let me use PrismaService for clarity.

Let me also handle the return type of `$executeRaw`. The `rowCount` property is available on the result. In Prisma, the result of `$executeRaw` for an UPDATE is a `Statement` type that has a `rowCount` property. The type is `Prisma.#Statement`. Let me just cast appropriately.

```typescript
const result = await tx.$executeRaw`...`;
const rowsAffected = (result as { rowCount: number }).rowCount;
```

OK, I think I have everything. Let me now write the complete final code.

Oh wait, one more thing. In the `getPendingMessages` method of the repository, I need to make sure the messages have their payoutId and other fields accessible to the service. The MessageRecord interface I defined has all the needed fields.

Also, the `processSingleMessage` method in the service takes a message object. It needs `id` and `payoutId`. The MessageRecord from the repository has both. ✓

Let me also ensure the test file properly references everything.

In the test:
- `service` is PayoutService
- `repository` is PayoutRepository
- `provider` is BlockchainProvider
- `prisma` is PrismaService (the DB client)

The test uses:
- `prisma` to set up/clean data and verify state
- `service` to test behavior
- `provider` to mock the blockchain

One concern: the test uses `service.create` which calls `repository.createPayoutWithReservation` which uses `prisma.$transaction`. This should work with a real database.

But if I'm using `@nestjs/testing` with `Test.createTestingModule`, and the module uses a real PrismaService that connects to a database... I need to make sure the database is available.

For the test, let me add a setup that ensures the database connection works.

Actually, for a unit test approach, I could mock the repository and provider, but the spec says "test the behaviour, not the implementation" and "never assert only that a call happens." So I should use real behavior as much as possible.

Let me write the test as an integration test that uses a real database and mocks only the provider. The test file will need the database to be available (via DATABASE_URL env var).

For the test setup, I'll:
1. Import PayoutModule (which brings in PrismaService, etc.)
2. Override the BlockchainProvider with a mock
3. Set up/clean database before each test
4. Run tests

The DATABASE_URL should be set to a test database.

Let me also check if there might be issues with the `onModuleInit` of PrismaService trying to connect during tests. It should be fine as long as DATABASE_URL is set.

OK let me finalize everything now. I'll write the complete code.

Actually, let me reconsider one thing about the provider path. I have `src/provider/provider.service.ts` which creates a `src/provider/` directory. Let me also create the module import. Actually, since it's just a provider (not a module), I don't need a separate module file. It's registered directly in PayoutModule's providers.

But wait, I'm referencing `../provider/provider.service` from `src/payout/payout.service.ts`. That means the provider is at `src/provider/provider.service.ts`. ✓

Let me finalize all files now. I'll be comprehensive.

Oh, one more thing. I need to think about whether `prisma.message.findMany` or `prisma.message.findUnique` will work given my schema. The Prisma client is generated from the schema. Since I'm using snake_case with @map, the Prisma client will still use camelCase for field names in the JS/TS API. Wait, actually, with @map, the Prisma client uses the mapped (database) names for the table but the camelCase (or original) names for the fields.

Hmm, let me think about this more carefully. When I define:
```prisma
model message {
  id        String        @id @default(uuid())
  payoutId  String        @map("payout_id")
  ...
}
```

In the Prisma client, the model name is `message` (lowercase). The field `payoutId` stays `payoutId` in the TypeScript API, but the database column is `payout_id`.

So in my repository:
```typescript
await this.prisma.message.findMany({ where: { status: MessageStatus.PENDING } });
```

This should work. `message` is the Prisma model name. `status` is the field name. ✓

But wait, the enum `message_status` in the schema maps to what in Prisma? Prisma should create a TypeScript type `MessageStatus` with the enum values. Let me check...

In Prisma, enum types become TypeScript enums. `message_status` becomes `message_status` enum in TypeScript. But actually, Prisma generates it as `MessageStatus` (PascalCase) in the client. Let me verify.

Actually, Prisma generates TypeScript enums from database enums. The Prisma client TypeScript enum name matches the model name in PascalCase: `message_status` → `MessageStatus` in the generated types.

Wait, no. In newer Prisma versions, enums are generated as TypeScript const enums or regular enums with the name as defined in the schema. Let me check:

```prisma
enum message_status {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

In Prisma Client TypeScript, this becomes:
```typescript
export enum message_status {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  ...
}
```

Hmm, the name is `message_status` (snake_case). So in my code, I should import it as `message_status` from `@prisma/client`.

But I've defined my own `MessageStatus` enum in `payout.types.ts`! I should use my own enum instead of the Prisma-generated one.

This means in the repository, when I do:
```typescript
const rows = await this.prisma.message.findMany({
  where: { status: MessageStatus.PENDING },
});
```

The `MessageStatus.PENDING` is `'PENDING'`, which matches the Prisma enum value. So it works! ✓

But wait, the `where: { status: MessageStatus.PENDING }` — Prisma might expect the Prisma-generated enum type, not mine. But since they have the same string values, TypeScript's structural typing should accept it.

Actually, with strict TypeScript, Prisma might complain because the type of `status` in the where clause is `message_status` (Prisma's enum), not my `MessageStatus`. Let me check.

In Prisma, the `where` clause for `status` would expect type `message_status | null` or `message_status[]`. If I pass `MessageStatus.PENDING` (which is `'PENDING'`), TypeScript might complain because `'PENDING'` is assignable to `message_status` (since `message_status.PENDING = 'PENDING'`), but the type check depends on strictness.

To avoid this issue, I could:
1. Import Prisma's enum and use it in the repository (but then I need to align with my own types)
2. Use `as` casts
3. Use raw string literals in where clauses

Let me just import the Prisma types and use them in the repository for database operations, and use my own types in the service layer.

Actually, the simplest approach: in the repository, use string literals for status values, or cast. Let me not overthink this and just make it work.

Let me update the repository to handle this properly. I'll use Prisma's enum types internally and my custom types at the boundary (in the service).

Actually, looking at this again, my MessageStatus enum in payout.types.ts has the same values as Prisma's message_status enum. In TypeScript, both are string literal unions: `'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'`. TypeScript should accept either where the other is expected (structural typing).

So `where: { status: MessageStatus.PENDING }` where `MessageStatus.PENDING = 'PENDING'` should work even if Prisma expects `message_status` type, because `'PENDING'` is a member of that type. TypeScript's structural typing allows this.

OK, let me stop overthinking and write the final code.

One last thing: in the Prisma schema, the `payout.status` field is of type `payout_status` (the database enum). When I create a payout with `status: PayoutStatus.CREATED`, and `PayoutStatus.CREATED = 'CREATED'`, this should be compatible. ✓

Let me also handle the `findFirst` vs `findUnique` for idempotency key lookup. `idempotencyKey` has a unique constraint, so I can use `findUnique` or `findFirst`. Let me use `findUnique` for consistency.

Wait, `findUnique` requires the where parameter to include the unique field. `idempotencyKey` has `@unique`, so:
```typescript
await tx.payout.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
```

But there's a catch: in Prisma, `findUnique` can take any unique criterion. Since `idempotencyKey` is marked as `@unique`, it should work. ✓

But also, `id` is implicitly unique (it's @id). So `findUnique({ where: { id } })` also works.

OK let me finalize. I'll write each file now.

Let me also consider: should I include a `ConfirmationService` or endpoint for the "confirm payout" flow? In the real system, this would be triggered by a webhook from the blockchain provider. For this exercise, I included `confirmPayout` in the service. But maybe I should also have a worker that handles confirmation.

For simplicity, let me just have the `confirmPayout` method in the service (which could be called from a webhook controller or another worker). I won't create a separate endpoint or worker for it in this exercise.

But actually, looking at my processSingleMessage, I'm calling `settlePayout` right after `markPayoutSent`. This means settlement happens immediately after send, not on a separate confirmation. Let me reconsider.

The spec says: "Settlement happens on confirmation, never on send." So I should NOT settle immediately after send. There should be a separate confirmation step.

Let me adjust:

1. `processMessages()`: calls provider, marks SENT (no settlement)
2. Confirmation mechanism (separate): marks COMPLETED + settles

In the service:
```typescript
// processMessages: send phase only
try {
  const { txHash } = await this.provider.transfer({...});
  await this.payoutRepository.markPayoutSent(payout.id, txHash);
  await this.payoutRepository.markMessageCompleted(message.id);
  // NO settlement here!
} catch {
  // error handling
}

// confirmPayout: settlement phase
async confirmPayout(payoutId: string): Promise<void> {
  // Mark COMPLETED + settle
  await this.payoutRepository.markPayoutCompleted(payout.id);
  await this.payoutRepository.settlePayout(...);
}
```

But wait, then for the test, I need to call `confirmPayout` separately. Let me adjust the duplicate delivery test to also confirm.

And for the retry exhaustion test, since the payout never reaches SENT (provider fails), there's no confirmation. The payout goes to NEEDS_REVIEW.

Let me think about the tests:
1. Concurrent creation: doesn't involve provider at all ✓
2. Duplicate message delivery: involves provider (success), then redelivery. Should test: one transfer, then redelivery does nothing.
3. Retry exhaustion: provider fails, retry limit reached.

For test 2, the flow is:
a. Create payout (account reserved, message PENDING)
b. processMessages() → provider.transfer() succeeds → payout SENT, message COMPLETED
c. simulate redelivery → message back to PENDING
d. processMessages() → sees payout is SENT → mark message COMPLETED, NO provider call, NO settlement
e. Assert: one transfer, one settlement (from step b? No, no settlement in step b!)

Hmm, but if I don't settle in step b, then there's no settlement to test for the duplicate scenario. Let me restructure.

Actually, let me add a confirmation step to the test for duplicate delivery:
a. Create payout
b. processMessages() → SENT, message COMPLETED
c. confirmPayout() → COMPLETED, settled, ledger entry
d. Simulate redelivery → message back to PENDING
e. processMessages() → payout is COMPLETED → mark message COMPLETED (no-op)
f. Assert: provider called once, one settlement, one ledger entry

But wait, processMessages() in step e would find the message in PENDING state. It would claim it, then check payout status. Payout is COMPLETED. What does my service do?

Let me update the service to handle this:

```typescript
if (payout.status === PayoutStatus.SENT || payout.status === PayoutStatus.COMPLETED) {
  await this.payoutRepository.markMessageCompleted(message.id);
  return;
}
```

Yes, this covers both SENT and COMPLETED. ✓

But now, in step e, the message is marked COMPLETED. Then processMessages() is done. The message is COMPLETED. If I simulate redelivery again (back to PENDING), it would be processed again and marked COMPLETED. No provider call. ✓

This works. Let me adjust the test:

```typescript
describe('duplicate message delivery', () => {
  it('processes the same message only once even when redelivered after confirmation', async () => {
    const dto = makeDto({ amount: BigInt(1000), idempotencyKey: 'idem-dup' });
    const payout = await service.create(dto);

    // First delivery: send
    await service.processMessages();
    let dbPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(dbPayout?.status).toBe(PayoutStatus.SENT);
    expect(provider.transfer).toHaveBeenCalledTimes(1);

    // Confirmation: settlement
    await service.confirmPayout(payout.id);
    dbPayout = await prisma.payout.findUnique({ where: { id: payout.id
```

## reply

(empty)
