# 08-outbox.repository.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/outbox/outbox.repository.ts` should contain.

From the plan:

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

From the data model:
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

Now, I need to think about what Prisma model name this would be. Looking at the conventions:
- Table and column: `snake_case` (via Prisma `@map`/`@@map`)
- So the Prisma model would be `OutboxMessage` with `@@map("outbox_messages")`

The plan says "All Prisma access for outbox_messages" - so this repository only touches `outbox_messages`.

Now let me think about the implementation:

1. `claimPending(limit: number)` - This needs to:
   - SELECT messages WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at FOR UPDATE SKIP LOCKED
   - Mark them as 'processing'
   - Return claimed rows

   The problem is that Prisma doesn't natively support `FOR UPDATE SKIP LOCKED`. This would require using `$queryRaw` or a raw SQL approach within a transaction. Let me think about this...

   Actually, looking at the conventions: "repository is the only layer that touches the database." And the plan says "zero raw SQL" for the service layer, but the repository can use Prisma. However, `FOR UPDATE SKIP LOCKED` is not directly supported by Prisma's query builder.

   The most defensible approach would be to use `prisma.$transaction` with a raw query for the SELECT FOR UPDATE SKIP LOCKED, then use Prisma's update for marking them as processing. Or use `$queryRaw` for the SELECT and `$executeRaw` or Prisma update for the UPDATE.

   Actually, let me reconsider. The plan says the service has "zero raw SQL, zero Prisma client calls" but the repository is "the only layer that touches the database." It doesn't explicitly say the repository can't use raw SQL. In fact, for `FOR UPDATE SKIP LOCKED`, it's the standard approach in Prisma to use `$queryRaw` or `$transaction` with raw queries.

   Let me write this using `prisma.$transaction` with a combination of `$queryRaw` for the SELECT FOR UPDATE SKIP LOCKED and then updating the status.

   Actually, a cleaner approach: use `prisma.$transaction(async (tx) => { ... })` where inside we use `$queryRaw` for the SELECT FOR UPDATE SKIP LOCKED, then `$executeRaw` or `tx.outboxMessage.updateMany` for the UPDATE.

   Wait, but I need to be careful. Let me think about what `OutboxMessageRow` would be. The plan references it but doesn't explicitly define it in a types file for outbox. Looking at the manifest:
   - `src/outbox/outbox.repository.ts | reads: -` - it doesn't read from any other file!

   So I need to define the row type inline or import it. But the plan says this file reads nothing... Hmm, but it needs to reference the Prisma model type or define its own interface.

   Actually, looking more carefully at the plan, `OutboxMessageRow` is used in the return type of `claimPending`. Since the file "reads: -" (no dependencies), I should define this type inline in the repository file, or use Prisma's generated types.

   Wait - actually, the Prisma client would generate types. So I could use `Prisma.OutboxMessageGetPayload` or just the generated model type. But since we're using `FOR UPDATE SKIP LOCKED` which requires raw queries, the return type would be from a raw query.

   Let me define an interface `OutboxMessageRow` in this file since the plan says this file reads nothing.

   Actually, looking at the payout repository pattern from the plan:
   - `src/payout/payout.repository.ts | reads: src/payout/payout.types.ts`

   So payout repository reads from types. But outbox repository reads nothing. This suggests the outbox repository is self-contained with its own type definitions.

   Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxMessageRow[]>`
        SELECT id, payout_id AS "payoutId", payload, status, attempts,
               next_attempt_at AS "nextAttemptAt", last_error AS "lastError",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return rows;

      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE outbox_messages
        SET status = 'processing', updated_at = NOW()
        WHERE id IN (${tx.$queryRaw`SELECT ... `}) // hmm this is getting complicated
      `;

      return rows.map((r) => ({ ...r, status: 'processing' }));
    });
  }
}
```

Hmm, the `IN (...)` with dynamic values in Prisma raw queries is tricky. Let me use a different approach.

Actually, I can use `tx.$executeRaw` with an array parameter:

```typescript
await tx.$executeRaw`
  UPDATE outbox_messages
  SET status = 'processing', updated_at = NOW()
  WHERE id = ANY(${ids})
`;
```

This should work with Prisma's tagged template literal for arrays.

Let me also think about `markDone` and `recordAttempt`:

```typescript
async markDone(messageId: string): Promise<void> {
  await this.prisma.$executeRaw`
    UPDATE outbox_messages
    SET status = 'done', updated_at = NOW()
    WHERE id = ${messageId} AND status != 'done'
  `;
}

async recordAttempt(messageId: string, attempts: number, nextAttemptAt: Date | null, lastError?: string): Promise<void> {
  await this.prisma.$executeRaw`
    UPDATE outbox_messages
    SET attempts = ${attempts},
        next_attempt_at = ${nextAttemptAt},
        last_error = ${lastError ?? null},
        status = 'pending',
        updated_at = NOW()
    WHERE id = ${messageId}
  `;
}
```

Wait, for `recordAttempt`, the plan says "Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error." And looking at the worker flow:

```
ON ERROR:
  attempts = message.attempts + 1
  IF attempts >= MAX_ATTEMPTS (3):
    payoutRepo.updatePayout(payout.id, 'needs_review')
    outboxRepo.markDone(message.id)
  ELSE:
    outboxRepo.recordAttempt(message.id, attempts, null, errorMsg)
    -- next_attempt_at stays NULL; message eligible on next tick
