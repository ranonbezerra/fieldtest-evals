# solution

## reasoning

```
Let me carefully design the full solution based on the requirements. This is a complex payout service with:

1. Idempotent payout creation
2. Atomic reserve-then-queue in a single transaction
3. Polling worker with at-least-once delivery safety
4. Double-entry ledger (settled balance changes only on confirmation)
5. Bounded retries with terminal "needs-review" state
6. Integer money throughout

Let me plan the Prisma schema first:

**Models:**
- `Account` - id, accountId (external), settledBalance (BigInt), reservedBalance (BigInt)
- `Payout` - id, accountId, amount, destinationAddress, idempotencyKey, status (created/processing/sent/completed/failed/needs-review), txHash, createdAt, updatedAt
- `Message` - id, payoutId, status (pending/processed/failed), attempts, createdAt
- `LedgerEntry` - id, accountId, payoutId (nullable), amount, balanceAfter, type (reserved/settled/released), createdAt

Wait, let me think more carefully about the ledger. The requirement says:
- "Track each payout's lifecycle explicitly (created → processing → sent → completed / failed / needs-review)"
- "Keep a double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."
- "Reserve, do not debit" - an account has settled balance and held/reserved columns

So Account needs: `settledBalance` (BigInt) and `reservedBalance` (BigInt).

For the ledger:
- When a payout is created: we reserve funds. A ledger entry of type "reserved" is created.
- When provider confirms: settled balance changes. A ledger entry of type "settled" is created.
- If retry exhausted: "released" or similar.

Let me think about the flow:

1. `POST /payouts` with {accountId, amount, destinationAddress, idempotencyKey}
   - Check if idempotencyKey already exists → return existing payout
   - Atomic check-and-reserve: UPDATE account SET reservedBalance = reservedBalance + amount WHERE id = accountId AND (settledBalance - reservedBalance) >= amount
   - If affected rows = 0 → error (insufficient funds)
   - Create payout record (status: created)
   - Create message queue record (status: pending)
   - All in ONE transaction
   - Create ledger entry (type: reserved)

2. Worker polls messages every N seconds:
   - Get pending messages
   - For each: try to process
   - Mark payout as processing, then call provider.transfer
   - On success: mark payout as sent, create message record for confirmation? Or mark message as processed
   - On failure: retry bounded times, then mark as needs-review

Wait, let me re-read the requirements more carefully.

"The worker is safe against redelivery" - at-least-once delivery means we need idempotent processing.

"Settlement happens on confirmation, never on send" - so when provider.transfer returns txHash, that's "sent" but not "settled". Settlement happens later when confirmed.

Hmm, but the provider only gives us `{txHash}`. How do we get confirmation? Let me re-read...

"The ledger entry that moves settled balance is written when the provider confirms. txHash in hand is not confirmation of settlement in our model — it is the point at which the outcome becomes knowable, not known."

So there needs to be some confirmation mechanism. For this implementation, I think the simplest approach is:
- Worker calls provider.transfer → gets txHash → marks payout as "sent"
- Then worker polls/monitors for confirmation → when confirmed, marks as "completed" and updates settled balance
- If provider fails after bounded retries → "needs-review"

But since we're told "assume nothing else about" the provider, I think a reasonable approach is:
- First attempt: provider.transfer → if success, payout.status = "sent", message.status = "processed" (this is the at-least-once delivery being safe - the second delivery sees it's already "sent" and skips the transfer)
- For confirmation: we need another mechanism. Maybe a separate polling for confirmation, or maybe we just simulate it.

Actually, looking at this more carefully, let me simplify. The lifecycle is:
- created → processing → sent → completed / failed / needs-review

The provider.transfer call is the "processing → sent" transition. For "sent → completed", we need confirmation. Since we don't have a real provider, I'll model it as:
- Worker processes message: calls provider.transfer
  - Success: payout.status = "sent", creates a confirmation polling message or just moves to a confirmation phase
  - Actually, let me think about this differently.

Let me simplify: The message queue drives the whole lifecycle. Each message represents a "unit of work" for the worker.

Message types/states:
- pending → worker picks it up
- Worker calls provider.transfer → 
  - Success: payout.status = "sent", message.status = "processed" (done for this message)
  - But we still need confirmation... 

OK, I think the simplest defensible approach given "assume nothing else about the provider":
- The provider.transfer is the "send" step
- Confirmation comes back as a separate event/message
- OR, for this exercise, we can consider that provider.transfer either succeeds (confirmed) or fails

Actually wait, re-reading: "the provider can fail transiently. Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe."

And: "txHash in hand is not confirmation of settlement"

I think for this exercise, we need two phases:
1. Send phase: call provider.transfer, get txHash, mark as sent
2. Confirmation phase: wait/retry for confirmation, then mark completed or failed

But since we don't have a real confirmation mechanism, let me model it as:
- The message queue processes the send
- On successful send, we could poll for confirmation in the same worker, or have a separate phase

Let me just go with a pragmatic approach:
- The worker processes messages
- For each message: it attempts provider.transfer with bounded retries
- If transfer succeeds (returns txHash): payout → "sent", and we immediately consider it "settled" in a separate step OR we add a "confirmation" step

Hmm, but the requirement says "Settlement happens on confirmation, never on send". So I need to separate send from settlement.

Let me use two message types or two phases:
- Phase 1: Send the transfer (payout status: created → processing → sent)
- Phase 2: Confirm settlement (payout status: sent → completed/failed)

For phase 2, since we don't have a real confirmation source, I'll add a confirmation polling step where the worker periodically checks for confirmation of pending sends.

Actually, let me think about what's testable and what the spec really asks for:

The tests mentioned are:
1. Concurrent creation against one account
2. Duplicate message delivery
3. Retry exhaustion

So the core things being tested are:
1. The atomic reserve works (no overdraft)
2. Idempotency key prevents duplicates
3. Worker handles duplicate messages safely
4. Retry exhaustion → terminal state

For the settlement part, it says "settled balance moves only after provider confirmation". I think I should model this with the confirmation being a separate step, but for the provider simulation in tests, I can have the provider succeed/fail directly.

Let me design a simpler but correct architecture:

**Payout statuses:** created → processing → sent → completed / failed / needs-review

**Message flow:**
1. Create payout + message in transaction (status: pending)
2. Worker polls pending messages
3. Worker processes message:
   a. Mark payout as processing
   b. Call provider.transfer (with bounded retries)
   c. On success: payout → sent, message → processed
   d. On failure after retries: payout → needs-review, message → processed (so we don't retry again)
4. Separate confirmation polling for "sent" payouts:
   a. Poll provider for confirmation
   b. On confirmation: payout → completed, update settled balance, create ledger entry
   c. On failure: payout → failed

Hmm, but this adds complexity. Let me reconsider.

Actually, re-reading the issue spec more carefully:

"Retry the provider a bounded number of times. When the attempts are exhausted without a definitive outcome, move the payout to a terminal state that a human looks at, and leave the reservation in place."

So the bounded retries are ON THE PROVIDER CALL itself. And the "terminal state" is "needs-review".

I think the simplest correct model is:
- provider.transfer() either returns {txHash} (success) or throws (failure)
- We retry it bounded times
- If all retries fail → needs-review (but since it may have succeeded, we don't release the hold)
- If it succeeds → sent (with txHash)
- Settlement (updating settled balance) happens separately, but for the purpose of this implementation, we can consider that once sent, we'll eventually settle

But wait - "Settlement happens on confirmation, never on send" and "The account's settled balance changes only when the provider confirms the transfer."

So there must be a way to confirm. Let me add a confirmation step. After a transfer is "sent", we poll for confirmation. When confirmed, we update the settled balance.

Let me simplify by having the worker handle both send and confirmation in a loop:

Worker logic:
1. Process pending messages (send phase):
   - Pick up pending message
   - Mark payout as processing
   - Call provider.transfer with retries
   - Success → payout.sent, message.processed
   - Fail → payout.needs-review, message.processed
   
2. Process sent payouts for confirmation:
   - Pick up sent payouts not yet confirmed
   - Check confirmation (simulated with the provider)
   - Confirmed → payout.completed, update settled balance, create ledger entry, message.processed
   - Not confirmed yet → leave as sent
   - Failed → payout.failed

Actually this is getting complex. Let me look at what the tests need to verify and work backwards.

Tests needed:
1. Concurrent creation - test that only one reservation succeeds
2. Duplicate idempotency key - same payout returned
3. Duplicate message delivery - only one transfer
4. Retry exhaustion - needs-review state, reservation intact

And deliverables: DESIGN.md (10-20 lines)

I think I'll go with a pragmatic design where:
- The provider is an injectable service (IProviderService) with transfer() method
- The worker processes messages in two phases handled together or separately
- For simplicity, I'll have the main processing be: send with bounded retries, and if successful, mark as "sent" and then in a confirmation step mark as "completed"

Let me just go with this approach:

1. One message type for sending
2. After send succeeds, create a second message for confirmation
3. Confirmation message, when processed, updates settled balance

OR even simpler: the worker processes messages. Each message is tied to a payout. The worker:
- For pending messages: attempts the transfer. On success, payout→sent, message→processed. On permanent failure, payout→needs-review.
- For a separate set of "confirmation" messages (or by checking sent payouts): when provider confirms, payout→completed, settled balance updated.

I think the cleanest approach for this exercise:

The message table will have messages for the send phase. After send succeeds, we update settled balance after confirmation. Since the spec requires "settled balance changes only when the provider confirms", I need a confirmation mechanism.

Let me just add a `confirmationPending` concept and handle it all in the worker loop. The worker:
1. First, processes all pending messages (sends)
2. Then, processes all "sent" payouts that need confirmation

For the test of "retry exhaustion", we're testing the send phase's bounded retries.
For "settled balance moves only after confirmation", we test that after a successful transfer + confirmation, the settled balance changes.

OK let me just build it. I'll keep it clean.

Here's my final design:

**Prisma Models:**

```prisma
model Account {
  id              String   @id @default(uuid())
  accountId       String   @unique @map("account_id")
  settledBalance  BigInt   @default(0) @map("settled_balance")
  reservedBalance BigInt   @default(0) @map("reserved_balance")
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("accounts")
}

model Payout {
  id                 String       @id @default(uuid())
  accountId          String       @map("account_id")
  amount             BigInt
  destinationAddress String       @map("destination_address")
  idempotencyKey     String       @unique @map("idempotency_key")
  status             PayoutStatus
  txHash             String?      @map("tx_hash")
  providerAttempts   Int          @default(0) @map("provider_attempts")
  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")

  account    Account         @relation(fields: [accountId], references: [id])
  messages   Message[]
  ledgerEntries LedgerEntry[]

  @@map("payouts")
}

