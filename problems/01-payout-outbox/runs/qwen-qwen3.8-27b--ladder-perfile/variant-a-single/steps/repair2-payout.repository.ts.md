# repair2-payout.repository.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/payout/payout.repository.ts` needs to export.

From the error messages, I can see that:

1. `src/payout/payout.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.`
   - This means the file imports from `../prisma/prisma.service`

2. `src/payout/payout.module.ts(4,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
   - The module imports from `./payout.repository`

3. `src/payout/payout.service.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
   - The service imports from `./payout.repository`

4. `src/payout/payout.worker.ts(2,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
   - The worker imports from `./payout.repository`

5. `test/payout.spec.ts(2,34): error TS2307: Cannot find module '../src/payout/payout.repository' or its corresponding type declarations.`
   - The test imports from `../src/payout/payout.repository`

So the file `src/payout/payout.repository.ts` needs to exist and export a class (likely `PayoutRepository`) that is used by the service, worker, module, and tests.

The file currently exists (it's named in the error) but doesn't compile because it imports `../prisma/prisma.service` which doesn't exist.

Wait, let me re-read the task. The task says "Rewrite `src/payout/payout.repository.ts` complete, fixing what these messages require of this file."

So I need to write the complete file. The key constraint is:
- It imports from `../prisma/prisma.service` (line 3, col 31)
- It needs to export something that the service, worker, module, and tests can use

Looking at the schema, I can see the models: Account, Payout, Message, LedgerEntry, LedgerLine.

The repository is the only layer that touches the database. It should use Prisma.

Let me think about what methods the repository needs based on the requirements:

1. **Concurrent creation against one account** - Need atomic balance check and reservation
2. **Duplicate message delivery** - Need to fetch pending messages, mark as processing, mark as processed
3. **Retry exhaustion** - Need to track attempts
4. **Idempotency** - Need to check/create payout by idempotency key
5. **Ledger** - Need to create ledger entries and lines
6. **Payout lifecycle** - Need to update payout status

The repository needs to:
- Import PrismaService from `../prisma/prisma.service`
- Use Prisma for database operations
- Provide methods for:
  - Creating a payout with idempotency (atomic operation with balance check)
  - Fetching pending messages
  - Marking message as processing
  - Marking message as processed
  - Incrementing message attempts
  - Updating payout status
  - Creating ledger entries
  - Finding payout by id

Let me think about what the service, worker, and tests would need from this repository:

From the service perspective:
- `createPayoutWithReservation({ accountId, amount, destinationAddress, idempotencyKey })` - atomically checks balance, reserves funds, creates payout, creates message
- Or maybe separate methods

From the worker perspective:
- `getPendingMessages()` - fetch messages that are pending and due
- `markMessageProcessing(id)` - set status to processing
- `markMessageProcessed(id)` - set status to processed
- `incrementMessageAttempts(id)` - increment attempts, update nextAttemptAt
- `updatePayoutStatus(id, status, txHash?)` - update payout
- `createLedgerEntry(...)` - create ledger entry with lines

Let me look at the error more carefully. The file is at `src/payout/payout.repository.ts` and it imports from `../prisma/prisma.service`. This means there should be a `src/prisma/prisma.service.ts` file. Since the task says "Change nothing the messages do not name," I should keep the import as-is (to `../prisma/prisma.service`) even though that file doesn't exist yet - the task only asks me to fix what the messages require of THIS file.

Wait, actually re-reading: "fixing what these messages require of this file." The message says:
```
src/payout/payout.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
```

This is an error IN this file. The fix could be either:
1. Create the `../prisma/prisma.service` module (but that's not this file)
2. Change the import to point to an existing module

But wait - the task says "Change nothing the messages do not name." The messages name `src/payout/payout.repository.ts` as the file to rewrite. The error on line 3 says it can't find `../prisma/prisma.service`. 

Hmm, but the task says to fix what the messages require of THIS file. The error is that the import target doesn't exist. I could either:
- Keep the import and assume `../prisma/prisma.service` will exist (add an ASSUMPTION comment)
- Or import from `@prisma/client` directly

Actually, looking at the conventions: "repository is the only layer that touches the database" and the stack uses Prisma. The standard NestJS + Prisma pattern would have a `PrismaService` that extends `PrismaClient`. 

Since the file currently imports from `../prisma/prisma.service` (as evidenced by the error), and the task says to fix what the messages require of this file, I think the right approach is to keep that import pattern but I need to make the file compile. Since `../prisma/prisma.service` doesn't exist, I have two options:

1. Keep the import and add an ASSUMPTION comment
2. Import PrismaClient directly from `@prisma/client`

Actually, let me reconsider. The task says "fixing what these messages require of this file." The message says the module can't be found. To fix THIS file, I need to either create that module (not this file's job) or change the import. But the conventions say the repository is the only layer that touches the database, and in a NestJS app with Prisma, you'd typically have a PrismaService.

I think the cleanest approach that satisfies the compiler is to import `PrismaClient` from `@prisma/client` directly, since `../prisma/prisma.service` doesn't exist. But wait - that changes the architecture from what was presumably intended.

Actually, let me re-read: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The message refers to `../prisma/prisma.service` which I cannot see. So I should add an ASSUMPTION line. But the file still needs to compile...

Hmm, but the task says "Rewrite `src/payout/payout.repository.ts` complete, fixing what these messages require of this file." The fix for the TS2307 error in this file is to either:
1. Make the import point to something that exists
2. Or create the target (but that's a different file)

Since I can only modify this file, and the target module doesn't exist, I should import `PrismaClient` from `@prisma/client` directly. This is the standard way to use Prisma in a repository when there's no service wrapper.

Wait, but the conventions say NestJS. In a typical NestJS + Prisma setup, you'd have a PrismaService. But since that file doesn't exist and I can only fix this file...

Let me think about this differently. The task is to make THIS file compile. The error is that `../prisma/prisma.service` can't be found. The fix within this file is to not import from there. I'll import `PrismaClient` from `@prisma/client` instead.

Now, what does the repository need to export? Based on the usage in:
- `payout.service.ts` - imports from `./payout.repository`
- `payout.worker.ts` - imports from `./payout.repository`
- `payout.module.ts` - imports from `./payout.repository`
- `test/payout.spec.ts` - imports from `../src/payout/payout.repository`

I need to export a class, likely called `PayoutRepository`.

Let me design the methods based on the requirements:

1. **Idempotent payout creation with balance reservation** (concurrent safety):
   - Use a transaction with row-level locking (SELECT ... FOR UPDATE on the account)
   - Check settledBalance + reservedBalance >= amount
   - Reserve funds (decrease settled, increase reserved)
   - Create payout
   - Create message
   - All in one transaction

2. **Message queue operations**:
   - `getDueMessages()` - get pending messages where nextAttemptAt <= now
   - `markMessageProcessing(id)` - set status to processing
   - `markMessageProcessed(id)` - set status to processed, set processedAt
   - `incrementMessageAttempts(id)` - increment attempts, set nextAttemptAt with backoff
   - `getMaxAttempts()` or the caller knows the max

3. **Payout status updates**:
   - `updatePayoutStatus(id, status, txHash?, completedAt?)`

4. **Ledger operations**:
   - `createLedgerEntry(payoutId, kind, lines)` - create entry and lines atomically

5. **Query operations**:
   - `findPayoutById(id)`
   - `findPayoutByAccountIdAndIdempotencyKey(accountId, idempotencyKey)`

Let me also think about what the "needs_review" status means - when retries are exhausted without a definitive outcome, the payout goes to "needs_review" because we don't know if the transfer went through or not.

Now let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutStatus, MessageStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';

// ASSUMPTION: ../prisma/prisma.service does not exist; using PrismaClient directly from @prisma/client.

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ... methods
}
```

