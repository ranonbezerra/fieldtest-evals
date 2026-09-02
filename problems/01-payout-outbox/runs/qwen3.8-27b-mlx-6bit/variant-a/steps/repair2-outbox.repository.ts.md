# repair2-outbox.repository.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/outbox/outbox.repository.ts`:

1. `src/outbox/outbox.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.`

This is the same issue as in `payout.repository.ts` — it imports `PrismaService` from `'../prisma/prisma.service.js'` which doesn't exist. Looking at the reference `payout.repository.ts`, it has the same import and the same comment about it being an assumption. So I need to keep this import pattern but the error is that the module doesn't exist.

Wait, looking more carefully at the reference `payout.repository.ts`, it uses `this.#prisma` as a private field. The test errors show:
- `Property 'prisma' is missing in type '{...}' but required in type 'PayoutRepository'`
- `Property 'prisma' is missing in type '{...}' but required in type 'OutboxRepository'`

This means the tests are trying to pass mock objects directly to the constructor, and TypeScript is complaining that the mock doesn't have a `prisma` property. This suggests the class has a public `prisma` property (or at least TypeScript sees it as required).

Wait, let me re-read. The reference `payout.repository.ts` uses `#prisma` (private with `#`). But the test error says "Property 'prisma' is missing in type ... but required in type 'PayoutRepository'". This means the current `outbox.repository.ts` must be using a public or protected `prisma` property (not `#prisma`).

Actually wait - the errors are for the CURRENT state of the file. The reference `payout.repository.ts` is what's already in the workspace and it uses `#prisma`. But the test errors reference both `PayoutRepository` and `OutboxRepository` having a required `prisma` property. 

Hmm, but the reference `payout.repository.ts` uses `#prisma`. If it's a `#` private field, TypeScript wouldn't report it as a missing property in assignability checks. So either:
1. The current `outbox.repository.ts` uses a different pattern (public `prisma`), OR
2. The test file is doing something that triggers this error differently.

Actually, looking at the test error more carefully:
```
test/payout.spec.ts(51,33): error TS2345: Argument of type '{ createPayoutWithReservation: Mock<Procedure>; ... }' is not assignable to parameter of type 'PayoutRepository'.
  Property 'prisma' is missing in type '...' but required in type 'PayoutRepository'.
```

This says `prisma` is a required property on `PayoutRepository`. But the reference uses `#prisma`. A `#` field is not part of the public type, so it shouldn't show up in assignability checks. Unless... the file was modified or the reference doesn't exactly match what's compiled.

Wait, I need to re-read the task. The task says "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them." And it says to rewrite `src/outbox/outbox.repository.ts`.

The errors I need to fix in `outbox.repository.ts` are:
1. Line 4, col 31: Cannot find module '../prisma/prisma.service.js'
2. The test error at line 266 says `OutboxRepository` has a required property 'prisma'

So the current `outbox.repository.ts` must have a public `prisma` property (probably `private readonly prisma: PrismaService` which in TypeScript still shows up as a property for structural typing when using `private` keyword... actually no, `private` members ARE included in the type for assignability checks in TypeScript. Only `#` private fields are excluded.)

So the fix is:
1. Keep the import of `PrismaService` (the module doesn't exist, but we can't create it since the task says "Change nothing the messages do not name" and the module path is what the plan specifies). Add an `// ASSUMPTION:` comment.
2. Change `private readonly prisma` to `#prisma` (like the reference `payout.repository.ts` does) so that the test mocks can be assigned without needing a `prisma` property.

Wait, but if I change to `#prisma`, will the test error at line 266 be fixed? The test passes an object with `claimPending`, `markDone`, `recordAttempt` mocks and tries to assign it to `OutboxRepository`. If `prisma` is a `#` field, it won't be part of the structural type, so the assignment should work (assuming the mock has all the public methods).

Actually wait - `#prisma` means the class requires a constructor that takes it, but structurally, a mock object that has all the public methods should be assignable. Let me think...

In TypeScript, `#` private fields are NOT part of the structural type. So a class with `#prisma: PrismaService` and methods `claimPending`, `markDone`, `recordAttempt` would have a structural type of just those methods. A mock with those methods would be assignable.

But `private readonly prisma: PrismaService` (using the `private` keyword) IS part of the structural type for the purposes of class-to-class assignability... actually no. In TypeScript, `private` members are NOT part of the structural type either for assignability between different classes. They ARE part of the nominal check (two classes are only assignable if they share the same origin).

Hmm, but the error says "is not assignable to parameter of type 'OutboxRepository'" and specifically mentions "Property 'prisma' is missing". This means TypeScript IS checking for `prisma` as a property.

