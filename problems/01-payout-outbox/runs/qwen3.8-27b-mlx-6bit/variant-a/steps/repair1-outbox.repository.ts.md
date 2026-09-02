# repair1-outbox.repository.ts

## reasoning

```
Let me analyze the compiler errors for `src/outbox/outbox.repository.ts`:

1. `src/outbox/outbox.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.`
   - The import path is wrong. Looking at `payout.repository.ts`, it uses `'../prisma/prisma.service.js'` (with `.js` extension for ESM). The outbox repository is in `src/outbox/`, so the relative path to `src/prisma/prisma.service.ts` would be `'../prisma/prisma.service.js'`.

2. `src/outbox/outbox.repository.ts(21,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.`
   - The `$transaction` callback parameter needs explicit typing. Looking at `payout.repository.ts`, it uses `(tx: Prisma.TransactionClient)`.

3. `src/outbox/outbox.repository.ts(45,29): error TS7006: Parameter 'r' implicitly has an 'any' type.`
   - A `.map(r => ...)` callback needs explicit typing.

4. `src/outbox/outbox.repository.ts(52,24): error TS7006: Parameter 'r' implicitly has an 'any' type.`
   - Another `.map(r => ...)` callback needs explicit typing.

Now I need to reconstruct `src/outbox/outbox.repository.ts` based on the PLAN.md. The plan specifies:

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

Let me write the complete file. I need to:
1. Fix the import to use `'../prisma/prisma.service.js'` (ESM convention, matching `payout.repository.ts`)
2. Type the `tx` parameter as `Prisma.TransactionClient`
3. Type the `.map(r => ...)` callbacks with explicit types

Let me think about what the file likely looks like. Based on the plan:

- `claimPending(limit)`: Uses `$transaction` with raw SQL to SELECT pending messages FOR UPDATE SKIP LOCKED, then marks them processing. Returns the claimed rows.
- `markDone(messageId)`: Updates status to 'done'.
- `recordAttempt(messageId, attempts, nextAttemptAt, lastError)`: Updates attempts, next_attempt_at, last_error.

The errors at lines 45 and 52 with parameter 'r' suggest there are `.map()` calls. Let me think about what the structure would be:

For `claimPending`, the typical pattern with FOR UPDATE SKIP LOCKED in a transaction would be:
1. SELECT ids with FOR UPDATE SKIP LOCKED
2. UPDATE those to 'processing'
3. SELECT the full rows back (or return the ids)

Actually, looking more carefully at the line numbers:
- Line 21: `tx` parameter (in `$transaction` callback)
- Line 45: `r` parameter (first `.map()`)
- Line 52: `r` parameter (second `.map()`)

So there are two `.map()` calls. This could be:
1. One in `claimPending` - mapping raw results to typed rows
2. Another somewhere else

Wait, let me reconsider. The plan says `claimPending` uses raw SQL with FOR UPDATE SKIP LOCKED. The typical approach:

```ts
async claimPending(limit: number): Promise<OutboxMessageRow[]> {
  return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Select pending messages with FOR UPDATE SKIP LOCKED
    const rows = await tx.$queryRaw<...>`...`;
    
    if (rows.length === 0) return [];
    
    const ids = rows.map(r => r.id);
    
    // Mark as processing
    await tx.$executeRaw`...`;
    
    return rows.map(r => ({ ... }));
  });
}
```

That would give two `.map()` calls. Let me construct this properly.

Actually, let me reconsider the line numbers more carefully:
- Line 2: import
- Line 21: `tx` in transaction callback
- Line 45: first `r` 
- Line 52: second `r`

Let me write the file and count lines to make sure it aligns. Actually, I don't need to match exact line numbers - I just need to fix the errors. Let me write a clean implementation.

For the `OutboxMessageRow` type, based on the schema:
- id: string (uuid)
- payoutId: string (uuid)
- payload: object (jsonb) - `{ to: string, amount: string }`
- status: OutboxStatus
- attempts: number
- nextAttemptAt: Date | null
- lastError: string | null
- createdAt: Date
- updatedAt: Date

Now let me write the complete file:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxStatus } from './outbox.types.js';
```

Wait, there's no `outbox.types.ts` mentioned. Let me look at the plan again. The plan mentions `src/payout/payout.types.ts` has `OutboxStatus`. So I should import from there.

Actually, looking at the error list, there's no error about `outbox.types` - so the original file must have been importing from somewhere. Let me just import `OutboxStatus` from the payout types since that's where it's defined per the plan.

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxStatus } from '../payout/payout.types.js';

interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim up to `limit` pending messages atomically using
   * FOR UPDATE SKIP LOCKED, mark them 'processing', and return them.
   */
  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<Array<{ id: string; payout_id: string; payload: { to: string; amount: string }; status: string; attempts: number; next_attempt_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date }>>`
        SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map(r => r.id);

      await tx.$executeRaw`
        UPDATE outbox_messages
        SET status = 'processing', updated_at = now()
        WHERE id = ANY(${ids}::uuid[])
      `;

      return rows.map(r => ({
        id: r.id,
        payoutId: r.payout_id,
        payload: r.payload,
        status: 'processing' as OutboxStatus,
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: new Date(),
      }));
    });
  }

  /** Mark a message done (idempotent). */
  async markDone(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'done', updatedAt: new Date() },
    });
  }

  /** Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error. */
  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: {
        attempts,
        nextAttemptAt,
        lastError,
        status: 'pending',
        updatedAt: new Date(),
      },
    });
  }
}
```