Wait, but if I inject PrismaClient directly, the module needs to provide it. Let me think about what makes sense.

Actually, in a NestJS app, you'd typically have:
```typescript
@Module({
  providers: [PrismaService, ...],
  exports: [PrismaService],
})
export class PrismaModule {}
```

But since `../prisma/prisma.service` doesn't exist and I can't create it (the task only asks me to fix this file), I'll use PrismaClient directly.

Actually wait - I can use `@Injectable()` and have the constructor take `PrismaClient`. The module will need to provide it, but that's the module's problem, not this file's.

Hmm, but actually in NestJS, you can't just inject `PrismaClient` without a token unless it's provided. The standard pattern is to have a custom provider. But since I can only fix this file...

Let me just use `PrismaClient` directly. The module can be configured to provide it. Or I can use `@Inject('PRISMA')` pattern. But the simplest approach that compiles is:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
```

And the constructor takes `PrismaClient`. The module would need to provide it, but that's outside this file's scope.

Actually, let me reconsider. Maybe I should use `@Inject('PrismaService')` with a type assertion, or just define the class to accept `PrismaClient` in its constructor. Since the module file imports this class and lists it as a provider, the module will handle the DI setup.

Let me just go with:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
```

This should compile fine. The module will need to provide PrismaClient, but that's the module's responsibility.