Let me reconsider. When you have:
```ts
class OutboxRepository {
  private readonly prisma: PrismaService;
  constructor(prisma: PrismaService) { this.prisma = prisma; }
}
```

And you try to assign a plain object `{ claimPending: ..., markDone: ..., recordAttempt: ... }` to `OutboxRepository`, TypeScript will say the object is not assignable because it's missing the `prisma` property. This is because for non-class types being assigned to class types, TypeScript does structural checking including private members.

Wait no, that's not right either. Let me think again...

Actually in TypeScript, if you have a class with `private` members, a structurally-typed object (not an instance of that class) cannot be assigned to it. The error message typically says something like "Property 'prisma' is private and only accessible within class 'OutboxRepository'" or it might say "Property 'prisma' is missing".

But with `#prisma`, the field is truly not part of the type at all, so a structurally-compatible object CAN be assigned.

So the fix for the test errors is to use `#prisma` instead of `private readonly prisma`.

Now, for the module not found error on line 4: The import `import { PrismaService } from '../prisma/prisma.service.js'` fails because that file doesn't exist. The reference `payout.repository.ts` has the same import and the same error. Since I'm told to only fix what the messages require of THIS file, and the plan says to use PrismaService, I should keep the import but add an `// ASSUMPTION:` comment.

Wait, but the error IS in this file (line 4, col 31). The task says "fixing what these messages require of this file." So I need to address it. But I can't create the `prisma.service.ts` file because that's not this file. And I can't remove the import because the plan requires using PrismaService.