Wait, I need to be careful. The error says line 2 column 31 for the import. Let me check: `import { PrismaService } from '../prisma/prisma.service'` - column 31 would be around the module path. The fix is to add `.js` extension: `'../prisma/prisma.service.js'`.

Now let me count lines to verify my structure matches:
1. `import { Injectable } from '@nestjs/common';`
2. `import { Prisma } from '@prisma/client';`
3. `// ASSUMPTION: ...`
4. `import { PrismaService } from '../prisma/prisma.service.js';`
5. `import type { OutboxStatus } from '../payout/payout.types.js';`
6. (blank)
7. `interface OutboxMessageRow {`
8-15. fields
16. `}`
17. (blank)
18. `@Injectable()`
19. `export class OutboxRepository {`
20. `  constructor(private readonly prisma: PrismaService) {}`
21. (blank or comment)

Hmm, line 21 has the `tx` error. Let me adjust. The error is at line 21 column 44. If I structure it as:

```
1: import { Injectable } from '@nestjs/common';
2: import { Prisma } from '@prisma/client';
3: // ASSUMPTION: ...
4: import { PrismaService } from '../prisma/prisma.service.js';
5: import type { OutboxStatus } from '../payout/payout.types.js';
6: 
7: interface OutboxMessageRow {
8:   id: string;
9:   payoutId: string;
10:   payload: { to: string; amount: string };
11:   status: OutboxStatus;
12:   attempts: number;
13:   nextAttemptAt: Date | null;
14:   lastError: string | null;
15:   createdAt: Date;
16:   updatedAt: Date;
17: }
18: 
19: @Injectable()
20: export class OutboxRepository {
21:   constructor(private readonly prisma: PrismaService) {}
```

That puts `tx` at line 21? No, that's the constructor. Let me think differently - the exact line numbers don't matter for my fix. I just need to ensure all the errors are fixed:

1. Import path → `'../prisma/prisma.service.js'`
2. `tx` parameter typed as `Prisma.TransactionClient`
3. First `r` in `.map()` typed explicitly
4. Second `r` in `.map()` typed explicitly

The instructions say "Change nothing the messages do not name." So I should only fix what's broken and keep the rest as-is. But since I'm rewriting the whole file (as instructed: "Rewrite `src/outbox/outbox.repository.ts` complete"), I need to produce the full file.

Let me make sure my implementation is correct and follows the plan. The key fixes are:
1. Use `'../prisma/prisma.service.js'` (with `.js`)
2. Type `tx` as `Prisma.TransactionClient`
3. Type the map callbacks

For the `.map()` callbacks, I can either:
- Define an intermediate type for the raw row and annotate the parameter
- Or use a type assertion on the `$queryRaw` result

The cleanest approach is to define the raw row type and use it in the `.map()` callbacks.

Actually, looking at this more carefully - if I type the `$queryRaw` with a proper generic, then `rows` will be typed, and `r` in `.map(r => ...)` will be inferred. That would fix the TS7006 errors without needing explicit annotations on `r`.

Wait, but the error says "Parameter 'r' implicitly has an 'any' type" - this means in the original code, `r` was not being inferred. This could happen if the `$queryRaw` wasn't properly typed or if there was some other issue.

Let me just make sure my implementation has proper typing throughout. If I use `$queryRaw<T>()` with a proper type, the `.map(r => ...)` should infer `r` correctly.

Let me finalize my implementation. I'll keep it clean and make sure all four errors are addressed.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxStatus } from '../payout/payout.types.js';

interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawOutboxMessage {
  id: string;
  payout_id: string;
  payload: { to: string; amount: string };
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim up to `limit` pending messages atomically using
   * FOR UPDATE SKIP LOCKED, mark them 'processing', and return them.
   */
  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows: RawOutboxMessage[] = await tx.$queryRaw`
        SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return [];
      }

      const ids: string[] = rows.map((r: RawOutboxMessage) => r.id);

      await tx.$executeRaw`
        UPDATE outbox_messages
        SET status = 'processing', updated_at = now()
        WHERE id = ANY(${ids}::uuid[])
      `;

      return rows.map((r: RawOutboxMessage): OutboxMessageRow => ({
        id: r.id,
        payoutId: r.payout_id,
        payload: r.payload,
        status: 'processing',
        attempts: r.attempts,
        nextAttemptAt: r.next_attempt_at,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: new Date(),
      }));
    });
  }

  /** Mark a message done (idempotent). */
  async markDone(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'done', updatedAt: new Date() },
    });
  }

  /** Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error. */
  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: {
        attempts,
        nextAttemptAt,
        lastError,
        status: 'pending',
        updatedAt: new Date(),
      },
    });
  }
}
```
