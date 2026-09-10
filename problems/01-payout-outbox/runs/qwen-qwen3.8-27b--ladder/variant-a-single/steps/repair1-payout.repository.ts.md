# repair1-payout.repository.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/payout/payout.repository.ts`:

1. `src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service'`
2. `src/payout/payout.repository.ts(5,62): error TS2307: Cannot find module './payout.errors'`
3. `src/payout/payout.repository.ts(6,51): error TS2307: Cannot find module './payout.types'`
4. `src/payout/payout.repository.ts(7,42): error TS2307: Cannot find module './payout.types'`
5. `src/payout/payout.repository.ts(15,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
6. `src/payout/payout.repository.ts(51,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
7. `src/payout/payout.repository.ts(187,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
8. `src/payout/payout.repository.ts(228,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
9. `src/payout/payout.repository.ts(250,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`

The TS2307 errors mean the modules `../prisma/prisma.service`, `./payout.errors`, and `./payout.types` don't exist. But the task says "Change nothing the messages do not name." So I need to keep these imports but the modules don't exist yet. Wait, the task says to rewrite `src/payout/payout.repository.ts` fixing what these messages require of this file.

The TS2307 errors for other files (like `payout.module.ts`, `payout.service.ts`, etc.) are about those files not being able to find their dependencies - those aren't my problem to fix. My problem is only `src/payout/payout.repository.ts`.

For `src/payout/payout.repository.ts`, the errors are:
- Missing modules: `../prisma/prisma.service`, `./payout.errors`, `./payout.types`
- Implicit `any` on `tx` parameter at lines 15, 51, 187, 228, 250

The TS2307 errors are about modules that don't exist yet. The task says to fix what the messages require of THIS file. Since I can't create other files (the task says "Change nothing the messages do not name"), I need to keep the imports as-is. But wait - if the modules don't exist, the import will always fail. 

Actually, re-reading the task: "Rewrite `src/payout/payout.repository.ts` complete, fixing what these messages require of this file."

The messages that pertain to this file are:
1. TS2307 for `../prisma/prisma.service` - module doesn't exist
2. TS2307 for `./payout.errors` - module doesn't exist
3. TS2307 for `./payout.types` - module doesn't exist (twice)
4. TS7006 for `tx` parameter (5 times)

For the TS2307 errors, since the modules don't exist, I can't fix them from within this file unless I remove the imports. But removing imports would break the file's functionality. The task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So I should keep the imports (they reference modules that are expected to exist) and add `// ASSUMPTION:` comments for the shapes I can't see.

For the TS7006 errors, I need to add explicit types to the `tx` parameter. In Prisma, `tx` in a transaction callback is `Prisma.TransactionClient`. So I need to type it properly.

Let me think about what this repository file needs to do based on the variant requirements:

1. Create a payout with idempotency check (prevent duplicate idempotencyKey)
2. Reserve funds (decrease available balance) - must be atomic to prevent overdraft
3. Create an outbox message for async processing
4. Update payout status through its lifecycle
5. Ledger entries (double-entry)
6. Update message status for retry tracking

Let me design the repository:

```typescript
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientFundsError, PayoutNotFoundError } from './payout.errors';
import { CreatePayoutInput, PayoutStatus } from './payout.types';
// and another import from './payout.types'

export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Create payout with idempotency check and fund reservation
  async createPayout(input: CreatePayoutInput): Promise<...> {
    return this.prisma.$transaction(async (tx) => {
      // Check idempotency
      // Check and reserve funds
      // Create payout record
      // Create ledger entries
      // Create outbox message
    });
  }

  // Get pending messages
  async getPendingMessages(): Promise<...> { ... }

  // Mark message as processing
  async markMessageProcessing(id: string): Promise<void> { ... }

  // Complete message
  async completeMessage(id: string, txHash: string): Promise<void> { ... }

  // Fail message (increment retry, or mark failed)
  async failMessage(id: string, error: string): Promise<void> { ... }
}
```

Now for the `tx` type - in Prisma, the transaction client type is `Prisma.TransactionClient`. I need to import `Prisma` from `@prisma/client`.

Wait, but the error says "Parameter 'tx' implicitly has an 'any' type" - this means in the original code, the `tx` parameter in the `$transaction` callback wasn't typed. I need to add the type annotation.

The proper way is:
```typescript
import { Prisma } from '@prisma/client';

async createPayout(input: CreatePayoutInput): Promise<...> {
  return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    ...
  });
}
```

Now, since I can't see the actual types in `payout.types`, I'll need to make assumptions about what's exported from there. Let me think about what would be needed:

From the variant:
- `CreatePayoutInput` - the input for creating a payout (accountId, amount, destinationAddress, idempotencyKey)
- `PayoutStatus` - the enum for payout lifecycle
- Possibly a `Payout` type or `OutboxMessage` type

Let me also think about what `payout.errors` would export:
- `InsufficientFundsError` - when account doesn't have enough funds
- Maybe `DuplicatePayoutError` or similar

Since I can't see these files, I'll add `// ASSUMPTION:` comments.

Let me write the complete file now. I need to be careful about:
1. The imports must reference `../prisma/prisma.service`, `./payout.errors`, `./payout.types` (two imports from types)
2. The `tx` parameter must be explicitly typed
3. The logic must implement the funds-safety approach (atomic balance check + reservation)
4. Idempotency must be handled
5. Double-entry ledger
6. Outbox message creation
7. Retry tracking

Let me think about the Prisma schema based on the requirements:

Tables:
- `accounts` - has `settled_balance` (or similar), and we need an `available_balance` or we compute it
- `payouts` - id, account_id, amount, destination_address, idempotency_key, status, tx_hash, created_at, updated_at
- `outbox_messages` - id, payout_id, status, retries, last_error, created_at, updated_at
- `ledger_entries` - id, account_id, amount, type (debit/credit), reference, created_at

Actually, for the balance to be safe against concurrent requests, we need:
- A `reserved_balance` on the account, or
- A `available_balance` that we atomically decrement

The safest approach is to use a conditional update:
```sql
UPDATE accounts SET reserved_balance = reserved_balance + $amount 
WHERE id = $id AND (settled_balance - reserved_balance) >= $amount
```

In Prisma, this would be:
```typescript
const result = await tx.account.updateMany({
  where: { id: accountId, availableBalance: { gte: amount } },
  // or compute available as settled - reserved
  data: { reservedBalance: { increment: amount } }
});
if (result.count === 0) throw new InsufficientFundsError();
```

Actually, let me think more carefully. The double-entry ledger approach means:
- When a payout is created: we move funds from "available" to "in-transit" (reserved)
- When the transfer is confirmed: we move funds from "in-transit" to "settled out" (decrease settled balance)

So the account could have:
- `settled_balance` - confirmed balance
- `reserved_balance` - funds reserved for in-flight payouts

Available = settled_balance - reserved_balance

For the conditional update to prevent overdraft:
```typescript
const updated = await tx.account.updateMany({
  where: {
    id: accountId,
    AND: [
      { settledBalance: { gte: amount } }  // not quite right, need to compare available
    ]
  },
  data: { reservedBalance: { increment: amount } }
});
```

Hmm, Prisma's `updateMany` doesn't easily support computed conditions like `settledBalance - reservedBalance >= amount`. 

One approach: use `$queryRaw` for the conditional update. But the convention says "Zero raw SQL" in service layer, but repository CAN use raw SQL since it's the only layer that touches the database.

Actually wait, re-reading: "repository is the only layer that touches the database" - this means the repository CAN use raw SQL. The prohibition is on the service layer.

So I can use `prisma.$queryRaw` or `tx.$queryRaw` for the conditional balance update.

Let me write this out:

```typescript
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientFundsError } from './payout.errors';
import { CreatePayoutInput } from './payout.types';
import { PayoutStatus } from './payout.types';

export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayout(input: CreatePayoutInput): Promise<{ payoutId: string; alreadyCreated: boolean }> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Idempotency check
      const existing = await tx.payout.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return { payoutId: existing.id, alreadyCreated: true };
      }

      // Atomic balance check and reservation
      const result = await tx.$executeRaw`
        UPDATE accounts
        SET reserved_balance = reserved_balance + ${input.amount}
        WHERE id = ${input.accountId}
          AND (settled_balance - reserved_balance) >= ${input.amount}
      `;

      if (result === 0) {
        throw new InsufficientFundsError();
      }

      // Create payout
      const payout = await tx.payout.create({
        data: {
          id: crypto.randomUUID(), // or use prisma's id generation
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'created' as PayoutStatus,
        },
      });

      // Ledger entry: reserve
      await tx.ledgerEntry.create({
        data: {
          id: crypto.randomUUID(),
          accountId: input.accountId,
          amount: input.amount,
          type: 'debit',
          reference: payout.id,
          description: 'Payout reservation',
        },
      });

      // Outbox message
      await tx.outboxMessage.create({
        data: {
          id: crypto.randomUUID(),
          payoutId: payout.id,
          status: 'pending',
          retries: 0,
        },
      });

      return { payoutId: payout.id, alreadyCreated: false };
    });
  }

  async findPendingMessages(limit: number) {
    return this.prisma.outboxMessage.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markProcessing(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'processing' },
    });
  }

  async completeMessage(messageId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.outboxMessage.findUnique({ where: { id: messageId } });
      if (!message) return;

      const payout = await tx.payout.findUnique({ where: { id: message.payoutId } });
      if (!payout) return;

      // Only transition if still processing
      const updated = await tx.payout.updateMany({
        where: { id: payout.id, status: 'processing' },
        data: { status: 'completed', txHash },
      });

      if (updated.count > 0) {
        // Ledger entry: settle
        await tx.ledgerEntry.create({
          data: {
            id: crypto.randomUUID(),
            accountId: payout.accountId,
            amount: payout.amount,
            type: 'credit',
            reference: payout.id,
            description: 'Payout settled',
          },
        });

        // Decrease settled balance and reserved balance
        await tx.$executeRaw`
          UPDATE accounts
          SET settled_balance = settled_balance - ${payout.amount},
              reserved_balance = reserved_balance - ${payout.amount}
          WHERE id = ${payout.accountId}
        `;
      }

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'completed' },
      });
    });
  }

  async failMessage(messageId: string, error: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.outboxMessage.findUnique({ where: { id: messageId } });
      if (!message) return;

      const newRetries = message.retries + 1;
      const MAX_RETRIES = 3;

      if (newRetries >= MAX_RETRIES) {
        // Exhausted - mark as needs-review, release reservation
        const payout = await tx.payout.findUnique({ where: { id: message.payoutId } });
        if (payout) {
          await tx.payout.updateMany({
            where: { id: payout.id, status: 'processing' },
            data: { status: 'needs-review' },
          });

          // Release the reservation (funds go back to available)
          await tx.$executeRaw`
            UPDATE accounts
            SET reserved_balance = reserved_balance - ${payout.amount}
            WHERE id = ${payout.accountId}
          `;

          // Ledger entry: release
          await tx.ledgerEntry.create({
            data: {
              id: crypto.randomUUID(),
              accountId: payout.accountId,
              amount: payout.amount,
              type: 'credit',
              reference: payout.id,
              description: 'Payout reservation released (retry exhausted)',
            },
          });
        }

        await tx.outboxMessage.update({
          where: { id: messageId },
          data: { status: 'failed', lastError: error, retries: newRetries },
        });
      } else {
        await tx.outboxMessage.update({
          where: { id: messageId },
          data: { status: 'pending', lastError: error, retries: newRetries },
        });
      }
    });
  }

  async markPayoutProcessing(payoutId: string): Promise<void> {
    await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'created' },
      data: { status: 'processing' },
    });
  }
}
```

Wait, I need to reconsider. The errors say:
- Line 4: import from `../prisma/prisma.service`
- Line 5: import from `./payout.errors` (column 62 suggests a named import)
- Line 6: import from `./payout.types` (column 51)
- Line 7: import from `./payout.types` (column 42)

So there are two separate imports from `./payout.types`. Let me keep that structure.

Also, I need to think about what `Prisma.TransactionClient` requires. I need to import `Prisma` from `@prisma/client`.

But wait - will that cause a new error? The task says "Change nothing the messages do not name." Adding an import for `@prisma/client` is necessary to fix the TS7006 errors. The `@prisma/client` package should be installed since Prisma is part of the stack. So this should be fine.

Let me also think about whether I should use `crypto.randomUUID()` or let Prisma handle ID generation. Since I don't know the schema exactly, I'll assume the schema uses `@id @default(uuid
```

## reply

I need to examine the existing repository file and its dependencies to understand the required structure before rewriting it.

<tool_call>
<function=Read>
<parameter=file_path>
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/variants/variant-a/src/payout/payout.repository.ts
</parameter>
</function>
</tool_call>
<tool_call>
<function=Glob>
<parameter=pattern>
src/payout/**
</parameter>
</function>
</tool_call>
<tool_call>
<function=Glob>
<parameter=pattern>
src/prisma/**
</parameter>
</function>
</tool_call>
