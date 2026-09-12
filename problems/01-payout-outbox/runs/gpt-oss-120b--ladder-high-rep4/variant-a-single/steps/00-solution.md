# solution

## reasoning

```
We need to implement the solution according to the specifications. We have to produce files: Prisma schema (migration is derived automatically by Prisma, but we need the schema definitions). NestJS module includes controller, service, repository, worker (which may be a provider that runs a periodic process). Also tests.

We need to follow layer conventions: controller validates input and calls service, no business logic. Service contains business logic. Repository accesses database.

Need to implement idempotency key handling: duplicate request with same idempotencyKey should not create another payout or reserve funds again. This can be enforced by unique constraint on payouts.idempotencyKey and perhaps also mapping to accountId? The idempotency key is per client, not per account maybe globally unique. We'll enforce unique.

We need to handle concurrent requests. Use a transaction that atomically checks account balance (available funds) and reserves (increase held/reserved). Approach: account table with fields: id (UUID), settled_balance (bigint), reserved_balance (bigint). Available = settled_balance - reserved_balance. To reserve, we need to decrement available by amount: i.e., increase reserved_balance by amount if settled_balance - reserved_balance >= amount. In Postgres we can perform a conditional update: UPDATE account SET reserved_balance = reserved_balance + $1 WHERE id = $2 AND settled_balance - reserved_balance >= $1 RETURNING *; This ensures atomic check+update, only one of concurrent transactions will succeed if funds insufficient.

We'll also need to insert payout row and message row in same transaction. The payout row will have fields: id (UUID), account_id (FK), amount (bigint), destination_address (string), status (enum), idempotency_key (string unique), created_at, updated_at, provider_tx_hash (string optional), retries (int default 0), last_error (string optional). Status enum: 'created', 'processing', 'sent', 'completed', 'failed', 'needs_review' (like specification). However maybe we can have statuses: 'created' (reservation done), 'processing' (when worker picks up), 'sent' (when provider transfer succeeded, but settlement pending?), 'completed' (settled), 'failed' (provider error), 'needs_review' (retry exhausted). Use 'needs_review'.

Message table: id (UUID), payout_id (FK), attempts (int), next_attempt_at (timestamp?), created_at, updated_at, locked_at? For simplicity we can have a simple outbox table with fields: id (UUID), payout_id (FK), processed (boolean), attempts (int), last_error (string?), created_at. The worker polls messages where processed = false and picks them (optimistically) and attempts processing. Need to ensure idempotent processing: second delivery should not cause duplicate transfer. Approach: use a status field on payout: change from 'created' to 'processing' conditionally via atomic update where status = 'created' and we update to 'processing', then process. So if worker sees a message again, when it tries to update status from 'created' to 'processing' but it's already 'processing' or beyond, it will not do it.

Alternative: In message table we can have a unique constraint on payout_id to ensure only one message per payout. But duplicate processing must be idempotent anyway.

Implementation plan:

Prisma schema:

- Account model: id UUID @id @default(uuid()) @map("account"), settled_balance BigInt (prisma uses `BigInt` type, maps to `bigint`), reserved_balance BigInt (default 0). createdAt, updatedAt timestamps. Possibly @map.

- Payout model: id UUID @id @default(uuid()) @map("payout"), accountId UUID, amount BigInt, destinationAddress String, status Enum (PayoutStatus), idempotencyKey String @unique, providerTxHash String? (optional), retries Int @default(0), lastError String? (optional), createdAt, updatedAt.

- PayoutMessage (outbox) model: id UUID @id @default(uuid()), payoutId UUID @unique? Actually may have one message per payout. Use relation to payout. processed Boolean @default(false), attempts Int @default(0), lastError String?, createdAt, updatedAt.

- Enums: PayoutStatus: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW

Now implement NestJS modules:

Structure:

src/payout/payout.module.ts: imports PrismaService (global maybe defined elsewhere). Provides PayoutService, PayoutRepository, PayoutWorker (maybe provider). Declares PayoutController.

src/payout/payout.controller.ts: Handles POST /payouts. DTO: CreatePayoutDto with accountId: string, amount: string (or number?), destinationAddress: string, idempotencyKey: string. Use validation pipe, class-validator. Controller calls payoutService.createPayout(dto). Returns payout DTO.

src/payout/payout.service.ts: Contains createPayout method. The logic:

- Use repository to attempt to create payout within a transaction. Use Prisma's transaction (prisma.$transaction). In transaction:

   - Acquire account row with conditional update: account = await prisma.account.updateMany({
        where: {
           id: accountId,
           settled_balance: {
              gte: // compute reserved + amount? Actually we need to ensure settled_balance - reserved_balance >= amount.
              // We cannot directly subtract in Prisma filter but we can use raw query or compute. Use a raw query perhaps.

   }). However Prisma does not support arithmetic in where. So we might need to use raw SQL. For simplicity, use Prisma.$executeRaw with UPDATE ... WHERE settled_balance - reserved_balance >= amount.

But we must produce TypeScript code; we can use $transaction and $executeRaw to do atomic check+update.

Simplify: Use `prisma.$executeRaw` with query:

```
UPDATE "account"
SET "reserved_balance" = "reserved_balance" + $1
WHERE "id" = $2
AND ("settled_balance" - "reserved_balance") >= $1
RETURNING *
```

But `$executeRaw` returns number of rows affected, not the row. There's also `$queryRaw` which returns rows.

Alternatively we can use `prisma.account.findUnique` to fetch current values, compute, then use update with `if` concurrency guard via `prisma.account.update` with a where clause that also includes condition for reserved_balance to ensure enough funds. Prisma supports `where: { id: accountId, settled_balance: { gte: amount + reserved_balance } }`? Actually condition includes columns but not calculated values. Could do:

```
where: {
  id: accountId,
  settled_balance: {
    gte: Prisma.sql`(reserved_balance + ${amount})` // no.
}
```

So cannot incorporate reserved_balance.

Therefore we need raw SQL for atomic conditional update.

We'll create repository method `reserveFunds(accountId: string, amount: bigint): Promise<Account | null>` which returns account if reservation succeeded else null.

Implementation using prisma.$queryRaw: 

```
const result = await this.prisma.$queryRaw<
  { id: string; settled_balance: bigint; reserved_balance: bigint }[]
>`
  UPDATE "account"
  SET "reserved_balance" = "reserved_balance" + ${amount}
  WHERE "id" = ${accountId}
    AND ("settled_balance" - "reserved_balance") >= ${amount}
  RETURNING *
`;
```

Because $queryRaw returns array of rows.

If result.length == 1 => reservation succeeded. Otherwise insufficient funds.

Now after reserving, we create payout row and message row in same transaction.

We need to ensure that if idempotencyKey already exists, we return existing payout (and not reserve again). So at the start of transaction, we can check if payout with idempotencyKey exists: `await prisma.payout.findUnique({ where: { idempotencyKey } })`. If exists, return it. No new reservation needed.

But we need to be careful about concurrency: two requests with same idempotencyKey concurrently. They should both see same payout and only one reservation. We can enforce unique constraint on idempotencyKey; if both attempt to insert same key, one fails with unique violation. So we should attempt to insert payout and message after reservation. If insertion fails due to unique violation, we roll back transaction; then we can fetch the existing payout.

Simplify: In service, start transaction:

- Try to find existing payout with idempotencyKey. If found, return it.

- Else attempt to reserve funds using raw query (which is independent transaction but we want to include in same transaction). Actually we can run raw query within the transaction context by using `prisma.$queryRaw` inside `$transaction`. Prisma's transaction includes raw queries as part of the same transaction when using `$transaction([prisma.$executeRaw(...), prisma.payout.create(...), ...])` but we need to coordinate.

Simplify approach: Use explicit transaction using Prisma's `$transaction` with a function that receives transaction client.

```
return await this.prisma.$transaction(async (tx) => {
    // check existing payout
    const existing = await tx.payout.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    // reserve funds
    const reserveResult = await tx.$queryRaw...
    if (reserveResult.length === 0) {
       throw new NotEnoughFundsError...
    }
    // create payout
    const payout = await tx.payout.create({
        data: {
            accountId,
            amount,
            destinationAddress,
            status: 'CREATED',
            idempotencyKey,
        },
    });
    // create message
    await tx.payoutMessage.create({
        data: {
            payoutId: payout.id,
        },
    });
    return payout;
});
```

Now concurrency: If two transactions start concurrently, both will check existing payout; none exist; both will attempt to reserve funds. The conditional update ensures only one will succeed if funds suffice for only one. The other will have reserveResult empty, then we throw an error maybe InsufficientFunds. That's fine.

If they have distinct idempotencyKey but concurrent, only one gets funds reserved.

If they have same idempotencyKey, both check findUnique; race condition: both may not find it, then both attempt to create payout with same unique key, causing unique violation on insertion. This will cause a rollback for the transaction of one. We can catch Prisma known error (code 'P2002' Unique constraint violation) and then fetch the existing payout and return it.

Thus we need to handle.

Now the worker:

A provider that runs `processMessages` at interval (maybe using `setInterval`). Since the code is run within NestJS, we can use a `@Injectable` that starts on application bootstrap via `OnModuleInit` hook to schedule the interval. The worker will fetch unprocessed messages (limit maybe). For each message, attempt to process it:

- Retrieve payout (including status). If payout.status not 'CREATED' maybe skip.

- Try to update payout status to 'PROCESSING' atomically (ensuring only one worker processes). Use conditional update: `UPDATE payout SET status = 'PROCESSING' WHERE id = $payoutId AND status = 'CREATED' RETURNING *`. Use raw query or Prisma update with where condition on status: `tx.payout.updateMany({ where: { id: payoutId, status: 'CREATED' }, data: { status: 'PROCESSING' } })`. This returns count. If count = 0, skip (already processed).

- Then call provider.transfer with destinationAddress and amount. This returns txHash.

- If transfer succeeds, update payout: status = 'SENT', providerTxHash = txHash, retries = current+1? Actually retries is for provider attempts; perhaps we increment after each attempt. Also we mark message as processed true.

- After provider returns, we need to settle: subtract amount from settled_balance (debit) and reduce reserved_balance by amount, effectively moving reserved to settled? Actually we must debit settled_balance and also reduce reserved_balance accordingly, maybe after confirmation. The provider confirmation is immediate as per transfer call? But spec says provider confirms transfer after call maybe returns txHash, but not confirmed. However we can treat success as final settlement for simplicity as long as we separate reserved and settled.

The spec says "settlement debits" and "settled balance changes only when the provider confirms the transfer". Provider transfer may be considered confirmation if it returns txHash? Actually provider SDK may return after sending transaction, but not guarantee confirmed. But we can treat as confirmation for the sake. Or we can set status = 'SENT', then later a separate step could confirm. But given the spec limited, we may treat the provider's successful call as confirmation, and move funds.

Thus after success, we need to update account: reduce settled_balance by amount, and reserved_balance by amount (since reserved funds now paid). So net change: settled_balance decreases, reserved_balance decreases. So account's available = settled_balance - reserved_balance remains correct. The transaction for settlement should be atomic with payout status update to completed maybe.

Simplify: In worker, after provider success, we do a transaction: update payout status to 'COMPLETED', set providerTxHash, set completed timestamp maybe, and update account balances.

But we need to consider the provider may throw or time out. On failure, we need to retry up to max attempts. If retries exceed max, move payout to 'NEEDS_REVIEW' and keep reservation intact (i.e., not release reserved funds). So we do not adjust balances.

If provider fails temporarily (throw), we increment retries, store lastError, maybe schedule later attempt (message attempts increment). Since at-least-once, we may just leave message as unprocessed and try later. Or we can update message attempts and not mark processed. The worker's loop can just reprocess message again later.

Simplify: Keep message table where processed flag indicates done; we will not set processed until final status either COMPLETED or FAILED? But we need to handle retries: after a failure we do not set processed, and we will attempt again later. But we need to limit attempts. So we need attempts column. Each time we process, we increment attempts. If attempts >= MAX_RETRIES (e.g., 3), we set payout status to 'NEEDS_REVIEW' and mark message processed (so no further attempts). Also we should keep reservation unchanged.

Thus algorithm:

Worker:

```
while (true) {
   const messages = await this.prisma.payoutMessage.findMany({
        where: { processed: false },
        take: 10,
   });
   for (const msg of messages) {
        await this.processMessage(msg);
   }
   await sleep(this.intervalMs);
}
```

Processing a message:

```
await this.prisma.$transaction(async (tx) => {
   const payout = await tx.payout.findUnique({ where: { id: msg.payoutId } });
   if (!payout) {
      // mark message processed maybe.
      await tx.payoutMessage.update({ where: { id: msg.id }, data: { processed: true } });
      return;
   }
   // Ensure idempotence: only process if status is CREATED or PROCESSING? Actually after first attempt, we set status to PROCESSING. If already PROCESSING or SENT or COMPLETED etc., skip and mark processed true.
   if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
       await tx.payoutMessage.update({ where: { id: msg.id }, data: { processed: true } });
       return;
   }

   // Attempt to transition to PROCESSING if currently CREATED, to avoid duplicate processing:
   const updated = await tx.payout.updateMany({
        where: { id: payout.id, status: 'CREATED' },
        data: { status: 'PROCESSING' }
   });
   if (updated.count === 0) {
        // Another worker already processing; skip.
        await tx.payoutMessage.update({ where: { id: msg.id }, data: { processed: true } });
        return;
   }

   // Now call provider
   try {
      const result = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amount });
      // success
      await tx.payout.update({
          where: { id: payout.id },
          data: {
              status: 'COMPLETED',
              providerTxHash: result.txHash,
          },
      });
      // update account balances
      await tx.account.update({
          where: { id: payout.accountId },
          data: {
              settled_balance: Prisma.sql`settled_balance - ${payout.amount}`?? Actually using raw again.
              reserved_balance: Prisma.sql`reserved_balance - ${payout.amount}`,
          },
      });
      // mark message processed
      await tx.payoutMessage.update({ where: { id: msg.id }, data: { processed: true, attempts: { increment: 1 } } });
   } catch (error) {
      // failure
      const attempts = msg.attempts + 1;
      const updateData: any = {
         attempts,
         lastError: error.message ?? '',
      };
      if (attempts >= MAX_RETRIES) {
          // set payout status needs_review
          await tx.payout.update({ where: { id: payout.id }, data: { status: 'NEEDS_REVIEW', lastError: error.message } });
          updateData.processed = true;
      }
      await tx.payoutMessage.update({ where: { id: msg.id }, data: updateData });
   }
});
```

Need to handle provider import. We'll define a simple provider wrapper interface that we can mock in tests. For production, we assume a provider that has transfer method.

We'll create src/provider/crypto-provider.service.ts (or just define within worker). But spec says provider SDK is `provider.transfer({to, amount}) -> {txHash}`; we can define an injectable class `CryptoProvider` with transfer method.

Testing:

- Concurrent creation: Use `Promise.all` to start two requests (or service calls) concurrently. Use vitest, simulate concurrency by calling `payoutService.createPayout` twice in parallel with same account and amounts that exceed available funds for two. Expect only one payout is created, and reserved amount reflects only one reservation.

- Duplicate message delivery: Simulate worker processing same message twice. Ensure provider.transfer called only once (maybe spy). Also ensure payout status ends up 'COMPLETED' and not double transfer.

- Retry exhaustion: Simulate provider throwing for max attempts, ensure payout status becomes NEEDS_REVIEW, reservation stays.

We need to implement test harness that uses an in-memory SQLite or a test PostgreSQL? Usually Prisma can use SQLite for tests. However spec says PostgreSQL but we can still use SQLite maybe. We'll assume environment configured.

We need to create PrismaService (if not exists). Usually NestJS can have a PrismaService that wraps PrismaClient.

We'll need to create `src/prisma.service.ts` (common pattern). But if already present in codebase? The task states we can create new files as needed. So we can add `src/prisma.service.ts`.

Project uses ESM modules, `type: "module"`.

We need to implement `src/main.ts` entry maybe, but not required to compile tests.

Focus on features.

Now deliver design file.

We'll create files:

- prisma/schema.prisma

- src/app.module.ts (setup modules)

- src/prisma.service.ts (prisma client provider)

- src/payout/payout.module.ts

- src/payout/payout.controller.ts

- src/payout/payout.service.ts

- src/payout/payout.repository.ts

- src/payout/payout.worker.ts (the worker provider)

- src/payout/dto/create-payout.dto.ts

- src/payout/enums/payout-status.enum.ts

- src/provider/crypto-provider.service.ts (mockable provider)

- test/payout.spec.ts

- DESIGN.md

We must ensure all naming conventions: file names kebab-case. So `payout.service.ts`, etc.

Paths per spec: `src/<feature>/<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`. So `src/payout/payout.module.ts`, `src/payout/payout.controller.ts`, `src/payout/payout.service.ts`, `src/payout/payout.repository.ts`.

Create worker file maybe as `payout.worker.ts` but not required by naming rule. But we can put worker inside service or separate file. According to convention, only those four files exist for a feature. But spec says "NestJS module: controller, service, worker". Worker is not listed in layers. Could be a provider defined in same module. We could add `payout.processor.ts` but naming rule not enforced beyond conventions. Might be okay.

We'll add `src/payout/payout.processor.ts`.

Now implement.

First, Prisma schema.

We need to map names to snake_case.

Define models:

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then models:

```
model Account {
  id               String   @id @default(uuid()) @map("id")
  settled_balance  BigInt   @map("settled_balance")
  reserved_balance BigInt   @default(0) @map("reserved_balance")
  created_at       DateTime @default(now()) @map("created_at")
  updated_at       DateTime @updatedAt @map("updated_at")

  payouts          Payout[]

  @@map("account")
}
```

Note: Prisma uses `BigInt` type for bigint.

Now Payout:

```
model Payout {
  id                 String          @id @default(uuid()) @map("id")
  account_id         String          @map("account_id")
  amount             BigInt          @map("amount")
  destination_address String          @map("destination_address")
  status             PayoutStatus    @default(CREATED) @map("status")
  idempotency_key   String          @unique @map("idempotency_key")
  provider_tx_hash   String?         @map("provider_tx_hash")
  retries            Int             @default(0) @map("retries")
  last_error         String?         @map("last_error")
  created_at         DateTime        @default(now()) @map("created_at")
  updated_at         DateTime        @updatedAt @map("updated_at")

  account            Account         @relation(fields: [account_id], references: [id])
  message            PayoutMessage? @relation(fields: [id], references: [payout_id])

  @@map("payout")
}
```

The relation to message is optional; we might have one message per payout. We'll define foreign key in message.

Now PayoutMessage:

```
model PayoutMessage {
  id          String   @id @default(uuid()) @map("id")
  payout_id   String   @unique @map("payout_id")
  processed   Boolean  @default(false) @map("processed")
  attempts    Int      @default(0) @map("attempts")
  last_error  String?  @map("last_error")
  created_at  DateTime @default(now()) @map("created_at")
  updated_at  DateTime @updatedAt @map("updated_at")

  payout      Payout   @relation(fields: [payout_id], references: [id])

  @@map("payout_message")
}
```

Now Enum:

```
enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}
```

But the worker may not use SENT; we can skip or keep.

Now in NestJS, we need to ensure that Prisma client is imported. We'll define PrismaService extending PrismaClient and exposing methods.

`src/prisma.service.ts`:

```
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Now define DTO:

`src/payout/dto/create-payout.dto.ts`:

```
import { IsString, IsUUID, IsNotEmpty, IsInt, Min, Matches } from 'class-validator';

export class CreatePayoutDto {
  @IsUUID()
  accountId: string;

  // Amount in minor units as string to avoid JS number overflow, validate integer
  @Matches(/^\d+$/)
  amount: string;

  @IsString()
  @IsNotEmpty()
  destinationAddress: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
```

We can convert amount to BigInt in service.

Now PayoutRepository: It will have methods to find payout by idempotencyKey, to create payout, to create message, to reserve funds, to update payout status and balances. It will use Prisma client.

We can keep the raw SQL queries there.

Define file `src/payout/payout.repository.ts`.

We'll need to import PrismaService and Prisma types.

Implementation:

```
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma, Payout, PayoutStatus, Account } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotency_key: idempotencyKey } });
  }

  async reserveFunds(accountId: string, amount: bigint): Promise<Account | null> {
    // Conditional update: increase reserved_balance if sufficient settled_balance
    const result = await this.prisma.$queryRaw<
      {
        id: string;
        settled_balance: bigint;
        reserved_balance: bigint;
      }[]
    >`
      UPDATE "account"
      SET "reserved_balance" = "reserved_balance" + ${amount}
      WHERE "id" = ${accountId}
        AND ("settled_balance" - "reserved_balance") >= ${amount}
      RETURNING "id", "settled_balance", "reserved_balance"
    `;

    if (result.length === 0) {
      return null;
    }

    // Return the updated account as Prisma type
    const row = result[0];
    return {
      id: row.id,
      settled_balance: row.settled_balance,
      reserved_balance: row.reserved_balance,
      created_at: new Date(),
      updated_at: new Date(),
      // The following properties are not used by this repository; fill with placeholders
      // but TypeScript may require all fields; we can cast to any
    } as any;
  }

  async createPayout(data: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<Payout> {
    return this.prisma.payout.create({
      data: {
        account_id: data.accountId,
        amount: data.amount,
        destination_address: data.destinationAddress,
        idempotency_key: data.idempotencyKey,
        status: 'CREATED',
        // Prisma will map enum automatically with string value matching enum name
      },
    });
  }

  async createMessage(payoutId: string): Promise<void> {
    await this.prisma.payoutMessage.create({
      data: {
        payout_id: payoutId,
      },
    });
  }

  async findMessageById(id: string) {
    return this.prisma.payoutMessage.findUnique({ where: { id } });
  }

  async findUnprocessedMessages(limit: number) {
    return this.prisma.payoutMessage.findMany({
      where: { processed: false },
      take: limit,
    });
  }

  async markMessageProcessed(messageId: string, attempts: number, lastError?: string, processed?: boolean) {
    const data: Prisma.PayoutMessageUpdateInput = {
      attempts: { increment: 1 },
    };
    if (lastError !== undefined) {
      data.last_error = lastError;
    }
    if (processed !== undefined) {
      data.processed = processed;
    }
    return this.prisma.payoutMessage.update({
      where: { id: messageId },
      data,
    });
  }

  async updatePayoutStatus(payoutId: string, status: PayoutStatus, providerTxHash?: string, lastError?: string) {
    const data: Prisma.PayoutUpdateInput = {
      status,
    };
    if (providerTxHash) {
      data.provider_tx_hash = providerTxHash;
    }
    if (lastError) {
      data.last_error = lastError;
    }
    return this.prisma.payout.update({
      where: { id: payoutId },
      data,
    });
  }

  async incrementPayoutRetries(payoutId: string) {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        retries: { increment: 1 },
      },
    });
  }

  async settlePayout(payoutId: string, accountId: string, amount: bigint, providerTxHash: string) {
    // Perform payout status update and account balance adjustments in a transaction.
    return this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: 'COMPLETED',
          provider_tx_hash: providerTxHash,
        },
      });

      // Decrease settled_balance and reserved_balance atomically
      await tx.$executeRawUnsafe(`
        UPDATE "account"
        SET "settled_balance" = "settled_balance" - ${amount},
            "reserved_balance" = "reserved_balance" - ${amount}
        WHERE "id" = '${accountId}'
      `);
    });
  }

  async attemptProcessing(payoutId: string): Promise<boolean> {
    // Try to move status from CREATED to PROCESSING atomically.
```

## reply

(empty)