```

So `recordAttempt` is called when we want to retry. It sets the status back to 'pending' (so it can be picked up again), increments attempts, and optionally sets next_attempt_at and last_error.

Actually wait - the message was already set to 'processing' by `claimPending`. So when we record an attempt (meaning we'll retry), we need to set it back to 'pending'. That makes sense.

Let me also think about whether I should use Prisma's typed client or raw SQL. Since `FOR UPDATE SKIP LOCKED` isn't supported by Prisma's query builder, I'll use raw SQL throughout for consistency. But actually, for `markDone` and `recordAttempt`, I could use Prisma's update methods since they don't need row locking.

Let me reconsider. The plan says the repository is "the only layer that touches the database." It doesn't prohibit raw SQL in the repository - that prohibition is for the service layer. Using `$queryRaw`/`$executeRaw` in the repository is perfectly fine and necessary for `FOR UPDATE SKIP LOCKED`.

Let me also think about the Prisma model name. With `@@map("outbox_messages")`, the Prisma model would be `OutboxMessage`. But since I'm using raw SQL, I don't strictly need to reference the Prisma model name.

Now, about `PrismaService` - where does it come from? Looking at the layout:
```
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
```

There's no explicit `src/prisma/prisma.service.ts` in the layout, but it's a standard NestJS+Prisma pattern. The plan's manifest shows `src/outbox/outbox.repository.ts | reads: -` which means it doesn't import from other project files. But it needs `PrismaService`. 

Hmm, this is a contradiction. The repository needs `PrismaService` to work, but the manifest says it reads nothing. Let me re-read...

Actually, I think "reads: -" in the manifest might mean it doesn't read from other files in terms of business logic/types - it's self-contained. But it still needs the Prisma service injection. Every repository in a NestJS+Prisma app needs the Prisma client/service.

I'll import `PrismaService` from a standard location. Since the plan doesn't specify where it lives, I'll use `../prisma/prisma.service` which is the most common convention.

Wait, actually let me reconsider. The manifest says `reads: -` for the outbox repository. But the payout repository says `reads: src/payout/payout.types.ts`. The difference is that payout.repository needs types from the types file, while outbox.repository doesn't need external types (it defines its own row type). But both would need PrismaService.

I think the "reads" field in the manifest refers to project-specific file dependencies for types/business logic, not infrastructure imports like PrismaService. I'll go with importing PrismaService.

Let me finalize my implementation:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxMessageRow[]>`
        SELECT
          id,
          payout_id   AS "payoutId",
          payload,
          status,
          attempts,
          next_attempt_at AS "nextAttemptAt",
          last_error    AS "lastError",
          created_at    AS "createdAt",
          updated_at    AS "updatedAt"
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return rows;
      }

      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE outbox_messages
        SET status = 'processing', updated_at = NOW()
        WHERE id = ANY(${ids})
      `;

      return rows.map((r) => ({ ...r, status: 'processing' as const }));
    });
  }

  async markDone(messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_messages
      SET status = 'done', updated_at = NOW()
      WHERE id = ${messageId} AND status <> 'done'
    `;
  }

  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_messages
      SET attempts        = ${attempts},
          next_attempt_at = ${nextAttemptAt},
          last_error      = ${lastError ?? null},
          status          = 'pending',
          updated_at      = NOW()
      WHERE id = ${messageId}
    `;
  }
}
```

Wait, I need to double-check: the plan says `recordAttempt` should "Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error." The parameter is `attempts: number` - this is the NEW value of attempts (already incremented by the caller). So I just SET it to that value.

Also, looking at the worker flow again:
```
ELSE:
  outboxRepo.recordAttempt(message.id, attempts, null, errorMsg)
  -- next_attempt_at stays NULL; message eligible on next tick
```

So when retrying (not exhausted), nextAttemptAt is null and the message goes back to 'pending' so it can be claimed again on the next tick.

I think my implementation is correct. Let me also make sure the `status` type in the row matches what's expected. The plan defines `OutboxStatus = 'pending' | 'processing' | 'done'` in `payout.types.ts`, but since this file doesn't import from there (manifest says reads: -), I'll just use `string` for the status in the interface, or I could define a local type.

Actually, to keep it simple and match the plan's signature which just says `Promise<OutboxMessageRow[]>`, I'll keep status as a string in the interface. The worker will check the value.

One more thought: should I use `Prisma.TransactionClient` type for the `tx` parameter? In Prisma, `$transaction` callback receives a `Prisma.TransactionClient`. Let me use that for type safety.

Actually, with the tagged template literal approach in Prisma 5+, `tx.$queryRaw` and `tx.$executeRaw` are available on the transaction client. Let me just let TypeScript infer the type from `$transaction`.

Let me also reconsider whether to use `PrismaService` or directly `PrismaClient`. In NestJS with Prisma, the standard pattern is to have a `PrismaService extends PrismaClient` that's provided in a module. I'll go with `PrismaService`.

I'm satisfied with my implementation. Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxMessageRow[]>`
        SELECT
          id,
          payout_id       AS "payoutId",
          payload,
          status,
          attempts,
          next_attempt_at AS "nextAttemptAt",
          last_error      AS "lastError",
          created_at      AS "createdAt",
          updated_at      AS "updatedAt"
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return rows;
      }

      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE outbox_messages
        SET status = 'processing', updated_at = NOW()
        WHERE id = ANY(${ids})
      `;

      return rows.map((r) => ({ ...r, status: 'processing' }));
    });
  }

  async markDone(messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_messages
      SET status = 'done', updated_at = NOW()
      WHERE id = ${messageId} AND status <> 'done'
    `;
  }

  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_messages
      SET attempts        = ${attempts},
          next_attempt_at = ${nextAttemptAt},
          last_error      = ${lastError ?? null},
          status          = 'pending',
          updated_at      = NOW()
      WHERE id = ${messageId}
    `;
  }
}
```