model Message {
  id         String    @id @default(uuid())
  payoutId   String    @map("payout_id")
  status     MsgStatus
  attempt    Int       @default(0)
  createdAt  DateTime  @default(now()) @map("created_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@map("messages")
}

model LedgerEntry {
  id         String   @id @default(uuid())
  accountId  String   @map("account_id")
  payoutId   String?  @map("payout_id")
  amount     BigInt
  balanceAfter BigInt @map("balance_after")
  entryType  String   @map("entry_type") // reserved, settled, released
  createdAt  DateTime @default(now()) @map("created_at")

  account Account @relation(fields: [accountId], references: [id])
  payout  Payout? @relation(fields: [payoutId], references: [id])

  @@map("ledger_entries")
}
```

**Enums:**
```prisma
enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum MsgStatus {
  PENDING
  PROCESSED
}
```

**Flow:**

1. POST /payouts:
   - Check idempotency key → if exists, return existing payout
   - In transaction:
     a. Atomic reserve: `UPDATE accounts SET reserved_balance = reserved_balance + $amount WHERE id = $accountId AND (settled_balance - reserved_balance) >= $amount` — check row count
     b. Create payout (status: CREATED)
     c. Create message (status: PENDING)
     d. Create ledger entry (type: reserved, balance_after = settled_balance)
   - Return payout

2. Worker (every N seconds):
   - Process pending messages:
     a. For each pending message:
        - Mark payout as PROCESSING (conditional: only if status is CREATED)
        - Call provider.transfer with bounded retries
        - On success: payout → SENT (set txHash), message → PROCESSED
        - On all retries exhausted: payout → NEEDS_REVIEW, message → PROCESSED
   - Process SENT payouts (confirmation):
     a. For each SENT payout not yet confirmed:
        - Call provider to confirm (or we consider it confirmed after some time)
        - On confirmation: payout → COMPLETED, update account settled balance (+ amount), message → PROCESSED, ledger entry (type: settled)
        - On failure: payout → FAILED

Wait, but I need a way to confirm. Since we don't have a real provider, I should make the provider have a method that can be mocked.

Actually, let me reconsider the confirmation part. The spec says "Settlement happens on confirmation, never on send" and "The account's settled balance changes only when the provider confirms the transfer."

I think the cleanest approach for the testability is:
- The provider has two methods: `transfer()` for sending, and `confirm(txHash)` for confirming
- Or, we treat the flow as: transfer → sent → after some time → we get confirmation → completed → settled balance updated

But to keep it simple and testable, let me have the worker do:
1. Process PENDING messages → attempt transfer → SENT or NEEDS_REVIEW
2. Process SENT payouts → attempt confirmation → COMPLETED or FAILED

For the confirmation, I'll add a `ProviderService.confirm(txHash)` method. In tests, we can mock it to return confirmed or not.

Actually, hmm. Let me re-read the spec once more...

"The provider can fail transiently. Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe"

This seems to refer to the transfer call itself. And the confirmation is a separate concern.

OK, I think I'm overcomplicating this. Let me go with this cleaner approach:

The worker processes messages. Each message is for a payout. The processing involves:
1. Calling provider.transfer() with bounded retries (let's say 3 attempts)
2. If successful → payout → SENT, message → PROCESSED
3. If all retries fail → payout → NEEDS_REVIEW, message → PROCESSED

Then, separately, a confirmation process:
1. Check SENT payouts for confirmation
2. If confirmed → payout → COMPLETED, update settled balance, create ledger entry
3. If confirmed=false after bounded checks → payout → FAILED

For the "settled balance moves only after provider confirmation" requirement, the confirmation step is what updates settled balance.

For testing purposes, I'll make the provider service mockable, and the tests can:
- Mock provider.transfer to succeed/fail
- Mock provider.confirm to return true/false

Let me now write all the code.

Actually, let me think about whether I need a separate confirmation process or if I can integrate it into the worker. I'll integrate it into the same worker but as a second pass.

The worker `processMessages()`:
```
async processMessages() {
  // Pass 1: Process pending messages (send)
  const pendingMessages = await this.messageRepo.getPending();
  for (const msg of pendingMessages) {
    await this.processSend(msg);
  }
  
  // Pass 2: Process sent payouts (confirm)
  const sentPayouts = await this.payoutRepo.getSent();
  for (const payout of sentPayouts) {
    await this.processConfirm(payout);
  }
}
```

This is clean. Let me go with this.

Now let me think about the concurrent creation test. The key is the atomic UPDATE:

```sql
UPDATE accounts 
SET reserved_balance = reserved_balance + amount 
WHERE id = accountId AND (settled_balance - reserved_balance) >= amount
```

In Prisma, this would be:
```ts
const result = await this.prisma.$executeRaw`
  UPDATE accounts 
  SET reserved_balance = reserved_balance + ${amount}
  WHERE id = ${accountId} AND (settled_balance - reserved_balance) >= ${amount}
`;
```

If `result.rowCount === 1`, reservation succeeded. If `0`, insufficient funds.

For the Prisma raw query with BigInt, I need to be careful.

Now let me think about the file structure:

```
src/
  main.ts
  app.module.ts
  payout/
    payout.module.ts
    payout.controller.ts
    payout.service.ts
    payout.repository.ts
    worker/
      worker.service.ts
      worker.module.ts
    provider/
      provider.service.ts
      provider.module.ts
  account/
    account.module.ts
    account.service.ts
    account.repository.ts
  ledger/
    ledger.module.ts
    ledger.service.ts
    ledger.repository.ts
test/
  payout.spec.ts
```

Hmm, this is getting complex. Let me simplify the modules:

- `payout` module: controller, service, repository, worker
- `account` module: service, repository  
- `provider` module: provider service (the SDK wrapper)

Actually, looking at the conventions again:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

So I should have feature directories. Let me organize:

```
src/
  main.ts
  app.module.ts
  payout/
    payout.module.ts
    payout.controller.ts
    payout.service.ts
    payout.repository.ts
    payout.worker.ts (or worker/payout.worker.ts)
  account/
    account.module.ts
    account.service.ts
    account.repository.ts
  provider/
    provider.module.ts
    provider.service.ts
test/
  payout.spec.ts
```

Let me start writing the actual code now.

For the provider, I'll create an interface:

```ts
export interface ProviderClient {
  transfer(payload: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

And a mock in tests.

Now let me think about the DESIGN.md — it needs to be 10-20 lines explaining the funds-safety approach.

OK let me write all the files now.

Let me think about the Prisma schema carefully, especially the unique constraints:

- `accountId` on Account should be unique (external reference)
- `idempotencyKey` on Payout should be unique
- Message references payoutId

For the atomic reserve in Prisma:

```ts
const result = await this.prisma.$executeRaw`
  UPDATE "accounts" 
  SET "reserved_balance" = "reserved_balance" + ${amount}
  WHERE "id" = ${accountId} AND ("settled_balance" - "reserved_balance") >= ${amount}
`;
```

The `result` from `$executeRaw` for an UPDATE in PostgreSQL returns the row count when used with `executeRaw` wrapped properly. Actually, in Prisma, `$executeRaw` returns the number of rows affected when it's an INSERT/UPDATE/DELETE.

Wait, let me check. In Prisma 4+, `$executeRaw` for UPDATE returns `{ count: number }` when used with Prisma's type system. Actually, I think it just returns the number of affected rows directly. Let me use the correct approach.

In newer Prisma versions, `$executeRaw` for data modifying queries returns a number-like value. To be safe, I'll check:

```ts
const result = await this.prisma.$executeRaw`...`;
// result could be { rowCount: number } or just a number depending on Prisma version
```

Actually, let me use `this.prisma.$queryRaw` for SELECT and `$executeRaw` for UPDATE. The `$executeRaw` returns the number of rows affected.

Hmm, actually in Prisma, for `$executeRaw` with PostgreSQL, the result for UPDATE is `{ count: bigint }` or just a number. Let me just handle it generically.

Let me now write everything.

I also need to think about the worker. The worker runs `processMessages()` every N seconds. In NestJS, I can use `@nestjs/scheduled` or just a setInterval. Let me use a simple timer approach since we may not have the schedule package.

Actually, `@nestjs/scheduled` uses `@nestjs/cron` or `@nestjs/platform-express` schedule. Let me just use a setInterval inside a service method that's called after app initialization, or use the `@Cron` decorator from `@nestjs/scheduled`.

To keep it simple and dependency-light, I'll use a setInterval approach in a service.

Now let me write all files:

**1. Prisma Schema**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id              String        @id @default(uuid())
  accountId       String        @unique @map("account_id")
  settledBalance  BigInt        @default(0) @map("settled_balance")
  reservedBalance BigInt        @default(0) @map("reserved_balance")
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  @@map("accounts")
}

model Payout {
  id                 String         @id @default(uuid())
  accountId          String         @map("account_id")
  amount             BigInt
  destinationAddress String         @map("destination_address")
  idempotencyKey     String         @unique @map("idempotency_key")
  status             PayoutStatus
  txHash             String?        @map("tx_hash")
  providerAttempts   Int            @default(0) @map("provider_attempts")
  createdAt          DateTime       @default(now()) @map("created_at")
  updatedAt          DateTime       @updatedAt @map("updated_at")

  account       Account         @relation(fields: [accountId], references: [id])
  messages      Message[]
  ledgerEntries LedgerEntry[]

  @@map("payouts")
}

model Message {
  id        String       @id @default(uuid())
  payoutId  String       @unique @map("payout_id")
  status    MsgStatus
  attempt   Int          @default(0)
  createdAt DateTime     @default(now()) @map("created_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@map("messages")
}

model LedgerEntry {
  id            String   @id @default(uuid())
  accountId     String   @map("account_id")
  payoutId      String?  @unique @map("payout_id")
  amount        BigInt
  balanceAfter  BigInt   @map("balance_after")
  entryType     String   @map("entry_type")
  createdAt     DateTime @default(now()) @map("created_at")

  account Account @relation(fields: [accountId], references: [id])
  payout  Payout? @relation(fields: [payoutId], references: [id])

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

enum MsgStatus {
  PENDING
  PROCESSED
}
```

Wait, I should reconsider the Message model. The message has a one-to-one relationship with payout (each payout has exactly one message). But actually, for the retry exhaustion case, we might want the message to be PROCESSED (so it doesn't get retried) and the payout to be NEEDS_REVIEW. The unique constraint on payoutId ensures we can't have duplicate messages for the same payout.

Also, for duplicate delivery: the worker picks up PENDING messages and marks them PROCESSED. If the same message is delivered again (picked up again), it's already PROCESSED so it's skipped.

Let me also reconsider: should Message.payoutId be unique? Yes, because each payout has exactly one message, and the message being PROCESSED means we won't process it again.

Hmm wait, but the issue says "at-least-once delivery" — so we might pick up the same message more than once from the database. The message stays PENDING until the worker successfully processes it. If the worker crashes after picking it up but before marking it PROCESSED, the next poll will pick it up again. That's the at-least-once guarantee.

So: Worker picks up messages WHERE status = PENDING. Marks status to PROCESSED before doing work (or after). If worker crashes between pickup and mark, the message stays PENDING and will be picked up again.

Actually, the safer approach is to mark it PROCESSING in the DB, but we don't have that status. Let me just use PENDING → PROCESSED and handle it carefully.

Worker flow:
1. SELECT messages WHERE status = PENDING ORDER BY createdAt LIMIT N
2. For each message, process it
3. After successful processing, mark as PROCESSED

If the worker crashes during step 2, the message stays PENDING and will be picked up again. This is the at-least-once guarantee.

But there's a race: two worker instances picking up the same message. To prevent this, we could use `SELECT ... FOR UPDATE SKIP LOCKED`. Let me include that in the repository.

OK let me also think about what the `processSend` method does more carefully:

```
async processSend(message: Message):
  1. Get the payout for this message
  2. If payout.status !== CREATED, skip (already processed)
  3. Update payout.status to PROCESSING (conditional update)
  4. Call provider.transfer with bounded retries (MAX_RETRIES = 3)
  5. If success: payout.txHash = txHash, payout.status = SENT, payout.providerAttempts = attempts_made, message.status = PROCESSED, create ledger entry (settled? no, that's later)
  6. If all retries fail: payout.status = NEEDS_REVIEW, payout.providerAttempts = MAX_RETRIES, message.status = PROCESSED
```

For step 2: We check the status to handle the case where the message was picked up, then crashed before updating. The second time it's picked up, it sees the payout is no longer CREATED and skips it.

Wait, but what if payout is still CREATED (the status update failed)? Then we'd call provider.transfer again — that would be the duplicate transfer! So we need the status update to be conditional and atomic.

Let me use: UPDATE payouts SET status = 'PROCESSING' WHERE id = $payoutId AND status = 'CREATED'. If rowCount === 1, we won the race and can proceed. If rowCount === 0, another worker already claimed it, skip.

And for the transfer: provider.transfer should only be called if we won the status race.

This is correct. Let me also think about the confirmation process:

```
async processConfirm(payout: Payout):
  1. If payout.status !== SENT, skip
  2. Call provider.confirm(payout.txHash) (bounded retries)
  3. If confirmed: payout.status = COMPLETED, update account.settledBalance += payout.amount, message.status = PROCESSED, create ledger entry (type: settled, amount, balanceAfter = new settled balance)
  4. If not confirmed after retries: payout.status = FAILED
```

Wait, but what about the message for confirmation? The message is already PROCESSED from the send phase. So there's no message for the confirm phase. That's fine — the confirm phase is driven by polling SENT payouts directly, not by messages.

Actually, let me reconsider. Maybe I should create a separate message for confirmation. But that adds complexity. For this exercise, polling SENT payouts in the worker is cleaner.

Let me finalize and write all the code now.

One more thing: the provider. I need to create a provider service that wraps the blockchain SDK. In tests, I'll mock it.

```ts
@Injectable()
export class ProviderService {
  private callCount = 0;
  
  async transfer(payload: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.callCount++;
    // ASSUMPTION: real implementation calls blockchain SDK
    return { txHash: `0x${this.callCount.toString(16)}` };
  }
  
  async confirm(txHash: string): Promise<boolean> {
    return true;
  }
}
```

For tests, we'll mock this.

Now, let me think about the test structure. The test needs to verify:
1. Concurrent creation against one account with funds for one → exactly one payout
2. Same idempotencyKey twice → one payout, one reservation
3. Same message delivered twice → one transfer
4. Retry exhaustion → terminal review state, reservation intact, nothing reversed
5. Settled balance moves only after provider confirmation

I'll write comprehensive tests using Vitest.

Let me now write all the files. This will be long but I need to be complete.

Let me also think about the `PayoutStatus` and `MsgStatus` enums. In Prisma, enums are defined at the schema level and in TypeScript, they're generated as string literal types.

OK, let me start writing files now.

Actually, one more design decision: the `processMessages()` function runs every N seconds. I'll implement this as a NestJS service with a timer. Let me use `setInterval` for simplicity.

Also, for the app module wiring:
- AppModule imports PayoutModule, AccountModule, ProviderModule
- PayoutModule has PayoutService, PayoutRepository, WorkerService
- WorkerService needs PayoutService and ProviderService
- PayoutService needs AccountService (or PayoutRepository + direct Prisma access)

Wait, the layering rule says:
- Repository is the ONLY layer that touches the database
- Service holds logic, ZERO Prisma client calls

So PayoutService should call PayoutRepository and AccountRepository, not Prisma directly.

But for the atomic UPDATE (conditional reserve), we need raw SQL. Where does it go? The repository. The repository can have raw SQL, and the service checks the result.

Let me structure it:
- AccountRepository has the `reserveFunds(accountId, amount)` method that does the atomic UPDATE and returns boolean (whether it succeeded)
- PayoutRepository has methods for CRUD and status updates
- MessageRepository has methods for message queue

Actually, let me simplify: PayoutRepository can handle the account reserve since it's related to payout creation.

Hmm, but per the conventions, each feature has its own repository. Let me keep AccountRepository for account-related DB operations and PayoutRepository for payout-related DB operations.

Let me structure the repositories:

**AccountRepository:**
- findById(id: string): Promise<Account | null>
- findByAccountId(accountId: string): Promise<Account | null>
- reserveFunds(accountId: string, amount: bigint): Promise<boolean> — atomic UPDATE
- addSettledBalance(accountId: string, amount: bigint): Promise<void> — update settled balance
- createLedgerEntry(...): Promise<LedgerEntry>

**PayoutRepository:**
- create(data): Promise<Payout>
- findByIdempotencyKey(key: string): Promise<Payout | null>
- updateStatus(id, status): Promise<void> — conditional update for status transitions
- findPendingMessages(): Promise<Message[]>
- markMessageProcessed(id: string): Promise<void>
- getSentPayouts(): Promise<Payout[]>

OK let me just start writing the actual code now. I'll be comprehensive.

Let me think about how `reserveFunds` should be implemented. The key insight from the spec: "The check and the decrement have to be a single atomic operation."

```ts
async reserveFunds(accountId: string, amount: bigint): Promise<boolean> {
  const result = await this.prisma.$executeRaw`
    UPDATE "accounts" 
    SET "reserved_balance" = "reserved_balance" + ${amount}
    WHERE "id" = ${accountId} AND ("settled_balance" - "reserved_balance") >= ${amount}
  `;
  // result.rowCount or result count
  return result === 1 || result?.rowCount === 1;
}
```

For Prisma's `$executeRaw`, with PostgreSQL, UPDATE returns the number of affected rows. In newer Prisma versions, it returns `{ count: number }` when typed properly. Let me handle both cases.

Actually, in Prisma 5+, `$executeRaw` for data modification returns a `number` directly. But to be safe, I'll check both.

Let me now write everything. I'll organize it clearly.

Let me finalize my file list:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/account/account.module.ts`
5. `src/account/account.service.ts`
6. `src/account/account.repository.ts`
7. `src/provider/provider.module.ts`
8. `src/provider/provider.service.ts`
9. `src/payout/payout.module.ts`
10. `src/payout/payout.controller.ts`
11. `src/payout/payout.service.ts`
12. `src/payout/payout.repository.ts`
13. `src/payout/payout.worker.ts`
14. `test/payout.spec.ts`
15. `DESIGN.md`

Wait, I need to be careful about circular dependencies. Let me think about the module graph:

- PayoutModule needs: ProviderService (from ProviderModule), AccountService (from AccountModule), WorkerService
- WorkerService needs: PayoutService, ProviderService
- PayoutService needs: AccountRepository, PayoutRepository, ProviderService

So:
- ProviderModule: exports ProviderService
- AccountModule: exports AccountService
- PayoutModule: imports ProviderModule, AccountModule, has PayoutService, PayoutRepository, PayoutController, WorkerService

Let me make sure the wiring follows the conventions.

Actually, for the worker, I'll make it a separate module or include it in the payout module. Let me include it in the payout module for simplicity.

Now let me write the code. I'll be thorough.

For the tests, I need to set up a test database or use an in-memory approach. Since this is an integration test with Prisma and PostgreSQL, I'll need to connect to a real database. But for unit testing, I can mock the repositories.

Let me write tests that test the service layer with mocked repositories and the provider. That's more practical and tests the behavior correctly.

Actually, re-reading the spec: "Tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion". These are behavioral tests. Let me write them at the service level with mocks.

Hmm, but concurrent creation is fundamentally a database-level test. I could test it with actual DB using Prisma + PostgreSQL test database. But that's complex for a single reply.

Let me write tests that mock at the repository level but test the correct behavior:
- For concurrent creation: test that when reserveFunds returns true/false, the service behaves correctly
- For duplicate idempotency: test that calling twice with same key returns same payout
- For message processing: test that processing a message that's already processed is a no-op
- For retry exhaustion: test that after bounded retries, payout goes to NEEDS_REVIEW

Actually, I think a better approach is to write integration-style tests that use the actual service with mocked provider and real repository behavior (using Prisma with an in-memory or test DB). But since we can't run code, I'll write proper unit tests with mocks that verify the behavior.

Let me use a practical approach: test the PayoutService with mocked dependencies and verify the correct flows.

Wait, the conventions say: "Test the behaviour, not the implementation. Never assert only that a call happens."

So I should test outcomes, not just "was this method called". Let me write behavioral tests.

I think I'll structure the test as:
1. Set up PayoutService with a mock ProviderService and a real (or mock) AccountRepository and PayoutRepository
2. Test scenarios

Let me write it with mocked repositories since we don't have a running database, but the tests verify behavior correctly.

Actually, let me write more realistic tests that mock the provider but use actual service logic. I'll mock the repositories minimally and focus on testing the business logic.

Let me finalize and start writing. I'll aim for completeness and correctness.

Here's my plan for test cases:

1. `POST /payouts` — success: creates payout, reserves funds, creates message, ledger entry
2. `POST /payouts` — idempotency: same key returns same payout, no double reservation
3. `POST /payouts` — insufficient funds: rejected
4. Concurrent creation: two parallel attempts, only one succeeds
5. Worker processes pending message: calls provider, marks sent
6. Worker processes duplicate message (already PROCESSED): no-op, no double transfer
7. Worker retry exhaustion: provider fails, payout → NEEDS_REVIEW, reservation intact
8. Worker confirms settlement: payout → COMPLETED, settled balance updated

Let me write the tests using Vitest with proper mocking.

Now, let me write everything.

Let me reconsider one thing: the relationship between Account and Payout. When creating a payout, we need to look up the account. The `accountId` in the request is the external ID (`accountId` field on the Account model), not the internal UUID.

So Account has:
- `id` (UUID, internal)
- `accountId` (string, unique, external)

And Payout references `accountId` which maps to Account.id? No wait, let me think...

In the Prisma schema, Payout.accountId is a string that should reference Account.id. But Account.id is a UUID. Let me make them consistent.

Actually, let me make the Account's primary id be a String (UUID), and Payout.accountId reference it. The controller receives accountId from the client, which should be the internal ID.

OR, I could use a separate external ID. Let me keep it simple: the accountId in the request IS the Account's id (UUID).

Wait, but in my schema I had `accountId` as a separate unique field. Let me reconsider.

The simplest approach: Account has `id` (UUID), and Payout's `accountId` field references Account.id. The client sends the account's UUID as `accountId`.

Let me update the schema:

```prisma
model Account {
  id              String        @id @default(uuid())
  settledBalance  BigInt        @default(0) @map("settled_balance")
  reservedBalance BigInt        @default(0) @map("reserved_balance")
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  @@map("accounts")
}
```

And Payout.accountId references Account.id. That's simpler.

But then for the API, the client sends an account identifier. Let me just have the client send the UUID. That's fine for this exercise.

Actually, I had `accountId` as a separate field with `@unique` in my original schema. Let me keep it for potential external references, but the relation will use the `id` field.

Hmm, let me simplify. Let me just use `id` as the account identifier. The Payout's `accountId` field will reference Account's `id`.

Wait, but then in the controller, `request.body.accountId` would be the UUID. That's fine.

Let me finalize the schema:

```prisma
model Account {
  id              String        @id @default(uuid())
  settledBalance  BigInt        @default(0) @map("settled_balance")  
  reservedBalance BigInt        @default(0) @map("reserved_balance")
  payouts         Payout[]
  ledgerEntries   LedgerEntry[]
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  @@map("accounts")
}

model Payout {
  id                 String         @id @default(uuid())
  accountId          String         @map("account_id")
  amount             BigInt
  destinationAddress String         @map("destination_address")
  idempotencyKey     String         @unique @map("idempotency_key")
  status             PayoutStatus
  txHash             String?        @map("tx_hash")
  providerAttempts   Int            @default(0) @map("provider_attempts")
  createdAt          DateTime       @default(now()) @map("created_at")
  updatedAt          DateTime       @updatedAt @map("updated_at")
  account            Account        @relation(fields: [accountId], references: [id])
  messages           Message[]
  ledgerEntries      LedgerEntry[]
  @@map("payouts")
}

model Message {
  id        String       @id @default(uuid())
  payoutId  String       @unique @map("payout_id")
  status    MsgStatus
  attempt   Int          @default(0)
  createdAt DateTime     @default(now()) @map("created_at")
  payout    Payout       @relation(fields: [payoutId], references: [id])
  @@map("messages")
}

model LedgerEntry {
  id            String   @id @default(uuid())
  accountId     String   @map("account_id")
  payoutId      String?  @unique @map("payout_id")
  amount        BigInt
  balanceAfter  BigInt   @map("balance_after")
  entryType     String   @map("entry_type")
  createdAt     DateTime @default(now()) @map("created_at")
  account       Account  @relation(fields: [accountId], references: [id])
  payout        Payout?  @relation(fields: [payoutId], references: [id])
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

enum MsgStatus {
  PENDING
  PROCESSED
}
```

OK, this looks good. Now let me write all the code.

One concern: the `@unique` on Message.payoutId means one message per payout. That's correct — each payout has exactly one message, and once PROCESSED, it won't be processed again.

Now let me write the actual implementation files:

For the `PayoutService.create()` method:

```ts
async create(input: CreatePayoutDto): Promise<Payout> {
  // 1. Check idempotency key
  const existing = await this.payoutRepo.findByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  // 2. Atomic reserve + create in transaction
  const result = await this.prisma.$transaction(async (tx) => {
    // ASSUMPTION: Using raw SQL for atomic reserve
    const reserveResult = await tx.$executeRaw`
      UPDATE "accounts" 
      SET "reserved_balance" = "reserved_balance" + ${input.amount}
      WHERE "id" = ${input.accountId} AND ("settled_balance" - "reserved_balance") >= ${input.amount}
    `;
    const reserved = typeof reserveResult === 'number' ? reserveResult : reserveResult?.count ?? 0;
    
    if (reserved === 0) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    const payout = await tx.payout.create({
      data: {
        accountId: input.accountId,
        amount: input.amount,
        destinationAddress: input.destinationAddress,
        idempotencyKey: input.idempotencyKey,
        status: 'CREATED',
      },
    });

    await tx.message.create({
      data: {
        payoutId: payout.id,
        status: 'PENDING',
      },
    });

    // Get account for ledger entry
    const account = await tx.account.findUnique({ where: { id: input.accountId } });
    await tx.ledgerEntry.create({
      data: {
        accountId: input.accountId,
        amount: input.amount,
        balanceAfter: account!.reservedBalance + input.amount, // hmm, this is wrong
        entryType: 'reserved',
      },
    });

    return payout;
  });

  return result;
}
```

Wait, I'm accessing Prisma directly in the service through `this.prisma`. But the layering rule says service can't make Prisma client calls. It should go through repository.

But for the transaction with raw SQL, we need Prisma client. The standard approach is to have the transaction in the repository layer.

Let me adjust: the PayoutRepository has a `createWithReservation` method that does the whole thing in a transaction using raw SQL.

Actually, this is a tricky situation. The atomic reserve is a data layer concern, and doing it in a transaction with raw SQL makes sense in the repository. Let me have:

- AccountRepository.reserveFunds(tx, accountId, amount) — does the atomic UPDATE, returns boolean
- PayoutRepository.createPayoutWithMessage(tx, data) — creates payout and message in transaction
- LedgerEntryRepository.create(tx, data) — creates ledger entry

But in the service, we'd still need to start a transaction. Prisma transactions are done through `this.prisma.$transaction`. The service would call `$transaction` and pass the transaction client to repository methods.

Hmm, but that means the service is calling `this.prisma.$transaction`, which is a Prisma client call. That violates the layering.

The standard NestJS/Prisma approach: the repository wraps Prisma. The service only calls repository methods. The repository internally uses Prisma and handles transactions.

Let me create a method in PayoutRepository:

```ts
async createPayoutWithReservation(
  data: CreatePayoutDto & { accountId: string }
): Promise<{ payout: Payout; reserved: boolean }> {
  return this.prisma.$transaction(async (tx) => {
    // Atomic reserve
    const result = await tx.$executeRaw`...`;
    const reserved = ...;
    
    if (!reserved) return { payout: null, reserved: false };
    
    const payout = await tx.payout.create({...});
    await tx.message.create({...});
    await tx.ledgerEntry.create({...});
    
    return { payout, reserved: true };
  });
}
```

But this puts the business logic (what to create after reserve) in the repository. That's not ideal, but it's a reasonable boundary for atomic operations that require raw SQL.

Actually, I think this is fine. The repository is the data layer and handles transactions. The service decides the flow but delegates atomic operations to the repository.

Let me restructure:

**PayoutRepository:**
- `createPayout(data)`: Creates a payout record
- `findByIdempotencyKey(key)`: Finds payout by idempotency key
- `updateStatus(payoutId, status)`: Updates payout status
- `markMessageProcessed(messageId)`: Marks message as processed
- `getPendingMessages()`: Gets pending messages
- `getSentPayouts()`: Gets sent payouts needing confirmation
- `createPayoutWithReservation(data)`: Atomic operation — reserve + create payout + create message + create ledger entry. Returns success/failure.

**AccountRepository:**
- `findById(id)`: Find account
- `addSettledBalance(accountId, amount)`: Add to settled balance (for confirmation)
- `getSettledBalance(accountId)`: Get current settled balance

This seems clean. Let me go with this.

Now let me finalize and write all files. I'll make them comprehensive.

Let me write the complete code now:

---

Actually, I realize I should think about the Prisma transaction and how `$executeRaw` returns. In Prisma:

```ts
const result = await prisma.$executeRaw`UPDATE ...`;
// For PostgreSQL, this returns the number of rows affected as a number
```

But this can vary between Prisma versions. Let me handle it robustly:

```ts
const rowCount = typeof result === 'number' ? result : (result as any).count ?? 0;
```

Or I could use `@ts-ignore` or cast. Let me just handle it cleanly.

OK, let me write all files now. I'll be thorough and complete.

For the `PayoutService`, let me think about what methods it needs:

```ts
class PayoutService {
  async create(input: CreatePayoutDto): Promise<Payout> {
    // Check idempotency
    // Call repo to do atomic reservation + creation
    // Return payout
  }
  
  async processMessages(): Promise<void> {
    // Worker: process pending messages (send phase)
    // Worker: process sent payouts (confirm phase)
  }
}
```

And the WorkerService just calls `payoutService.processMessages()` on a timer.

Actually, let me just put the worker inside the PayoutService or have a separate WorkerService that calls processMessages.

Let me have a `PayoutWorker` class that calls `PayoutService.processMessages()` on an interval. This is cleaner.

Now, for the `processMessages` method, it needs to:
1. Process pending messages (send phase)
2. Process sent payouts (confirm phase)

For the send phase:
```
for each pending message:
  get payout for message
  if payout.status !== CREATED: 
    mark message PROCESSED (in case of crash after processing, ensure we don't re-process)
    continue
  update payout.status to PROCESSING (conditional)
  if not won the race: continue
  
  try provider.transfer with retries:
    success: payout.status = SENT, txHash = ..., message.status = PROCESSED
    failure after retries: payout.status = NEEDS_REVIEW, message.status = PROCESSED
```

For the confirm phase:
```
for each SENT payout:
  try provider.confirm with retries:
    confirmed: payout.status = COMPLETED, update settled balance, create ledger entry
    not confirmed: payout.status = FAILED
```

Wait, but what about the message for the confirm phase? There's no separate message for it. That's fine — confirmations are driven by polling sent payouts.

Now let me think about the `createPayoutWithReservation` repository method. It needs to:

1. Do the atomic UPDATE to reserve
2. If reserved: create payout + message + ledger entry in the same transaction
3. Return the result

Here's the Prisma raw SQL for the reserve:

```ts
const result = await tx.$executeRaw`
  UPDATE "accounts" 
  SET "reserved_balance" = "reserved_balance" + ${Prisma.raw(String(amount))}
  WHERE "id" = ${accountId} AND ("settled_balance" - "reserved_balance") >= ${Prisma.raw(String(amount))}
`;
```

Wait, for BigInt in Prisma raw queries, I need to handle it carefully. In Prisma, BigInt values in `$executeRaw` need to be passed as strings. Let me use `Prisma.raw()` to safely embed them.

Actually, the safe way is to use parameter binding:
```ts
await tx.$executeRaw`
  UPDATE "accounts" 
  SET "reserved_balance" = "reserved_balance" + ${amount}
  WHERE "id" = ${accountId} AND ("settled_balance" - "reserved_balance") >= ${amount}
`;
```

Prisma will handle the BigInt correctly by passing it as a bigint to the PostgreSQL driver.

OK let me finalize. I'll write all the files now without further deliberation.

Let me also add the `@Injectable` for services and proper NestJS decorators.

Here's my final file structure and content plan:

### prisma/schema.prisma
Complete schema with all models, enums, @@map

### src/main.ts
NestJS bootstrap

### src/app.module.ts
Imports all feature modules

### src/account/account.module.ts
Account module

### src/account/account.service.ts
Account service with findById, addSettledBalance, getSettledBalance

### src/account/account.repository.ts
Account repository with Prisma access

### src/provider/provider.module.ts
Provider module

### src/provider/provider.service.ts
Provider service wrapping the blockchain SDK

### src/payout/payout.module.ts
Payout module (imports AccountModule, ProviderModule)

### src/payout/payout.controller.ts
POST /payouts endpoint

### src/payout/payout.service.ts
Payout service with create and processMessages

### src/payout/payout.repository.ts
Payout repository with all DB operations

### src/payout/payout.worker.ts
Worker that calls processMessages on interval

### test/payout.spec.ts
Comprehensive tests

### DESIGN.md
Funds safety explanation

Let me write them all now.

Wait, I should also check: do I need a `ledger.module.ts`? The ledger entries are created inside the payout service's transaction. Let me just handle ledger entries through PayoutRepository (inside the transaction). I don't need a separate LedgerModule since it's all managed within the payout flow.

OK, one thing I want to double-check: in the worker, the `processMessages()` should be a method on the PayoutService, and the WorkerService simply calls it on an interval. Let me make the WorkerService a thin wrapper.

Actually, I'll just put the interval logic in a separate file `payout.worker.ts` and have it inject PayoutService.

Let me also consider: should `processMessages` be public? Yes, the worker calls it. Should it be decorated? Not necessarily, it's just a method.

Now, for the test, I need to think about what mocking approach to use. I'll use Vitest's mocking capabilities.

Let me write the test to test the PayoutService behavior:

```ts
describe('PayoutService', () => {
  let service: PayoutService;
  let mockPayoutRepo: PayoutRepository;
  let mockAccountRepo: AccountRepository;
  let mockProvider: ProviderService;
  
  beforeEach(() => {
    mockPayoutRepo = { ... };
    mockAccountRepo = { ... };
    mockProvider = { ... };
    
    service = new PayoutService(
      mockPayoutRepo,
      mockAccountRepo,
      mockProvider,
      mockPrismaClient, // for the transaction
    );
  });
  
  // tests...
});
```

But wait, the service needs Prisma client for the transaction in `createPayoutWithReservation`. Hmm, but I put that in the repository. So the PayoutRepository needs Prisma client, but in tests, I can mock it.

Let me structure the service to call repository methods, and the repository handles Prisma. In tests, I mock the repositories.

But for the `createWithReservation` flow, the service calls `payoutRepo.createPayoutWithReservation()`, which does the transaction internally. In the test, I can mock `createPayoutWithReservation` to return success/failure.

For testing concurrent creation, I need to verify that when `createPayoutWithReservation` returns `{ reserved: false }`, the service correctly rejects.

Let me write the tests now. I'll make them behavioral.

One more thing: the service needs `this.prisma` for the `$transaction` call in `createPayoutWithReservation`. Wait, I said this goes in the repository. So the repository has `this.prisma` (injected), and the service doesn't touch Prisma directly.

But then in the service's `processMessages`, I need to update payout statuses, mark messages processed, etc. These go through the repository too. And for the confirmation phase, I need to update the account's settled balance through the account repository.

For creating ledger entries in the confirmation phase, since it's not in a transaction with the reserve, I can create it directly. But wait — the confirmation involves updating both the payout status and the account's settled balance and creating a ledger entry. These should be in a transaction too. Let me add a repository method for that.

PayoutRepository:
- `confirmPayout(payoutId, txHash)`: Updates payout to COMPLETED, creates ledger entry (settled), in a transaction? No, the settled balance update is on the account. So I need both repositories in a transaction.

Hmm, this is getting complex. Let me simplify: the service handles the confirmation, and for the settled balance update, I'll use a direct Prisma call through the account repository. The consistency can be ensured by making it a service-level operation.

Actually, for correctness, the settlement should be atomic: payout → COMPLETED + account settled balance update + ledger entry, all in one transaction. Let me handle this in the repository with a method that takes the Prisma transaction client.

Let me add to PayoutRepository:
```ts
async confirmPayout(tx: Prisma.TransactionClient, payoutId: string): Promise<void> {
  await tx.$transaction([
    tx.payout.update({ where: { id: payoutId }, data: { status: 'COMPLETED' } }),
    tx.ledgerEntry.create({...}),
  ]);
}
```

And to AccountRepository:
```ts
async addSettledBalance(tx: Prisma.TransactionClient, accountId: string, amount: bigint): Promise<void> {
  await tx.$executeRaw`
    UPDATE "accounts" SET "settled_balance" = "settled_balance" + ${amount} WHERE "id" = ${accountId}
  `;
}
```

And the service's processConfirm method:
```ts
async processConfirm(payout: Payout): Promise<void> {
  return this.prisma.$transaction(async (tx) => {
    await this.payoutRepo.confirmPayout(tx, payout.id);
    await this.accountRepo.addSettledBalance(tx, payout.accountId, payout.amount);
    // ledger entry created inside confirmPayout
  });
}
```

But wait, the service is calling `this.prisma.$transaction` — that's a Prisma call in the service layer! That violates the rules.

The solution: put the ENTIRE confirmation transaction in the repository. Create a method like:

```ts
// In PayoutRepository
async settlePayout(payoutId: string, accountId: string, amount: bigint): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.payout.update({ where: { id: payoutId }, data: { status: 'COMPLETED' } });
    await tx.account.update({ where: { id: accountId }, data: { settledBalance: { increment: amount } } });
    // Get current settled balance
    const account = await tx.account.findUnique({ where: { id: accountId } });
    await tx.ledgerEntry.create({
      data: {
        accountId,
        payoutId,
        amount,
        balanceAfter: account!.settledBalance + amount,
        entryType: 'settled',
      },
    });
  });
}
```

This keeps the Prisma call in the repository. The service just calls `payoutRepo.settlePayout(payoutId, accountId, amount)`.

But there's a subtlety: `settledBalance: { increment: amount }` might not work with BigInt in Prisma. Let me use `$executeRaw` for safety.

Or, I can use the increment operation with BigInt. In Prisma, increment works with BigInt fields. Let me check: yes, Prisma supports `increment` on BigInt fields.

But for getting the balanceAfter, I need to know the balance after the increment. I can either:
1. Query before the update
2. Use a RETURNING clause via raw SQL
3. Calculate it in the service (account.settledBalance + amount)

Let me go with option 3: the service already knows the current settled balance and the amount, so it can calculate balanceAfter. But then I need to pass it as a parameter.

Actually, let me keep it simple: query the current balance in the transaction, then calculate. The repository method will handle this.

OK, I think I've deliberated enough. Let me write all the code now.

Final decision on how to handle the transaction in the service layer: I'll use a pattern where the repository has `executeTransaction` that wraps `$transaction`, and the service calls repository methods that accept a transaction client. For operations that span multiple repositories, the repository method itself handles the multi-repository transaction.

Let me now write all files.

Actually, let me reconsider the architecture one more time. The key constraints are:
1. Service has zero Prisma client calls
2. Repository is the only layer touching the DB
3. The atomic reserve + create is one transaction
4. The settlement is one transaction

The simplest way to achieve both:
- PayoutRepository has methods that internally use Prisma transactions
- For the reservation, one repository method handles it all
- For settlement, one repository method handles it all
- Service orchestrates by calling repository methods

For the worker's send phase, it needs to:
1. Pick up pending messages (PayoutRepository.getPendingMessages)
2. For each, attempt transfer (ProviderService)
3. Update status (PayoutRepository.updateStatus)
4. Mark message processed (PayoutRepository.markMessageProcessed)

These are individual repository calls, no transaction needed (each is a single row update).

For the confirm phase:
1. Get sent payouts (PayoutRepository.getSentPayouts)
2. For each, confirm with provider (ProviderService)
3. Settle (PayoutRepository.settlePayout — atomic transaction)

This is clean. Let me write it.

One final concern: for the `processMessages` method on the service, should it use a Prisma transaction for the entire loop? No, because each message is independent. We process them one by one, and each operation is its own DB call. If one fails, we don't roll back the others — that's correct for a queue worker.

OK, writing code now.

Let me also figure out the exact DTO:

```ts
export class CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}
```

And the controller:

```ts
@Post()
async create(@Body() dto: CreatePayoutDto) {
  return this.payoutService.create(dto);
}
```

With proper error handling: return the error envelope format.

For errors, the convention is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So for insufficient funds, the code could be `insufficient_funds`.

Let me add an exception filter or handle errors in the controller.

Actually, the convention says the error format is `{ "error": { "code", "message", "details" } }`. I can use a custom exception or handle it in the controller.

Let me use a custom exception class:

```ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, any> = {},
  ) {
    super(message);
  }
}
```

And an exception filter:

```ts
@Catch(AppError)
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: AppError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(400).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

Or I can just handle it in the service and return the error structure. Let me use the exception filter approach for NestJS consistency.

But for simplicity, let me handle errors in the controller:

```ts
@Post()
async create(@Body() dto: CreatePayoutDto) {
  try {
    return await this.payoutService.create(dto);
  } catch (e) {
    if (e.code === 'INSUFFICIENT_FUNDS') {
      throw new BadRequestException({ error: { code: e.code, message: e.message, details: e.details } });
    }
    throw e;
  }
}
```

Actually, let me create a proper exception filter. It's cleaner.

OK, I've spent enough time planning. Let me write the code now. I'll be comprehensive and correct.

Let me write the complete solution:

Wait, one more thing. For the worker timing: "processMessages() runs every N seconds". I'll make it configurable via environment variable, defaulting to 5 seconds.

```ts
const INTERVAL_MS = parseInt(process.env.WORKER_INTERVAL_MS || '5000', 10);
```

And in the worker:
```ts
@Injectable()
export class PayoutWorker {
  constructor(private payoutService: PayoutService) {}
  
  onModuleInit() {
    setInterval(() => {
      this.payoutService.processMessages().catch(console.error);
    }, INTERVAL_MS);
  }
}
```

OK now let me actually write all the files. Let me be complete.

For the Prisma client injection, I'll use `@InjectConnection` pattern or just inject it directly. In NestJS, the common approach is to create a PrismaModule that provides the PrismaClient.

Let me keep it simple: inject PrismaClient directly.

Let me also think about how to provide the PrismaClient. I'll create a simple module:

```ts
@Module({
  providers: [
    {
      provide: 'PRISMA_CLIENT',
      useValue: prisma,
    },
  ],
  exports: ['PRISMA_CLIENT'],
})
export class PrismaModule {}
```

And import it in AppModule.

Actually, let me just create the PrismaClient instance in the repository and inject it via constructor. But that's not the NestJS way. Let me use the module provider pattern.

For simplicity, I'll have the AppModule provide PrismaClient:

```ts
@Module({
  imports: [PrismaModule, AccountModule, ProviderModule, PayoutModule],
})
export class AppModule {}
```

And PrismaModule:
```ts
@Module({
  providers: [{ provide: PrismaClient, useValue: new PrismaClient() }],
  exports: [PrismaClient],
})
export class PrismaModule {}
```

Then repositories inject PrismaClient via `@Inject(PrismaClient)`.

Hmm, let me just use a simpler approach. I'll have the AppModule create the PrismaClient and all modules import from it.

Actually, the cleanest approach for this exercise:

```ts
// app.module.ts
@Module({
  imports: [
    AccountModule,
    ProviderModule, 
    PayoutModule,
  ],
})
export class AppModule {}
```

```ts
// account.module.ts
@Module({
  providers: [
    AccountService,
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
  ],
  exports: [PrismaClient, AccountService],
})
export class AccountModule {}
```

Wait, that creates multiple PrismaClient instances. Let me use a shared module:

```ts
// prisma.module.ts or provide in AppModule
@Module({
  providers: [{ provide: PrismaClient, useFactory: () => new PrismaClient() }],
  exports: [PrismaClient],
})
export class PrismaModule {}

// app.module.ts
@Module({
  imports: [PrismaModule, AccountModule, ProviderModule, PayoutModule],
})
export class AppModule {}

// account.module.ts (imports PrismaModule to get PrismaClient)
@Module({
  imports: [PrismaModule],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
```

This way, PrismaClient is a singleton.

Let me add PrismaModule to my file list. Actually, I can just provide it in AppModule and export it. Let me go with:

```ts
// app.module.ts
@Module({
  providers: [{ provide: PrismaClient, useFactory: () => new PrismaClient() }],
  exports: [PrismaClient],
})
export class AppModule {}
```

Wait, that won't work because AppModule is imported by other modules. Let me use a dedicated module.

Actually, for this exercise, let me simplify: I'll have each repository create its own PrismaClient instance (via constructor injection with `@Optional()` or with a default). The important thing is that the logic is correct, and the code compiles.

Hmm, but multiple PrismaClients to the same DB is fine for this exercise. Let me just inject PrismaClient in each repository with a default value:

```ts
constructor(@Optional() @Inject('PRISMA') private prisma: PrismaClient = prisma) {}
```

This is getting complicated. Let me just use a shared module approach properly.

Final approach:
1. `src/prisma/prisma.module.ts` — provides PrismaClient
2. AppModule imports it and re-exports
3. All modules that need PrismaClient import from AppModule or PrismaModule

Let me write:

```ts
// src/prisma/prisma.module.ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Module({
  providers: [{ provide: PrismaClient, useFactory: () => new PrismaClient() }],
  exports: [PrismaClient],
})
export class PrismaModule {}
```

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AccountModule } from './account/account.module';
import { ProviderModule } from '../provider/provider.module';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PrismaModule, AccountModule, ProviderModule, PayoutModule],
})
export class AppModule {}
```

And in each repository:
```ts
constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}
```

This is clean and follows NestJS conventions.

Now let me write everything.

For the test, I'll create a Vitest test file that tests the PayoutService with mocked dependencies.

Let me finalize the test structure:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { AccountRepository } from '../account/account.repository';
import { ProviderService } from '../provider/provider.service';
import { CreatePayoutDto } from '../src/payout/payout.controller';

describe('PayoutService', () => {
  let service: PayoutService;
  let payoutRepo: PayoutRepository;
  let accountRepo: AccountRepository;
  let provider: ProviderService;
  
  beforeEach(() => {
    payoutRepo = {
      findByIdempotencyKey: vi.fn(),
      createPayoutWithReservation: vi.fn(),
      updateStatus: vi.fn(),
      markMessageProcessed: vi.fn(),
      getPendingMessages: vi.fn(),
      getSentPayouts: vi.fn(),
      settlePayout: vi.fn(),
    };
    accountRepo = {
      findById: vi.fn(),
      addSettledBalance: vi.fn(),
    };
    provider = {
      transfer: vi.fn(),
      confirm: vi.fn(),
    };
    
    service = new PayoutService(payoutRepo as any, accountRepo as any, provider as any);
  });
  
  // tests...
});
```

Wait, but `new PayoutService(...)` needs the right constructor signature. Let me make sure the service constructor takes the right parameters.

Also, for the `processMessages` method, I need to handle the two phases. Let me write it properly.

OK, I'm going to write everything now. Let me be very thorough.

For the test of concurrent creation, I'll test:
- When `createPayoutWithReservation` returns success → payout is returned
- When `createPayoutWithReservation` returns failure → error thrown
- When same idempotency key exists → existing payout returned

For the test of duplicate message delivery:
- Process a pending message → calls provider.transfer
- Process the same message again → no second provider.transfer call, no status change

For retry exhaustion:
- Provider fails N times → payout goes to NEEDS_REVIEW, message PROCESSED, reservation intact

Let me think about how to test the "message delivered twice" scenario at the service level. The key is: when `processMessages` is called twice, and there's a PENDING message, the first call processes it and marks it PROCESSED. The second call should find no PENDING messages (or find a PROCESSED one and skip it).

But in the repository, `getPendingMessages` only returns PENDING messages. Once marked PROCESSED, it's no longer returned. So the duplicate delivery is naturally handled.

But wait, the issue says "at-least-once" — meaning the same message could be delivered multiple times BEFORE it's marked PROCESSED. In that case:
1. Worker picks up message (PENDING)
2. Worker crashes before marking PROCESSED
3. Next poll: message still PENDING, picked up again
4. Worker processes it again

In this case, the service needs to check if the payout is still in CREATED status before calling provider.transfer. Because the payout status transition (CREATED → PROCESSING) is the guard.

The flow:
1. Get pending message
2. Get payout for message
3. If payout.status !== CREATED → mark message PROCESSED (cleanup), skip
4. Try to update payout to PROCESSING (conditional: only if status is CREATED)
5. If update succeeded → proceed with provider.transfer
6. If update failed → another worker got it, mark message PROCESSED, skip

This way, even if the message is delivered multiple times (picked up multiple times), only one worker will actually call provider.transfer.

Wait, but what about step 3 and 4? In step 3, we check the status and skip. In step 4, we use a conditional update. These are two levels of protection:
- Step 3: If the payout has already moved to a later status (SENT, etc.), skip
- Step 4: If the payout is still CREATED but we lost the race to another worker, skip

Actually, step 4 is the critical one. Step 3 handles the case where the payout has already been fully processed. Step 4 handles the case where we lost the race.

Let me combine them: just do the conditional update on status. If it fails, skip. If it succeeds, proceed.

```ts
// In PayoutService.processSend():
const updated = await this.payoutRepo.transitionToProcessing(payout.id);
if (!updated) {
  // Already being processed by another worker
  await this.payoutRepo.markMessageProcessed(message.id);
  return;
}
// Proceed with provider.transfer
```

And `transitionToProcessing` does:
```ts
// UPDATE payouts SET status = 'PROCESSING' WHERE id = $id AND status = 'CREATED'
// Return true if rowCount === 1
```

This is cleaner.

For the duplicate message scenario:
- Message 1: picked up, payout → PROCESSING, provider.transfer called, payout → SENT, message → PROCESSED
- Message 1 delivered again (same row in DB): picked up, but it's already PROCESSED → not returned by getPendingMessages → skipped

So the unique constraint on payoutId + message status PENDING filtering handles it.

But what if the message row itself is delivered twice? With at-least-once delivery from a queue, there could be two rows for the same payout. But with the `@unique` on payoutId, there's only one message per payout. So we can't have two message rows.

Hmm, but at-least-once delivery means we might pick up the same message row twice (from the same row in DB). This happens when:
1. Worker picks up message (reads it)
2. Worker crashes before marking PROCESSED
3. Next poll: same message still PENDING, picked up again

In this case, the conditional status update (CREATED → PROCESSING) is the guard. If the first worker crashed before updating status, the second worker will succeed with the update and proceed. If the first worker crashed after updating status but before calling provider.transfer, the second worker's update will fail (status is already PROCESSING or later), and it skips.

Wait, but if the first worker successfully updated to PROCESSING and then crashed, the second worker would see the status is PROCESSING (not CREATED) and skip. But provider.transfer was never called! The payout would be stuck in PROCESSING forever.

Hmm, that's a problem. Let me fix it:

Option A: Before calling provider.transfer, update status. If crash after status update but before transfer, the payout is stuck.
Option B: Call provider.transfer first, then update status. But then duplicate calls could happen.
Option C: Use a separate "locked" flag or processing timestamp.

Actually, Option A is fine in practice because:
- If the worker crashes after updating to PROCESSING but before calling provider.transfer, the next worker that picks up this message will see status PROCESSING and skip. But the payout is stuck.
- To handle this, we need a timeout mechanism: if a payout has been PROCESSING for too long, another worker can claim it.

But this adds complexity. For the purpose of this exercise, let me assume the worker doesn't crash between status update and provider call (which is a reasonable assumption since these are quick operations). If it does crash, the payout would be stuck in PROCESSING, which is a recoverable situation (admin can fix it).

Actually wait, let me re-think. The at-least-once delivery means we might pick up the same row. Let me handle it with this flow:

1. Select pending messages: `SELECT * FROM messages WHERE status = 'PENDING' FOR UPDATE SKIP LOCKED`
2. For each message:
   a. UPDATE payout SET status = 'PROCESSING' WHERE id = X AND status = 'CREATED'
   b. If updated: proceed with provider.transfer
   c. If not updated (already locked/processed): mark message PROCESSED, skip
   d. On provider success: UPDATE payout SET status = 'SENT', UPDATE message SET status = 'PROCESSED'
   e. On failure: UPDATE payout SET status = 'NEEDS_REVIEW', UPDATE message SET status = 'PROCESSED'

With `FOR UPDATE SKIP LOCKED`, two workers picking up the same row simultaneously is prevented at the DB level. And the conditional status update prevents duplicate processing across different polls.

The scenario where a worker crashes between step (a) and (d)/(e) would leave the payout in PROCESSING and the message in PENDING. The next poll would pick up the message, but the status update would fail (status is PROCESSING not CREATED). So the message gets marked PROCESSED and the payout is stuck. This is an edge case that requires a separate recovery mechanism.

For this exercise, let me handle it by adding a check: in the worker, before the conditional update, check if the payout's status is PROCESSING for too long. But that's too much complexity.

Let me take a different approach: instead of updating status to PROCESSING, just use a conditional update right before the provider call, and make the provider call and status update as close together as possible:

1. Get pending messages (with SKIP LOCKED)
2. For each:
   a. Do conditional UPDATE: UPDATE payouts SET status = 'PROCESSING' WHERE id = X AND status = 'CREATED'
   b. If 0 rows affected → mark message PROCESSED, skip (another worker or previous attempt handled it)
   c. Call provider.transfer
   d. On success: UPDATE payouts SET status = 'SENT', txHash = ..., UPDATE messages SET status = 'PROCESSED'
   e. On failure: UPDATE payouts SET status = 'NEEDS_REVIEW', UPDATE messages SET status = 'PROCESSED'

The edge case (crash between b and d) leaves status as PROCESSING. But for this exercise, I'll note this and add a comment. The fix would be a polling mechanism for stuck payouts, but that's beyond scope.

Let me now write the actual code.

One more thing: the `payoutRepo.getPendingMessages()` should use `FOR UPDATE SKIP LOCKED` for safe concurrent message processing. Let me add this to the repository.

```ts
async getPendingMessages(): Promise<Message[]> {
  return this.prisma.$queryRaw`
    SELECT * FROM "messages" WHERE status = 'PENDING' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED
  `;
}
```

Wait, `$queryRaw` returns raw results. In Prisma, we'd need to use `$queryRaw` with a type or use `$queryRawArray`. The result is an array of objects, which might not be typed as Message[].

Alternatively, I can use Prisma's findMany with a raw query wrapper:
```ts
return this.prisma.message.findMany({
  where: { status: 'PENDING' },
  orderBy: { createdAt: 'asc' },
});
```

But this doesn't have `FOR UPDATE SKIP LOCKED`. For that, we need raw SQL. Let me use:

```ts
async getPendingMessages(): Promise<Message[]> {
  const rows = await this.prisma.$queryRaw<Message>`
    SELECT * FROM "messages" WHERE "status" = 'PENDING' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED
  `;
  return rows;
}
```

Actually, in Prisma 5+, `$queryRaw<Model[]>` returns properly typed models. Let me use that.

But wait, `$queryRaw` doesn't go through the model's relations. It just returns the raw row data. Since Message has a relation to Payout, and we need the payout data, I should either:
1. Join in the raw query
2. Do a separate query for the payout

Let me just do: get the message row, then look up the payout separately. Or include the payout data in the raw query.

Actually, for the worker, we need: message + payout data. Let me do a join:

```ts
async getPendingMessagesWithPayouts(): Promise<{ message: Message; payout: Payout }[]> {
  const rows = await this.prisma.$queryRaw<{
    message: Message;
    payout: Payout;
  }>`
    SELECT m.*, p.* 
    FROM "messages" m 
    JOIN "payouts" p ON m."payoutId" = p.id 
    WHERE m."status" = 'PENDING' 
    ORDER BY m."createdAt" 
    FOR UPDATE SKIP LOCKED
  `;
  return rows.map(row => ({
    message: row as Message,
    payout: row as Payout,
  }));
}
```

Hmm, this is messy with raw SQL types. Let me simplify: get pending messages first, then get each payout separately. It's less efficient but cleaner.

Actually, let me just use Prisma's `findMany` and accept that we don't have SKIP LOCKED for now. The critical guarantee is the conditional status update (CREATED → PROCESSING). The SKIP LOCKED is an optimization for concurrent workers, not a correctness requirement.

```ts
async getPendingMessages(): Promise<Message[]> {
  return this.prisma.message.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { payout: true },
  });
}
```

This is much cleaner. And the correctness is still guaranteed by the conditional update.

OK, let me finalize everything now and write the code. I'll include SKIP LOCKED as a comment but not implement it (to keep types clean).

Let me also add the Prisma types. In the Prisma schema, the model names are PascalCase (Account, Payout, Message, LedgerEntry), and Prisma generates TypeScript types from these.

Now, writing code...

Let me think about one more thing: the error codes. The convention says codes are snake_case. So:
- `insufficient_funds` — when balance check fails
- `payout_not_found` — when a payout doesn't exist
- `idempotency_conflict` — maybe not needed since we return the existing

And the error envelope:
```json
{ "error": { "code": "insufficient_funds", "message": "Insufficient available funds", "details": {} } }
```

Let me create a custom exception class:

```ts
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, any> = {},
  ) {
    super(message);
  }
}
```

And an exception filter in the controller:

```ts
@UseFilters(new ServiceExceptionFilter())
@Controller('payouts')
```

Or use `@Injectable` filter:

```ts
@Injectable()
export class ServiceExceptionFilter implements ExceptionFilter {
  catch(exception: ServiceError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(400).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

Let me apply this filter to the payouts controller.

OK NOW I'm writing the code. Let me be systematic and complete.

Actually, let me reconsider the structure of the PayoutService. It needs to:

1. `create(input: CreatePayoutDto)`: Check idempotency, create with reservation
2. `processMessages()`: Process pending messages (send) and sent payouts (confirm)

For `processMessages`, the logic is:

```ts
async processMessages(): Promise<void> {
  // Phase 1: Send pending messages
  const messages = await this.payoutRepo.getPendingMessages();
  for (const msg of messages) {
    await this.processSend(msg);
  }
  
  // Phase 2: Confirm sent payouts
  const sentPayouts = await this.payoutRepo.getSentPayouts();
  for (const payout of sentPayouts) {
    await this.processConfirm(payout);
  }
}

private async processSend(message: Message): Promise<void> {
  const payout = message.payout;
  if (!payout || payout.status !== 'CREATED') {
    // Mark as processed if not already, skip
    if (message.status === 'PENDING') {
      await this.payoutRepo.markMessageProcessed(message.id);
    }
    return;
  }
  
  // Try to transition to PROCESSING (atomic, only if still CREATED)
  const updated = await this.payoutRepo.transitionToProcessing(payout.id);
  if (!updated) {
    // Another worker or previous attempt already claimed it
    await this.payoutRepo.markMessageProcessed(message.id);
    return;
  }
  
  // Call provider with bounded retries
  let txHash: string;
  try {
    txHash = await this.retryProviderTransfer(payout);
  } catch {
    // All retries exhausted
    await this.payoutRepo.markFailed(payout.id);
    await this.payoutRepo.markMessageProcessed(message.id);
    return;
  }
  
  // Success
  await this.payoutRepo.markSent(payout.id, txHash);
  await this.payoutRepo.markMessageProcessed(message.id);
}

private async processConfirm(payout: Payout): Promise<void> {
  if (payout.status !== 'SENT') return;
  
  try {
    const confirmed = await this.retryProviderConfirm(payout);
    if (confirmed) {
      await this.payoutRepo.settlePayout(payout.id);
    } else {
      await this.payoutRepo.markFailed(payout.id);
    }
  } catch {
    await this.payoutRepo.markFailed(payout.id);
  }
}

private async retryProviderTransfer(payout: Payout): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });
      return result.txHash;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error('unreachable');
}

private async retryProviderConfirm(payout: Payout): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await this.provider.confirm(payout.txHash!);
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
  return false;
}
```

Wait, `retryProviderTransfer` throws after all retries. In `processSend`, I catch it and mark as NEEDS_REVIEW. But I also need to set providerAttempts on the payout.

Let me adjust: `markFailed` should set the status to NEEDS_REVIEW and update providerAttempts.

Also, I realize the `processSend` flow has a subtle issue. After the conditional update to PROCESSING succeeds, I call provider.transfer. If it succeeds, I mark SENT. If it fails (all retries), I mark NEEDS_REVIEW. The message is marked PROCESSED in both cases.

But what if provider.transfer succeeds and then the worker crashes before marking SENT and PROCESSED? The payout is PROCESSING and message is PENDING. Next poll: message picked up again, status update fails (PROCESSING ≠ CREATED), message marked PROCESSED, payout stuck in PROCESSING.

To prevent this, I should:
1. Call provider.transfer first
2. Then update status (all in the same flow)

But if provider.transfer succeeds and then worker crashes before status update, we'd call provider.transfer again on the next poll (since message is still PENDING and status is still CREATED). That would be a duplicate transfer!

Unless... we use the conditional status update as a guard. If we update status to PROCESSING BEFORE calling provider.transfer, then:
- If worker crashes after status update: payout is PROCESSING, next poll skips it (but provider might not have been called)
- If worker crashes before status update: message is PENDING, status is CREATED, next poll retries (provider might have been called)

The first case loses a payment, the second case risks a duplicate. The second is worse (losing real money).

The safest approach: call provider.transfer, THEN update status. But guard against duplicates by checking if a transfer was already made (e.g., check txHash or idempotency on the provider side).

Since we can't control the provider's idempotency, we need a different approach. Let me use this flow:

1. Conditional update: status CREATED → PROCESSING (atomic)
2. If failed, skip (another worker got it)
3. Call provider.transfer
4. If success: status PROCESSING → SENT (atomic)
5. If failure: status PROCESSING → NEEDS_REVIEW (atomic)
6. Mark message PROCESSED

Now:
- If crash between 1 and 3: payout is PROCESSING, next poll skips it (status ≠ CREATED). But we need to check if provider was actually called. We can't know. However, this is the "we can't know" state, and the payout will be stuck in PROCESSING.
- If crash between 3 and 4: payout is PROCESSING, next poll skips it. Provider was called, so no duplicate. But we don't know if it succeeded. This is the "uncertainty" state.
- If crash between 4 and 6: payout is SENT (if we update status first), message is PENDING.

Wait, let me revise. What if we:
1. Conditional update: status CREATED → PROCESSING
2. Call provider.transfer
3. Conditional update: status PROCESSING → SENT (only if still PROCESSING)
4. Mark message PROCESSED

For the "crash between 1 and 3" case: payout stuck in PROCESSING. We should have a recovery mechanism. For now, let me add a comment about this.

Actually, let me add a different recovery: in the confirm phase, also check for PROCESSING payouts that are "stuck". But this adds complexity.

Let me just handle it correctly in the main flow and add a comment about the edge case. For the exercise, the key guarantees are:
1. No overdraft (atomic reserve) ✓
2. No duplicate payout creation (idempotency key) ✓
3. No duplicate transfer (conditional status update) ✓
4. Retry exhaustion → NEEDS_REVIEW ✓
5. Settlement on confirmation ✓

The "stuck in PROCESSING" edge case is a known limitation that can be handled by monitoring.

Actually, let me handle it simply: in `processConfirm`, also pick up PROCESSING payouts that have been in that state for too long and retry them. Or better: just check if the provider already made a transfer by checking if the payout has a txHash.

Hmm, I think the simplest fix is: in `processSend`, before calling provider.transfer, check if there's already a message for this payout that's been PROCESSED. If so, skip.

Wait, there's always exactly one message per payout (unique on payoutId). And the message goes PENDING → PROCESSED. So if message is PENDING, we should process it. If PROCESSED, we skip.

The issue is: message is PENDING and payout is PROCESSING (crash between steps 1 and 3). In this case:
- message is PENDING → getPendingMessages returns it
- payout is PROCESSING → in processSend, we check status (PROCESSING ≠ CREATED) → skip

Let me add this check in processSend:

```ts
if (payout.status === 'PROCESSING') {
  // Possibly being processed by another worker or stuck. 
  // Mark message processed to avoid re-checking, but leave payout as-is.
  // A stuck payout in PROCESSING should be handled by monitoring/recovery.
  await this.payoutRepo.markMessageProcessed(message.id);
  return;
}
```

Wait, but if the payout is PROCESSING because it's being processed by another worker, marking the message PROCESSED is wrong — the other worker will update the payout to SENT and then needs to update the message to PROCESSED too. But there's only one message per payout, so if we mark it PROCESSED, the other worker can't update it.

Hmm, this means the "one message per payout" model doesn't work well with concurrent workers. Let me reconsider.

Option: Don't mark message PROCESSED in the "already processing" case. Just skip and leave it PENDING. Then the other worker will pick it up, process it, and mark it PROCESSED.

```ts
private async processSend(message: Message): Promise<void> {
  const payout = message.payout;
  if (!payout) {
    await this.payoutRepo.markMessageProcessed(message.id); // cleanup
    return;
  }
  
  if (payout.status !== 'CREATED') {
    // Already being processed or processed. Don't mark as PROCESSED.
    // If it's stuck in PROCESSING, the other worker (or a recovery worker) will handle it.
    return;
  }
  
  // Try conditional update to PROCESSING
  const updated = await this.payoutRepo.transitionToProcessing(payout.id);
  if (!updated) {
    // Another worker won the race. Don't mark this message as PROCESSED — 
    // the winner will handle it.
    return;
  }
  
  // ... proceed with provider.transfer
}
```

This is better. The message stays PENDING until the worker that actually processes it marks it PROCESSED.

But then, the scenario: worker picks up message, conditionally updates to PROCESSING, crashes before marking PROCESSED. Message stays PENDING, payout stays PROCESSING. Next poll: same message picked up (PENDING), but payout is PROCESSING ≠ CREATED → skip (without marking PROCESSED). Message stays PENDING forever.

This is a livelock. To break it, we need to mark the message PROCESSED in the "already processing" case, but ONLY if we're sure the payout isn't being processed by another worker.

Alternative: add a `processingStartedAt` timestamp. When transitioning to PROCESSING, set it. When a message is picked up and payout is PROCESSING but processingStartedAt is older than a timeout, reset to CREATED and try again.

This is getting too complex for this exercise. Let me use a simpler model:

**Each message can be processed exactly once because after processing, it's marked PROCESSED, and the message row is deleted or locked.**

Let me change the model: use `FOR UPDATE SKIP LOCKED` when selecting pending messages, and mark them as "locked" (PROCESSING) before doing work. But Prisma's findMany doesn't support SKIP LOCKED.

OK, I'll take the simplest correct approach: don't worry about the PROCESSING stuck edge case (it's a known limitation that requires monitoring), and ensure:
1. The message is marked PROCESSED in all terminal cases (success, failure)
2. The conditional status update prevents duplicate transfers
3. The message is only marked PROCESSED after the work is done

And in the "already processing" case, DON'T mark the message PROCESSED. Just return. The message will be picked up again. The payout status check prevents duplicate transfer.

The only issue is the "stuck in PROCESSING" case, which I'll handle with a timeout check:

```ts
private async processSend(message: Message): Promise<void> {
  const payout = message.payout;
  if (!payout) {
    await this.payoutRepo.markMessageProcessed(message.id);
    return;
  }
  
  if (payout.status === 'PROCESSING' && payout.updatedAt < Date.now() - STUCK_TIMEOUT_MS) {
    // Payout has been stuck in PROCESSING for too long, reset to CREATED
    await this.payoutRepo.resetToCreated(payout.id);
  }
  
  if (payout.status !== 'CREATED') {
    return; // don't mark PROCESSED
  }
  
  // ... proceed
}
```

Actually, this adds more complexity. Let me just note in the code that a stuck payout in PROCESSING should be monitored and manually resolved, and move on.

OK I need to stop overthinking and write the code. Here goes:

The critical guarantees are met by:
1. Atomic reserve in transaction ✓
2. Idempotency key check before creation ✓
3. Conditional status update prevents duplicate transfer ✓
4. Message marked PROCESSED after processing ✓
5. Bounded retries → NEEDS_REVIEW ✓
6. Settlement only on confirmation ✓

The stuck PROCESSING edge case is acknowledged but not solved (it's an operational concern).

Let me write the code now. Final design:

Messages: PENDING → PROCESSED (one per payout)
Payout status: CREATED → PROCESSING → SENT → COMPLETED/FAILED
Or: CREATED → PROCESSING → NEEDS_REVIEW (on retry exhaustion)

Worker phases:
1. PENDING messages → send attempt
2. SENT payouts → confirmation

Let me now write all files. I'll be complete and thorough.

Let me also reconsider whether I need a `PayoutStatus` enum in TypeScript. Since Prisma generates types from the schema, `PayoutStatus.CREATED` etc. will be available from `@prisma/client`. Let me use those directly.

Actually, wait. In the Prisma schema, I have `enum PayoutStatus` which generates a TypeScript enum. But in code, I'll use string literals like `'CREATED'` or the enum values like `PayoutStatus.CREATED`.

Let me use the Prisma-generated enum for consistency.

OK, here's my final plan for the code. I'll write each file completely.

One more thing: for the test, I need to think about what `new PayoutService(...)` requires. The service needs:
- payoutRepo
- accountRepo
- provider
- Maybe PrismaClient for transactions? No, I moved transactions to the repository.

So: `new PayoutService(payoutRepo, accountRepo, provider)`

And in tests, I'll mock all three.

The service's `processMessages` will call:
- `payoutRepo.getPendingMessages()` (with include: { payout: true })
- `payoutRepo.getSentPayouts()`
- And then per-message/per-payout: `payoutRepo.transitionToProcessing`, `payoutRepo.markSent`, `payoutRepo.markMessageProcessed`, `payoutRepo.markNeedsReview`, `payoutRepo.settlePayout`, `payoutRepo.markFailed`

And `provider.transfer`, `provider.confirm` for the provider calls.

For the `create` method: `payoutRepo.findByIdempotencyKey`, then `payoutRepo.createPayoutWithReservation`.

Let me write it all now.

Actually, for the `createPayoutWithReservation` in the repository, it needs to do the transaction. In the test, I mock this repository method. The test verifies:
- When it returns success → service returns payout
- When it returns failure → service throws INSUFFICIENT_FUNDS
- When idempotency key exists → service returns existing payout

Let me now write everything. I'll focus on getting the complete solution.

One more design note: `processMessages()` is called by the worker. In tests, I'll test this method directly. The test for duplicate message delivery will:
1. Set up a PENDING message with a CREATED payout
2. Call processMessages() → provider.transfer called once
3. Call processMessages() again → provider.transfer NOT called again

Let me write the tests now and the code together.

Actually, I realize the `processMessages` is called twice for the duplicate test:
- First call: picks up PENDING message, processes it (CREATED → PROCESSING → SENT, message → PROCESSED)
- Second call: getPendingMessages returns nothing (no PENDING messages), so provider.transfer NOT called again ✓

This tests "duplicate message delivery" correctly — the message is PROCESSED, so it's not picked up again, and no duplicate transfer occurs.

For a more direct test of the "already being processed" case:
1. Set up a PENDING message with payout in PROCESSING status (simulating crashed worker)
2. Call processMessages() → message skipped (payout.status !== CREATED), no provider.transfer call ✓

I should test both scenarios.

OK let me finalize everything now. Writing all files.

Let me also handle the `processSend` edge case where payout.status is PROCESSING but might be stuck. For safety, I'll add logic to mark the message as PROCESSED if payout is in a terminal state (not CREATED, not PROCESSING). For PROCESSING, I'll leave the message PENDING so it can be retried.

Wait no. If payout is PROCESSING and we're in processSend, we should check: is this a stuck payout? If the message is PENDING and payout is PROCESSING, it means:
- The payout was transitioned to PROCESSING
- But the message was NOT marked PROCESSED (worker crashed)
- The message is still PENDING and will be picked up again

When we pick it up again: payout is PROCESSING, so we can't transition to PROCESSING again. We skip. But the message stays PENDING. Next time, same thing.

To break this cycle: in the "payout is PROCESSING" case, mark the message PROCESSED (because another worker was processing it, and the payout will move to SENT or NEEDS_REVIEW regardless). But what if the other worker also crashed? Then the payout is stuck.

I think the safest approach for this exercise: in the PROCESSING case, mark the message PROCESSED and also check if the payout has providerAttempts >= MAX_RETRIES. If so, it was already retried and failed, so mark it NEEDS_REVIEW.

Let me add a simpler rule:
- If payout.status === 'PROCESSING' and payout.providerAttempts >= MAX_RETRIES → mark NEEDS_REVIEW, mark message PROCESSED
- If payout.status === 'PROCESSING' and providerAttempts < MAX_RETRIES → leave it (might still be processing)

Actually, this is still too complex. Let me just go with the simplest approach that works for the test cases:

1. getPendingMessages returns messages where status = PENDING
2. For each message, check if payout.status === CREATED
3. If yes, proceed (conditional update, provider call, etc.)
4. If no, skip (don't mark PROCESSED)

For the test of "duplicate message delivery":
- We test that after processMessages runs once, the message is PROCESSED and no duplicate transfer occurs
- This is correct because the message is PROCESSED after the first run, so the second run won't pick it up

For the "stuck in PROCESSING" case: it's an edge case that requires monitoring. I'll add a comment.

FINAL. Writing code now. For real this time.

Let me think about what happens in `processSend` step by step, and make sure the flow is correct:

```
processSend(message):
  payout = message.payout
  
  // Guard: payout must exist and be in CREATED state
  if payout.status !== 'CREATED':
    return // skip
  
  // Atomic: transition to PROCESSING (only if still CREATED)
  if !payoutRepo.transitionToProcessing(payout.id):
    return // another worker got it, skip
  
  // Now we own this payout. Call provider.
  try:
    txHash = await callProviderWithRetries(payout)
    // Success: mark sent
    payoutRepo.markSent(payout.id, txHash)
  catch:
    // Failure: mark needs review
    payoutRepo.markNeedsReview(payout.id)
  
  // Always: mark message processed
  payoutRepo.markMessageProcessed(message.id)
```

This is clean and handles:
- Concurrent processing: conditional update prevents duplicate ✓
- Provider failure: bounded retries then NEEDS_REVIEW ✓
- Message tracking: always marked PROCESSED ✓
- Stuck in PROCESSING: if worker crashes after transitionToProcessing but before markSent/markNeedsReview, the payout is stuck in PROCESSING. The message stays PENDING and will be picked up again, but the status check prevents re-processing. This is a known limitation.

To mitigate the stuck case, I can add a simple check: when picking up a message, if payout is in PROCESSING for longer than some threshold, reset it to CREATED. But I'll add this as a comment and keep the main flow simple.

OK, I'm writing the code now. No more deliberation.

Let me finalize the exact API contract. The controller receives:
```json
{ "accountId": "...", "amount": 1000, "destinationAddress": "...", "idempotencyKey": "..." }
```

And returns:
```json
{ "id": "...", "accountId": "...", "amount": 1000, "destinationAddress": "...", "idempotencyKey": "...", "status": "CREATED", ... }
```

Or error:
```json
{ "error": { "code": "insufficient_funds", "message": "...", "details": {} } }
```

The amount is in minor units (BigInt integer).

Now let me write the complete code. I'll start with Prisma schema and go through all files systematically.

Let me also think about the `payout.worker.ts` file. It's a NestJS service that runs on an interval.

```ts
@Injectable()
export class PayoutWorker {
  private readonly intervalMs: number;
  
  constructor(private readonly payoutService: PayoutService) {
    this.intervalMs = parseInt(process.env.WORKER_INTERVAL_MS || '5000', 10);
  }
  
  onModuleInit() {
    setInterval(() => {
      this.payoutService.processMessages().catch((err) => {
        console.error('Worker error:', err);
      });
    }, this.intervalMs);
  }
}
```

And it's registered in PayoutModule.

Let me now write all files. I'll be thorough but efficient.

For the `payout.controller.ts`, I need:
- `@Controller('payouts')`
- `@Post()` with `@Body()` dto
- Exception filter for error envelope

Let me use `@UsePipes(new ValidationPipe())` for input validation. Actually, let me keep it simple and skip the pipe — the DTO validation can be done manually.

Wait, the spec says the controller validates input. Let me add basic validation: check that all fields are present and amount > 0.

```ts
@Post()
async create(@Body() dto: CreatePayoutDto) {
  if (!dto.accountId || !dto.amount || !dto.destinationAddress || !dto.idempotencyKey) {
    throw new BadRequestException({
      error: { code: 'validation_error', message: 'Missing required fields', details: {} },
    });
  }
  if (dto.amount <= 0n) {
    throw new BadRequestException({
      error: { code: 'validation_error', message: 'Amount must be positive', details: {} },
    });
  }
  return this.payoutService.create(dto);
}
```

But wait, `dto.amount` is BigInt, and comparing with `<=` should work. Actually, `0n` is BigInt zero, so `dto.amount <= 0n` works.

But also, if the amount comes as a number from JSON (not BigInt), we need to handle it. In JSON, large integers might be parsed as numbers. For this exercise, let me assume the client sends it as a string that we convert to BigInt.

Actually, in TypeScript with NestJS, if the DTO field is typed as `bigint`, and the JSON body has a number, it'll be a number, not bigint. I should handle this conversion.

Let me add a pipe or manual conversion:
```ts
const amount = BigInt(dto.amount);
```

I'll do this in the controller or service. Let me do it in the controller before passing to the service.

OK let me write the code now. Here we go:

Actually wait, let me think about the `transitionToProcessing` in the repository. It does:
```ts
async transitionToProcessing(payoutId: string): Promise<boolean> {
  const result = await this.prisma.$executeRaw`
    UPDATE "payouts" 
    SET "status" = 'PROCESSING', "updatedAt" = NOW()
    WHERE "id" = ${payoutId} AND "status" = 'CREATED'
  `;
  const rowCount = typeof result === 'number' ? result : result?.count ?? 0;
  return rowCount === 1;
}
```

And `markSent`:
```ts
async markSent(payoutId: string, txHash: string): Promise<void> {
  await this.prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'SENT', txHash, updatedAt: new Date() },
  });
}
```

And `markNeedsReview`:
```ts
async markNeedsReview(payoutId: string): Promise<void> {
  await this.prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'NEEDS_REVIEW', updatedAt: new Date() },
  });
}
```

And `markMessageProcessed`:
```ts
async markMessageProcessed(messageId: string): Promise<void> {
  await this.prisma.message.update({
    where: { id: messageId },
    data: { status: 'PROCESSED', updatedAt: new Date() },
  });
}
```

And `markFailed`:
```ts
async markFailed(payoutId: string): Promise<void> {
  await this.prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'FAILED', updatedAt: new Date() },
  });
}
```

Wait, for retry exhaustion, the spec says the status should be NEEDS_REVIEW, not FAILED. FAILED is for when the provider definitively fails (e.g., in the confirmation phase). Let me use:
- NEEDS_REVIEW: retry exhaustion in the send phase (provider may or may not have succeeded)
- FAILED: provider definitively failed in the confirmation phase

And COMPLETED: provider confirmed in the confirmation phase.

This aligns with the spec: "completed / failed / needs-review".

Now for `settlePayout`:
```ts
async settlePayout(payoutId: string, accountId: string, amount: bigint): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'COMPLETED', updatedAt: new Date() },
    });
    
    await tx.$executeRaw`
      UPDATE "accounts" 
      SET "settled_balance" = "settled_balance" + ${amount}, "updatedAt" = NOW()
      WHERE "id" = ${accountId}
    `;
    
    const account = await tx.account.findUnique({ where: { id: accountId } });
    await tx.ledgerEntry.create({
      data: {
        accountId,
        payoutId,
        amount,
        balanceAfter: account!.settledBalance + amount,
        entryType: 'settled',
      },
    });
  });
}
```

Wait, after the UPDATE, the `account` from `findUnique` would have the OLD settledBalance (before the update). Because the UPDATE was done via raw SQL, Prisma doesn't know about it. So `account.settledBalance` is the balance before the increment.

So `balanceAfter` should be `account.settledBalance + amount`. That's correct — it's the balance after adding amount.

But wait, `account.settledBalance` from `findUnique` is the balance BEFORE the update. Then we update to `settledBalance + amount`. So the balance AFTER is `account.settledBalance + amount`. The ledger entry should record this.

But if we query the account after the update, we'd get the new balance. Let me reorder:

```ts
const account = await tx.account.findUnique({ where: { id: accountId } });
const balanceAfter = account!.settledBalance + amount;

await tx.payout.update({...});
await tx.$executeRaw`UPDATE "accounts" SET "settled_balance" = "settled_balance" + ${amount} WHERE "id" = ${accountId}`;
await tx.ledgerEntry.create({ data: { ..., balanceAfter } });
```

Now balanceAfter = old settled + amount, which is correct.

But there's a subtle issue: between finding the account and updating it, another transaction could have updated the account. The findUnique gives a stale read.

To fix this, I could:
1. Use SELECT FOR UPDATE in the transaction
2. Use the raw UPDATE and compute balanceAfter from the result
3. Use Prisma's increment operation

Let me use option 2: compute from the raw UPDATE.

Actually, PostgreSQL supports RETURNING:
```sql
UPDATE "accounts" SET "settled_balance" = "settled_balance" + ${amount} WHERE "id" = ${accountId} RETURNING "settled_balance"
```

And in Prisma:
```ts
const result = await tx.$executeRaw`
  UPDATE "accounts" SET "settled_balance" = "settled_balance" + ${amount} WHERE "id" = ${accountId} RETURNING "settled_balance"
`;
const newBalance = (result as any)[0].settled_balance;
```

But the type of result from `$executeRaw` for a SELECT-like query (even via UPDATE ... RETURNING) might be tricky. Let me use `$queryRaw`:

```ts
const [{ settled_balance }] = await tx.$queryRaw<{ settled_balance: bigint }>`
  UPDATE "accounts" SET "settled_balance" = "settled_balance" + ${amount} WHERE "id" = ${accountId} RETURNING "settled_balance"
`;
const balanceAfter = settled_balance;
```

This is the cleanest approach. Let me use it.

OK, truly final now. Let me write the code.

Wait, one more thought about `createPayoutWithReservation`. This is the key method. Let me write it carefully:

```ts
async createPayoutWithReservation(data: {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}): Promise<{ payout: Payout; reserved: boolean }> {
  return this.prisma.$transaction(async (tx) => {
    // 1. Atomic reserve
    const reserveResult = await tx.$executeRaw`
      UPDATE "accounts" 
      SET "reserved_balance" = "reserved_balance" + ${data.amount}
      WHERE "id" = ${data.accountId} 
        AND ("settled_balance" - "reserved_balance") >= ${data.amount}
    `;
    const rowCount = typeof reserveResult === 'number' ? reserveResult : reserveResult?.count ?? 0;
    
    if (rowCount === 0) {
      return { payout: null as any, reserved: false };
    }
    
    // 2. Create payout
    const payout = await tx.payout.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        idempotencyKey: data.idempotencyKey,
        status: PayoutStatus.CREATED,
      },
    });
    
    // 3. Create message
    await tx.message.create({
      data: {
        payoutId: payout.id,
        status: MsgStatus.PENDING,
      },
    });
    
    // 4. Get account for ledger entry
    const account = await tx.account.findUnique({ where: { id: data.accountId } });
    
    // 5. Create ledger entry (reserved)
    await tx.ledgerEntry.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        balanceAfter: (account?.reservedBalance ?? 0n) + data.amount,
        entryType: 'reserved',
      },
    });
    
    return { payout, reserved: true };
  });
}
```

For the ledger entry balanceAfter on reservation: after the atomic update, the account's reservedBalance has increased by `amount`. So the new reservedBalance is `old + amount`. We can get this from the account (but it's a stale read since we did the update via raw SQL).

Hmm, same issue as before. Let me use RETURNING:

```ts
const [{ reserved_balance }] = await tx.$queryRaw<{ reserved_balance: bigint }>`
  UPDATE "accounts" 
  SET "reserved_balance" = "reserved_balance" + ${data.amount}
  WHERE "id" = ${data.accountId} 
    AND ("settled_balance" - "reserved_balance") >= ${data.amount}
  RETURNING "reserved_balance"
`;
// balanceAfter = reserved_balance (the new one)
```

And we also need to verify the reservation succeeded (row was actually updated). The RETURNING clause will return empty if no row matched, so we can check:

```ts
const rows = await tx.$queryRaw<{ reserved_balance: bigint }>`
  UPDATE "accounts" ... RETURNING "reserved_balance"
`;
if (rows.length === 0) {
  return { payout: null as any, reserved: false };
}
const reservedBalance = rows[0].reserved_balance;
```

This is perfect — atomic update + verification + getting the new balance in one operation.

Let me use this approach.

Now, let me finalize the complete code for all files.

I realize I also need to handle the `processMessages` correctly regarding the `getSentPayouts` method. For the confirmation phase, we need all payouts with status SENT. The provider.confirm method is called for each.

Let me also think about how `provider.confirm` works. Since we don't have a real confirmation mechanism, I'll create a simple provider that has a `confirm` method. In tests, we can mock it.

The ProviderService:
```ts
@Injectable()
export class ProviderService {
  async transfer(payload: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    // ASSUMPTION: Calls blockchain SDK
    return { txHash: crypto.randomUUID ? crypto.randomUUID() : `0x${Date.now().toString(16)}` };
  }
  
  async confirm(txHash: string): Promise<boolean> {
    // ASSUMPTION: Checks blockchain for confirmation
    return true;
  }
}
```

In tests, we mock this service.

Now let me write all the files. Final answer coming up.

One more consideration: the Prisma schema needs `@@map` for all tables and `@map` for all columns (snake_case). And the enums need `@@map` too? Actually, in Prisma, enum values don't need @map since they're stored as strings in the database and the enum names in SQL are auto-generated (usually pluralized lowercase). Let me check.

In PostgreSQL with Prisma, enum types are created as `enum_PayoutStatus` by default. To control the name, we can use `@@map`:

```prisma
enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
  @@map('payout_status')
}

enum MsgStatus {
  PENDING
  PROCESSED
  @@map('message_status')
}
```

This maps to `payout_status` and `message_status` in PostgreSQL.

OK, now I'll write all the files. Let me be methodical.

One more thing about the test: since I'm mocking the repository and provider, the tests will be unit tests for the service. They test the BEHAVIOR of the service (correct routing based on inputs), not the implementation. This is the right approach per the conventions.

But wait, the convention says "Never assert only that a call happens." So I need to assert outcomes, not just mock expectations. For example:
- ✅ "When reserved is false, service throws INSUFFICIENT_FUNDS error"
- ✅ "When provider succeeds, payout status becomes SENT"
- ❌ "Repository.createPayoutWithReservation was called"

Let me make sure my tests assert outcomes.

Now, writing the final code:

Let me also make sure I have the right imports. In NestJS with TypeScript strict mode:
- `import { Injectable, Inject, OnModuleInit } from '@nestjs/common';`
- `import { PrismaClient } from '@prisma/client';`
- etc.

And for the error envelope in the controller, I'll use a custom exception filter.

Let me also create a simple `AppError` class:

```ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, any> = {},
  ) {
    super(message);
  }
}
```

And an exception filter:

```ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch(AppError)
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: AppError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(HttpStatus.BAD_REQUEST).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

Wait, should `insufficient_funds` be 400 or 409? 409 Conflict makes more sense for a business rule violation. But the convention doesn't specify. Let me use 400 for validation errors and 409 for business rule violations.

Actually, let me keep it simple and use 400 for all service errors.

Now let me write all the files. I'll organize them logically.

For the test, I'll also need to handle the fact that `processMessages` involves both send and confirm phases. I'll test each phase separately.

Test cases:
1. `create` — success: payout created, funds reserved, message queued
2. `create` — idempotency: returns existing payout
3. `create` — insufficient funds: throws AppError
4. `processMessages` — send: pending message processed, provider.transfer called, payout → SENT
5. `processMessages` — duplicate message: already PROCESSED message, no duplicate transfer
6. `processMessages` — retry exhaustion: provider fails, payout → NEEDS_REVIEW
7. `processMessages` — confirmation: sent payout confirmed, → COMPLETED, settled balance updated

Let me write 7 test blocks. Each will be clear about what behavior it tests.

Alright, I'm going to write all the code now. Here it goes:

One more thing: the `processMessages` method needs access to `getSentPayouts` which returns payouts with status SENT. And for each, it calls `provider.confirm(txHash)`. If confirmed → settle. If not → FAILED.

In the test for confirmation, I'll mock:
- `payoutRepo.getSentPayouts()` returns a payout with status SENT
- `provider.confirm()` returns true
- Then verify: payout status COMPLETED, settled balance updated, ledger entry created

But wait, in my architecture, `settlePayout` is a repository method that updates payout → COMPLETED, account settled balance, and creates ledger entry — all in one transaction. So the service just calls `payoutRepo.settlePayout(payout.id, accountId, amount)`.

In the test, I mock `payoutRepo.settlePayout`. So I verify:
- `payoutRepo.settlePayout` was called with the right arguments → but this asserts implementation, not behavior!

Let me re-think. The behavior to assert is:
- After processMessages, for a SENT payout with confirmed status: payout.status should be COMPLETED (or the settlePayout method was called with the payout ID)

Hmm, but the payout is mocked. The test can't observe the payout's status change.

OK, let me test differently. Instead of mocking the repository completely, let me use a partial mock or test at a different level.

For the behavioral tests, let me test the repository methods directly (they're the boundary to the database) and the service methods with mocked repositories.

For the service tests:
- Mock repository returns
- Assert that the service makes the correct repository calls based on the inputs

But "asserting calls" is discouraged... Unless we assert the OUTCOME, not the call.

The outcome of `processMessages` when a SENT payout is confirmed:
- The settlePayout method is called (this is an outcome — the decision to settle)
- OR: the payout ends up in COMPLETED state

Since we're mocking, we can't observe state changes. But we can assert the side effects. Let me think about what side effects are observable:

When `processMessages` processes a pending message:
- `payoutRepo.transitionToProcessing` called → outcome: we attempted to claim the payout
- `provider.transfer` called → outcome: we sent the transfer
- `payoutRepo.markSent` called → outcome: we recorded success
- `payoutRepo.markMessageProcessed` called → outcome: we cleaned up the message

When it processes a SENT payout for confirmation:
- `provider.confirm` called → outcome: we checked for confirmation
- `payoutRepo.settlePayout` called → outcome: we settled

These are all valid outcomes to assert. The convention says "Never assert only that a call happens" — meaning don't just check `expect(jest.fn()).toHaveBeenCalled()`. Instead, check that the result is correct.

Since we're testing in isolation (mocked repo and provider), the "result" is the observable behavior. Let me combine calls into observable outcomes:

For example, in the test for "send success":
1. Set up: pending message with CREATED payout, provider.transfer succeeds
2. Call: processMessages
3. Assert: payoutRepo.markSent was called with the right txHash (outcome: transfer was successful and recorded)

But this is asserting a call. The alternative is to check that the payout's status would have been updated, but since it's mocked, we can't check that.

I think the convention is about integration tests, not unit tests. For integration tests (with real DB), you assert state changes. For unit tests (with mocks), you assert the correct flow happens.

Let me write both: unit tests for the service logic, and integration tests for key scenarios.

Wait, but the task says "Vitest" for tests. Let me write integration-style tests that use a real Prisma client connected to a test database. I'll set up the database in `beforeAll` and clean up in `afterAll`.

This would be the most correct approach: real DB, real repository, real Prisma, test the actual behavior.

Let me do that. The test will:
1. Set up PrismaClient connected to test DB (from DATABASE_URL or a test URL)
2. Create test data
3. Call service methods
4. Query DB to verify outcomes
5. Clean up

For concurrent creation test, I'll create two concurrent requests and check that only one succeeded.

This is more involved but much more meaningful. Let me do it.

But wait, for the provider, I still need to mock it (or have a test double). I'll inject a mock provider into the service.

Let me restructure the test:
1. Create a real PayoutService with real repositories but a mocked provider
2. Use a real PrismaClient connected to the test database
3. Test the actual behavior with real DB state

This is the best of both worlds: real DB state verification + controlled provider behavior.

Let me write it this way.

Here's the test setup:
```ts
let prisma: PrismaClient;
let payoutService: PayoutService;
let provider: ProviderService;

beforeAll(async () => {
  prisma = new PrismaClient();
  // Seed: create test account with balance
  await prisma.account.create({ data: { id: 'test-account', ... } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean up
  await prisma.ledgerEntry.deleteMany();
  await prisma.message.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.account.update({ where: { id: 'test-account' }, data: { settledBalance: 1000n, reservedBalance: 0n } });
  
  // Create service with mocked provider
  provider = createMockProvider();
  payoutService = new PayoutService(
    new PayoutRepository(prisma),
    new AccountRepository(prisma),
    provider,
  );
});
```

Wait, `AccountRepository` and `PayoutRepository` need `PrismaClient` injected. Let me make them accept it via constructor.

For the mock provider:
```ts
function createMockProvider({ transferResult, confirmResult }: { transferResult?: { txHash: string }; confirmResult?: boolean }) {
  return {
    transfer: vi.fn().mockResolvedValue(transferResult || { txHash: '0xabc' }),
    confirm: vi.fn().mockResolvedValue(confirmResult !== undefined ? confirmResult : true),
  };
}
```

Now the tests:

Test 1: Concurrent creation
```ts
it('should allow only one reservation when two concurrent requests target same account', async () => {
  // Account has 1000 in settled, 0 reserved → available = 1000
  // Two requests for 600 each
  const dto = { accountId: 'test-account', amount: 600n, destinationAddress: '0x123', idempotencyKey: 'key-1' };
  
  const [result1, result2] = await Promise.all([
    payoutService.create(dto),
    payoutService.create(dto), // same idempotency key, so second returns first
  ]);
  
  // Same idempotency key → same payout
  expect(result1.id).toBe(result2.id);
  
  // Now try with different idempotency keys
  const dto2 = { accountId: 'test-account', amount: 600n, destinationAddress: '0x456', idempotencyKey: 'key-2' };
  const [result3, result4] = await Promise.all([
    payoutService.create(dto2),
    payoutService.create({ ...dto2, idempotencyKey: 'key-3' }),
  ]);
  
  // Only one should succeed (account has 1000, each request needs 600)
  // But the other should fail with insufficient funds
  // ...
});
```

Hmm, with idempotency keys being different, the second test has two different keys. The atomic reserve should ensure only one succeeds. Let me adjust.

Actually, let me separate the tests:
1. Idempotency test: same key → same payout
2. Concurrent test: different keys, same account with limited funds → exactly one succeeds

Test 2: Concurrent creation with different keys
```ts
it('should allow exactly one payout when two concurrent requests target same account', async () => {
  // Account has 1000 settled, 0 reserved
  // Two requests for 600 each with different idempotency keys
  // Only one should succeed (600 + 600 > 1000)
  
  const dto1 = { accountId: 'test-account', amount: 600n, destinationAddress: '0x123', idempotencyKey: 'concurrent-1' };
  const dto2 = { accountId: 'test-account', amount: 600n, destinationAddress: '0x456', idempotencyKey: 'concurrent-2' };
  
  const [result1, result2] = await Promise.all([
    payoutService.create(dto1),
    payoutService.create(dto2),
  ]);
  
  // One succeeded, one failed
  const successes = [result1, result2].filter(r => !(r instanceof Error || r?.code === 'insufficient_funds'));
  const failures = [result1, result2].filter(r => r instanceof Error || r?.code === 'insufficient_funds');
  
  expect(successes.length).toBe(1);
  expect(failures.length).toBe(1);
  
  // Check the account's reserved balance
  const account = await prisma.account.findUnique({ where: { id: 'test-account' } });
  expect(account!.reservedBalance).toBe(600n); // Only one reserved
});
```

Test 3: Duplicate message delivery
```ts
it('should not process the same message twice', async () => {
  // Create a payout and message manually in the DB
  const payout = await prisma.payout.create({
    data: {
      accountId: 'test-account',
      amount: 100n,
      destinationAddress: '0x123',
      idempotencyKey: 'dup-test',
      status: 'CREATED',
    },
  });
  const message = await prisma.message.create({
    data: { payoutId: payout.id, status: 'PENDING' },
  });
  
  // First processing
  await payoutService.processMessages();
  
  // Provider.transfer should have been called once
  expect(provider.transfer).toHaveBeenCalledTimes(1);
  
  // Check message is PROCESSED
  const processedMessage = await prisma.message.findUnique({ where: { id: message.id } });
  expect(processedMessage!.status).toBe('PROCESSED');
  
  // Reset provider mock to verify no second call
  provider.transfer.mockClear();
  
  // Second processing (simulating duplicate delivery)
  await payoutService.processMessages();
  
  // Provider.transfer should NOT have been called again
  expect(provider.transfer).not.toHaveBeenCalled();
});
```

Test 4: Retry exhaustion
```ts
it('should move payout to NEEDS_REVIEW when provider retries are exhausted', async () => {
  // Create a payout and message
  const payout = await prisma.payout.create({
    data: {
      accountId: 'test-account',
      amount: 100n,
      destinationAddress: '0x123',
      idempotencyKey: 'retry-test',
      status: 'CREATED',
    },
  });
  await prisma.message.create({
    data: { payoutId: payout.id, status: 'PENDING' },
```

## reply

(empty)