The solution is: keep the import (it's needed for the code to work once the file exists), and add an `// ASSUMPTION:` line. The reference `payout.repository.ts` does exactly this:
```ts
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';
```

So I'll do the same for `outbox.repository.ts`.

Now let me also look at error 2:
```
src/outbox/outbox.service.ts(2,28): error TS2459: Module '"./outbox.repository.js"' declares 'OutboxMessageRow' locally, but it is not exported.
```

This means `outbox.service.ts` imports `OutboxMessageRow` from `./outbox.repository.js`, but in the current `outbox.repository.ts`, `OutboxMessageRow` is declared but not exported. I need to export it.

So my fixes for `outbox.repository.ts`:
1. Add `// ASSUMPTION:` comment for the PrismaService import (same as reference)
2. Export `OutboxMessageRow` interface
3. Use `#prisma` instead of `private readonly prisma` to fix the test assignability errors

Let me now write the complete file. I need to follow the plan:

From the plan:
```ts
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  claimPending(limit: number): Promise<OutboxMessageRow[]>;
  markDone(messageId: string): Promise<void>;
  recordAttempt(messageId: string, attempts: number, nextAttemptAt: Date | null, lastError?: string): Promise<void>;
}
```

`claimPending`: SELECT … WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at FOR UPDATE SKIP LOCKED, then mark them 'processing'. Returns claimed rows.

`markDone`: Mark a message done (idempotent).

`recordAttempt`: Increment attempts, set next_attempt_at (or leave NULL if still retryable), set last_error.

Let me write this using `$queryRaw`/`$executeRaw` like the reference `payout.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawOutboxMessageRow {
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

function mapRow(raw: RawOutboxMessageRow): OutboxMessageRow {
  return {
    id: raw.id,
    payoutId: raw.payout_id,
    payload: raw.payload,
    status: raw.status as OutboxMessageRow['status'],
    attempts: raw.attempts,
    nextAttemptAt: raw.next_attempt_at,
    lastError: raw.last_error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class OutboxRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.#prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<RawOutboxMessageRow[]>`
        SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      const ids = rows.map(r => r.id);
      await tx.$executeRaw`
        UPDATE outbox_messages SET status = 'processing', updated_at = now()
        WHERE id = ${PrismaSql.In(ids)} -- hmm, this won't work with raw queries
      `;

      return rows.map(mapRow);
    });
  }
}
```

Wait, I can't easily do `WHERE id = ANY($1)` with Prisma's raw query template literals in a straightforward way. Let me think about how to handle the batch update.

Actually, I can use `WHERE id = ANY(${Prisma.sql`ARRAY[${ids.map(id => Prisma.sql`${id}::uuid`).join(Prisma.sql`, `)}]`}`) but that's complex. 

Alternatively, I can just update each one individually in a loop, or I can use a different approach.

Actually, looking at the reference `payout.repository.ts`, it uses simple raw SQL with template literals. For the batch update, I could:

1. Use a loop to update each message individually
2. Use `ANY(ARRAY[...])` syntax

Let me go with a simpler approach - since we're in a transaction and the rows are already locked with `FOR UPDATE SKIP LOCKED`, I can update them one by one or use a subquery.

Actually, the cleanest approach for Prisma raw queries would be:

```sql
UPDATE outbox_messages SET status = 'processing', updated_at = now()
WHERE id IN (SELECT id FROM ... )
```

But that's circular. Let me just do it in a loop since the batch size is small (10 per the plan).

Or better, I can use the `ANY` array approach. In Prisma's `$queryRaw` with template literals, I can interpolate arrays... actually no, Prisma's template tag doesn't natively support array interpolation for SQL.

Let me just loop:

```ts
for (const row of rows) {
  await tx.$executeRaw`
    UPDATE outbox_messages SET status = 'processing', updated_at = now() WHERE id = ${row.id}::uuid
  `;
}
```

This is fine for a batch of 10 and keeps the code simple. The rows are already locked by `FOR UPDATE SKIP LOCKED` so there's no race condition.

Now for `markDone`:
```ts
async markDone(messageId: string): Promise<void> {
  await this.#prisma.$executeRaw`
    UPDATE outbox_messages SET status = 'done', updated_at = now() WHERE id = ${messageId}::uuid
  `;
}
```

For `recordAttempt`:
```ts
async recordAttempt(messageId: string, attempts: number, nextAttemptAt: Date | null, lastError?: string): Promise<void> {
  await this.#prisma.$executeRaw`
    UPDATE outbox_messages SET attempts = ${attempts}, next_attempt_at = ${nextAttemptAt}, last_error = ${lastError ?? null}, updated_at = now()
    WHERE id = ${messageId}::uuid
  `;
}
```

Let me put it all together now. I need to make sure `OutboxMessageRow` is exported (fixing the TS2459 error).

Let me also double-check: the test at line 266 passes `{ claimPending, markDone, recordAttempt }` as a mock for `OutboxRepository`. With `#prisma`, the structural type of `OutboxRepository` would just be those three methods, so the mock should be assignable. Good.

One more thing - I need to make sure the `payload` field in the raw query result is correctly typed. When PostgreSQL returns jsonb, Prisma's `$queryRaw` will give it back as the TypeScript type you specify in the generic. Since we're specifying `RawOutboxMessageRow` with `payload: { to: string; amount: string }`, that should work.

Actually, I realize there might be an issue with how Prisma handles the `payload` column. Since it's `jsonb` in Postgres, Prisma's raw query will return it as a JavaScript object. The generic type parameter tells TypeScript what shape to expect, so `{ to: string; amount: string }` should be fine.

Let me finalize the file.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: PrismaService lives at src/prisma/prisma.service.ts; that file is not present in the workspace so the import cannot be verified.
import { PrismaService } from '../prisma/prisma.service.js';

export interface OutboxMessageRow {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawOutboxMessageRow {
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

function mapRow(raw: RawOutboxMessageRow): OutboxMessageRow {
  return {
    id: raw.id,
    payoutId: raw.payout_id,
    payload: raw.payload,
    status: raw.status as OutboxMessageRow['status'],
    attempts: raw.attempts,
    nextAttemptAt: raw.next_attempt_at,
    lastError: raw.last_error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

@Injectable()
export class OutboxRepository {
  #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  /**
   * Claim up to `limit` pending messages using FOR UPDATE SKIP LOCKED,
   * then mark them 'processing'. Returns the claimed rows.
   */
  async claimPending(limit: number): Promise<OutboxMessageRow[]> {
    return this.#prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<RawOutboxMessageRow[]>`
        SELECT id, payout_id, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
        FROM outbox_messages
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      for (const row of rows) {
        await tx.$executeRaw`
          UPDATE outbox_messages
          SET status = 'processing', updated_at = now()
          WHERE id = ${row.id}::uuid
        `;
      }

      return rows.map(mapRow);
    });
  }

  /** Mark a message done (idempotent). */
  async markDone(messageId: string): Promise<void> {
    await this.#prisma.$executeRaw`
      UPDATE outbox_messages
      SET status = 'done', updated_at = now()
      WHERE id = ${messageId}::uuid
    `;
  }

  /** Increment attempts, set next_attempt_at, set last_error. */
  async recordAttempt(
    messageId: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError?: string,
  ): Promise<void> {
    await this.#prisma.$executeRaw`
      UPDATE outbox_messages
      SET attempts = ${attempts},
          next_attempt_at = ${nextAttemptAt},
          last_error = ${lastError ?? null},
          updated_at = now()
      WHERE id = ${messageId}::uuid
    `;
  }
}
```