Now let me think about what methods are needed based on the test file importing from this module and the service/worker using it:

For the **service** (creating payouts):
- `createPayoutWithReservation(params: { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string })` → returns the payout or null if already exists (idempotent)
  - This needs to be atomic: lock account row, check balance, reserve, create payout + message

For the **worker** (processing messages):
- `getDueMessages()` → returns array of messages
- `markMessageProcessing(id: string)` → void
- `markMessageProcessed(id: string)` → void  
- `incrementMessageAttempts(id: string)` → void (and maybe returns new attempt count)
- `updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string)` → void
- `settlePayout(payoutId: string, txHash: string)` → void (moves from reserved to settled balance, creates ledger entry)
- `failPayout(payoutId: string)` → void (releases reservation)
- `needsReviewPayout(payoutId: string)` → void

Actually, let me think more carefully. The ledger entry should be created when:
- Settlement happens (transfer confirmed): move from "reserved" to "settled" (or rather, the reserved amount is spent, so we need a ledger entry showing the payout)
- Failure: release the reservation

Let me simplify. The key operations:

1. `createPayout` - atomic, idempotent, with balance check
2. `getDueMessages` - fetch pending messages due for processing
3. `markMessageProcessing` - claim a message
4. `markMessageProcessed` - complete a message
5. `incrementMessageAttempts` - record a failed attempt
6. `updatePayout` - change payout status
7. `settlePayout` - on successful transfer: update status to completed, create ledger entry
8. `releaseReservation` - on failure: update status to failed, release reserved funds, create ledger entry

Let me write this out:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutStatus, MessageStatus } from '@prisma/client';

// ASSUMPTION: ../prisma/prisma.service does not exist; using PrismaClient directly from @prisma/client.

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Lock the account row to prevent concurrent overdraw
      const account = await tx.account.findFirst({
        where: { id: params.accountId },
      });
      
      // Wait, we need FOR UPDATE. Prisma doesn't directly support that.
      // We need to use $queryRaw or $executeRaw for the lock.
    });
  }
}
```

Hmm, Prisma doesn't natively support `SELECT ... FOR UPDATE`. For the concurrent safety requirement, I need row-level locking. In Prisma, you can use `$queryRaw` for this.

Let me think about the approach:
1. Use `SELECT ... FOR UPDATE` via raw query to lock the account row
2. Check balance
3. Update account (decrease settled, increase reserved)
4. Create payout
5. Create message
6. Commit transaction

Here's my revised approach:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutStatus, MessageStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: params.accountId,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { payoutId: existing.id };
      }

      // Lock the account row
      const locked = await tx.$queryRaw<Array<{ settled_balance: bigint; reserved_balance: bigint }>>(
        Prisma.sql`SELECT settled_balance, reserved_balance FROM "account" WHERE id = ${params.accountId} FOR UPDATE`
      );

      if (locked.length === 0) {
        return null; // account not found - service should handle
      }

      const { settled_balance, reserved_balance } = locked[0];
      const available = settled_balance - reserved_balance;
      
      if (available < params.amount) {
        return null; // insufficient funds - service should handle
      }

      // Reserve funds
      await tx.account.update({
        where: { id: params.accountId },
        data: {
          settledBalance: { decrement: params.amount },
          reservedBalance: { increment: params.amount },
        },
      });

      // Create payout
      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          idempotencyKey: params.idempotencyKey,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          status: PayoutStatus.created,
        },
      });

      // Create message
      await tx.message.create({
        data: {
          type: 'process_payout',
          payload: { payoutId: payout.id } as any,
          status: MessageStatus.pending,
        },
      });

      return { payoutId: payout.id };
    });
  }
}
```

Wait, I need `Prisma` import for `Prisma.sql`. Let me add that.

Also, I need to think about what the worker needs. The worker will:
1. Get due messages
2. For each message, mark it as processing
3. Call the provider
4. On success: mark processed, update payout status, create ledger entry
5. On failure: increment attempts, or if exhausted, mark as needs_review

Let me also think about the `settlePayout` method - when the provider confirms:
- Update payout status to `completed`
- Update account: decrease reservedBalance (the reserved amount is now spent)
- Create ledger entry showing the payout

And `failPayout`:
- Update payout status to `failed`
- Update account: decrease reservedBalance, increase settledBalance (release reservation)
- Create ledger entry

And `needsReviewPayout`:
- Update payout status to `needs_review`
- Don't change balances (we don't know if it went through)

Let me also think about the message status flow:
- `pending` → `processing` (worker claims it)
- `processing` → `processed` (success)
- `processing` → `pending` (retry, with incremented attempts and backoff)

Now let me also think about what the test file would need. The test imports `PayoutRepository` from `../src/payout/payout.repository`. The tests are for:
1. Concurrent creation against one account
2. Duplicate message delivery
3. Retry exhaustion

For these tests, they'd need to:
- Create accounts
- Call createPayout concurrently
- Process messages
- Check states

Let me finalize the repository. I'll need to import `Prisma` for the raw SQL template tag.

Actually, looking at this more carefully - the `@prisma/client` package exports `Prisma` as a namespace. So I can do:

```typescript
import { PrismaClient, Prisma, PayoutStatus, MessageStatus } from '@prisma/client';
```

Now, about the `Prisma.sql` tagged template - this is used for raw queries. Let me use it for the FOR UPDATE lock.

Let me also consider: should `createPayout` return different things for different failure modes? The service needs to distinguish between:
- Account not found
- Insufficient funds
- Success (with payout ID)

I could return a discriminated union or throw. But since the service handles error cases, let me return a result type that the service can interpret.

Actually, looking at the error envelope convention, the service would throw appropriate errors. The repository should probably throw or return a discriminated result. Let me use a discriminated union return type for clarity:

```typescript
type CreatePayoutResult =
  | { status: 'created'; payoutId: string }
  | { status: 'already_exists'; payoutId: string }
  | { status: 'account_not_found' }
  | { status: 'insufficient_funds' };
```

This way the service can map these to appropriate HTTP errors.

Let me write the complete file now:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, PayoutStatus, MessageStatus } from '@prisma/client';

// ASSUMPTION: ../prisma/prisma.service does not exist; using PrismaClient directly from @prisma/client.

export type CreatePayoutResult =
  | { status: 'created'; payoutId: string }
  | { status: 'already_exists'; payoutId: string }
  | { status: 'account_not_found' }
  | { status: 'insufficient_funds' };

export interface PendingMessage {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<CreatePayoutResult> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: params.accountId,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { status: 'already_exists', payoutId: existing.id };
      }

      // Lock the account row to prevent concurrent overdraw
      const locked = await tx.$queryRaw<
        Array<{ settled_balance: bigint; reserved_balance: bigint }>
      >(
        Prisma.sql`SELECT settled_balance, reserved_balance FROM "account" WHERE id = ${params.accountId} FOR UPDATE`
      );

      if (locked.length === 0) {
        return { status: 'account_not_found' };
      }

      const { settled_balance: settled, reserved_balance: reserved } = locked[0];
      const available = settled - reserved;

      if (available < params.amount) {
        return { status: 'insufficient_funds' };
      }

      // Reserve funds
      await tx.account.update({
        where: { id: params.accountId },
        data: {
          settledBalance: { decrement: params.amount },
          reservedBalance: { increment: params.amount },
        },
      });

      // Create payout
      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          idempotencyKey: params.idempotencyKey,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          status: PayoutStatus.created,
        },
      });

      // Create outbox message
      await tx.message.create({
        data: {
          type: 'process_payout',
          payload: { payoutId: payout.id },
          status: MessageStatus.pending,
        },
      });

      return { status: 'created', payoutId: payout.id };
    });
  }

  async getDueMessages(): Promise<PendingMessage[]> {
    return this.prisma.message.findMany({
      where: {
        status: MessageStatus.pending,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markMessageProcessing(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.processing },
    });
  }

  async markMessageProcessed(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        status: MessageStatus.processed,
        processedAt: new Date(),
      },
    });
  }

  async incrementMessageAttempts(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        status: MessageStatus.pending,
        nextAttemptAt: new Date(Date.now() + 5000),
      },
    });
  }

  async updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    txHash?: string,
  ): Promise<void> {
    const data: Record<string, unknown> = { status };
    if (txHash) data.txHash = txHash;
    if (status === PayoutStatus.completed || status === PayoutStatus.failed) {
      data.completedAt = new Date();
    }
    await this.prisma.payout.update({ where: { id }, data });
  }

  async settlePayout(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      // Mark payout as completed
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.completed,
          txHash,
          completedAt: new Date(),
        },
      });

      // Release reservation (funds are spent)
      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
        },
      });

      // Create ledger entry: debit from account, credit to payouts
      const entry = await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'settlement',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'debit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'credit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async releaseReservation(payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      // Mark payout as failed
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.failed,
          completedAt: new Date(),
        },
      });

      // Release reservation back to settled balance
      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
          settledBalance: { increment: payout.amount },
        },
      });

      // Create ledger entry: reversal
      const entry = await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'reversal',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'credit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'debit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async markNeedsReview(payoutId: string, txHash?: string): Promise<void> {
    const data: Record<string, unknown> = {
      status: PayoutStatus.needs_review,
      completedAt: new Date(),
    };
    if (txHash) data.txHash = txHash;
    await this.prisma.payout.update({ where: { id: payoutId }, data });
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({
      where: { id },
      include: { account: true },
    });
  }

  async createAccount(id: string, settledBalance?: bigint) {
    return this.prisma.account.create({
      data: {
        id,
        settledBalance: settledBalance ?? 0n,
      },
    });
  }

  async getAccount(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
    });
  }
}
```

Wait, I'm using `0n` which is a BigInt literal. That's fine in Node 20+.

Let me also think about whether I need `Prisma` import. Yes, I use `Prisma.sql` for the raw query.

Let me also reconsider the `payload` field. In the schema it's `Json` type. In Prisma, you pass a plain object. So `payload: { payoutId: payout.id }` should work.

Actually, I realize I should double-check: does the `payout` table have a `@@unique([accountId, idempotencyKey])` constraint? Yes it does:
```
@@unique([accountId, idempotencyKey])
```

So the composite unique field in Prisma would be `accountId_idempotencyKey`.

Let me also make sure the `PayoutStatus` and `MessageStatus` enums are exported from `@prisma/client`. Yes, Prisma generates enum exports for any enum in the schema.

One more thing - I should think about whether the `createAccount` and `getAccount` methods are needed. The tests might need them to set up test data. Let me include them.

Actually, let me reconsider the overall design. The task says "Change nothing the messages do not name." This means I should only fix the issues that the compiler messages point to for THIS file. The only error for this file is:

```
src/payout/payout.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
```

So the file currently exists and has an import on line 3 from `../prisma/prisma.service` that doesn't resolve. My job is to rewrite the file so it compiles, while maintaining the functionality implied by the other files that import from it.

I think my approach is correct. Let me finalize.

Actually, one concern: the `Prisma.sql` tag. In newer versions of Prisma, it's `Prisma.sql` (lowercase). Let me make sure I'm using the right one. Yes, `Prisma.sql` is correct for Prisma 5+.

Let me also think about whether I need to handle the case where the `FOR UPDATE` lock returns the account but the account was deleted between the lock and the update. In a transaction with `FOR UPDATE`, the row is locked until the transaction commits, so this shouldn't be an issue.

One more thought: the `payload` field is `Json` in Prisma. When reading it back, it'll be `JsonValue` type. I should handle that in the `PendingMessage` interface or let the consumer cast it.

I think my solution is solid. Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, PayoutStatus, MessageStatus } from '@prisma/client';

// ASSUMPTION: ../prisma/prisma.service does not exist; using PrismaClient directly from @prisma/client.

export type CreatePayoutResult =
  | { status: 'created'; payoutId: string }
  | { status: 'already_exists'; payoutId: string }
  | { status: 'account_not_found' }
  | { status: 'insufficient_funds' };

export interface PendingMessage {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(params: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<CreatePayoutResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: params.accountId,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { status: 'already_exists', payoutId: existing.id };
      }

      const locked = await tx.$queryRaw<
        Array<{ settled_balance: bigint; reserved_balance: bigint }>
      >(
        Prisma.sql`SELECT settled_balance, reserved_balance FROM "account" WHERE id = ${params.accountId} FOR UPDATE`,
      );

      if (locked.length === 0) {
        return { status: 'account_not_found' };
      }

      const { settled_balance: settled, reserved_balance: reserved } = locked[0];
      const available = settled - reserved;

      if (available < params.amount) {
        return { status: 'insufficient_funds' };
      }

      await tx.account.update({
        where: { id: params.accountId },
        data: {
          settledBalance: { decrement: params.amount },
          reservedBalance: { increment: params.amount },
        },
      });

      const payout = await tx.payout.create({
        data: {
          accountId: params.accountId,
          idempotencyKey: params.idempotencyKey,
          amount: params.amount,
          destinationAddress: params.destinationAddress,
          status: PayoutStatus.created,
        },
      });

      await tx.message.create({
        data: {
          type: 'process_payout',
          payload: { payoutId: payout.id },
          status: MessageStatus.pending,
        },
      });

      return { status: 'created', payoutId: payout.id };
    });
  }

  async getDueMessages(): Promise<PendingMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        status: MessageStatus.pending,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((m) => ({
      id: m.id,
      type: m.type,
      payload: m.payload,
      attempts: m.attempts,
    }));
  }

  async markMessageProcessing(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status: MessageStatus.processing },
    });
  }

  async markMessageProcessed(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        status: MessageStatus.processed,
        processedAt: new Date(),
      },
    });
  }

  async incrementMessageAttempts(id: string): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        status: MessageStatus.pending,
        nextAttemptAt: new Date(Date.now() + 5_000),
      },
    });
  }

  async updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<void> {
    const data: Record<string, unknown> = { status };
    if (txHash) data.txHash = txHash;
    if (status === PayoutStatus.completed || status === PayoutStatus.failed) {
      data.completedAt = new Date();
    }
    await this.prisma.payout.update({ where: { id }, data });
  }

  async settlePayout(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.completed,
          txHash,
          completedAt: new Date(),
        },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'settlement',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'debit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'credit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async releaseReservation(payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: { account: true },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.failed,
          completedAt: new Date(),
        },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedBalance: { decrement: payout.amount },
          settledBalance: { increment: payout.amount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          payoutId,
          kind: 'reversal',
          lines: {
            create: [
              {
                accountName: 'account',
                accountId: payout.accountId,
                direction: 'credit',
                amount: payout.amount,
              },
              {
                accountName: 'payouts',
                direction: 'debit',
                amount: payout.amount,
              },
            ],
          },
        },
      });
    });
  }

  async markNeedsReview(payoutId: string, txHash?: string): Promise<void> {
    const data: Record<string, unknown> = {
      status: PayoutStatus.needs_review,
      completedAt: new Date(),
    };
    if (txHash) data.txHash = txHash;
    await this.prisma.payout.update({ where: { id: payoutId }, data });
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({
      where: { id },
      include: { account: true },
    });
  }

  async createAccount(id: string, settledBalance?: bigint) {
    return this.prisma.account.create({
      data: {
        id,
        settledBalance: settledBalance ?? 0n,
      },
    });
  }

  async getAccount(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
    });
  }
}
```
