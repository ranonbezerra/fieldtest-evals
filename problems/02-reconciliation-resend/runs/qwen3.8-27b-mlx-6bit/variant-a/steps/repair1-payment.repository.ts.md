# repair1-payment.repository.ts

## reasoning

```
Let me analyze the compiler errors for `src/payment/payment.repository.ts`:

1. Line 11: `'createdAt'` does not exist in type `OrderOrderByWithRelationInput` — should be `created_at`
2. Line 22: `'effectiveDate'` does not exist in type `OrderWhereInput` — should be `effective_date`
3. Line 29: `'lastAttemptAt'` does not exist — should be `last_attempt_at`
4. Line 36: `'lastAttemptAt'` does not exist — should be `last_attempt_at`
5. Line 50: `'settledAt'` does not exist — should be `settled_at`
6. Line 90: `'amountMinorUnits'` does not exist — should be `amount_minor_units`

The other errors are about missing modules (`payment.module`, `bank-client.interface`) which are not in this file.

The key insight is that Prisma's generated types use the `@map`ped (snake_case) names in the query input types. So when using `orderBy`, `where`, `data` in Prisma queries, we must use the database column names (snake_case), not the model field names (camelCase).

Wait, actually let me think about this more carefully. In Prisma, by default, the model fields use camelCase in the generated client types. If you have `@map("created_at")` on a field, the Prisma model field is still `createdAt` (camelCase) in the TypeScript client. But the error says `'createdAt' does not exist in type 'OrderOrderByWithRelationInput'` and suggests `created_at`.

This means the Prisma schema must have the fields named in snake_case directly (without using `@map`), or the `@map` is on the model level and the fields themselves are already snake_case in the schema.

Looking at the plan: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)." So the convention is to use `@map` for the database columns. But if the model fields in the schema are defined as snake_case (e.g., `created_at DateTime @default(now())`), then the Prisma client will expose them as `created_at` in query inputs.

The error messages confirm this: Prisma is telling us to use `created_at`, `effective_date`, `last_attempt_at`, `settled_at`, `amount_minor_units` — the snake_case names.

So the Prisma schema must define the fields with snake_case names directly (not camelCase with `@map`). The model fields themselves are snake_case.

Now let me write the repository file. I need to reconstruct what it should look like based on:
1. The plan's repository interface
2. The error messages telling me which properties need to be snake_case
3. The conventions (Prisma, conditional updates, etc.)

Let me write the complete file:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// ... 
```

Wait, I need to think about what the file currently looks like and what changes are needed. The errors tell me specific lines have wrong property names. Let me reconstruct the file based on the plan's interface and fix the naming.

From the plan:
- `findPending(limit: number): Promise<OrderRecord[]>`
- `findByTxid(txid: string): Promise<OrderRecord | null>`
- `findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>`
- `markSent(id: string, lastAttemptAt: Date): Promise<void>`
- `markInDoubt(id: string, lastAttemptAt: Date): Promise<void>`
- `markRejected(id: string): Promise<void>`
- `markSettled(id: string, settledAt: Date): Promise<void>`
- `markPendingForResend(id: string): Promise<void>`
- `markParked(id: string): Promise<void>`
- `incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>`
- `upsertSettlement(data: {...}): Promise<void>`

The errors tell me:
- Line 11: `orderBy: { createdAt: 'asc' }` → should be `createdAt` → no, should be `created_at`
- Line 22: `where: { effectiveDate: ... }` → should be `effective_date`
- Line 29: `data: { lastAttemptAt: ... }` → should be `last_attempt_at`
- Line 36: `data: { lastAttemptAt: ... }` → should be `last_attempt_at`
- Line 50: `data: { settledAt: ... }` → should be `settled_at`
- Line 90: `data: { amountMinorUnits: ... }` → should be `amount_minor_units`

So the Prisma model fields are named in snake_case. This means in the schema, the fields are defined like:
```prisma
model Order {
  id                String    @id @default(uuid())
  supplier_key      String
  amount_minor_units BigInt
  effective_date    DateTime  @db.Date
  txid              String    @unique
  status            String
  attempt_count     Int       @default(0)
  last_attempt_at   DateTime?
  settled_at        DateTime?
  created_at        DateTime  @default(now())
  updated_at        DateTime  @default(now()) @updatedAt
  @@map("orders")
}
```

So all field references in Prisma queries must use snake_case.

Now let me also think about the `OrderRecord` type. Since Prisma returns fields as defined in the model, the returned objects will have snake_case properties too. So `OrderRecord` should use snake_case field names as well (or we map them).

Actually, looking at the plan more carefully, the `OrderRecord` interface uses snake_case:
```typescript
interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}
```

So the repository returns records with snake_case field names, which aligns with Prisma returning them as-is.

Now let me write the complete file. I need to be careful about:
1. Using snake_case for all Prisma query properties
2. The conditional updates (WHERE status IN (...))
3. The atomic increment
4. The upsert for settlements

Let me also think about how to do conditional updates with Prisma. In Prisma, `updateMany` accepts a `where` clause, so I can do:

```typescript
await this.prisma.order.updateMany({
  where: { id, status: { in: ['sent', 'in_doubt'] } },
  data: { status: 'settled', settled_at: settledAt, updated_at: new Date() },
});
```

For the atomic increment, Prisma doesn't have a direct `increment` in `updateMany` that returns the new value. I'll need to use a raw query or do it differently. Actually, Prisma does support `$increment` in update operations:

```typescript
await this.prisma.order.updateMany({
  where: { id, status: 'pending' },
  data: { 
    attempt_count: { increment: 1 },
    last_attempt_at: lastAttemptAt,
    updated_at: new Date() 
  },
});
```

But this doesn't return the new count. The plan says `incrementAttempt` should "return the new count; if rows affected is 0, skip". 

With `updateMany`, I can check `count` from the result. But to get the new count, I'd need to either:
1. Read it after incrementing
2. Use a raw query

Actually, looking at the plan again: "The repository's `incrementAttempt` uses an atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; if rows affected is 0, another process won the race and this one skips."

So the return value is the number of rows affected (0 or 1), not the new count value. Let me re-read... "returning the new count" — hmm, it says "returning the new count" but then "if rows affected is 0". I think it means: perform the atomic increment, and if no row was affected (because status changed), return 0 (or a falsy value) to indicate the caller should skip. If a row was affected, return 1 (or the new count).

Actually, re-reading: "if rows affected is 0, another process won the race and this one skips." So the return value indicates whether the increment succeeded. Let me just use `updateMany` and check the count.

Wait, but the plan's signature says `incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>`. The number returned could be the count of affected rows. Let me go with that interpretation: return the count from `updateMany`.

Now, for the Prisma client injection in NestJS, I'll use the standard pattern. Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: string;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },  // line 11 fix
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: {
        status: 'in_doubt',
        effective_date: date,  // line 22 fix
      },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'sent',
        last_attempt_at: lastAttemptAt,  // line 29 fix
        updated_at: new Date(),
      },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'in_doubt',
        last_attempt_at: lastAttemptAt,  // line 36 fix
        updated_at: new Date(),
      },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'rejected',
        updated_at: new Date(),
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: {
        status: 'settled',
        settled_at: settledAt,  // line 50 fix
        updated_at: new Date(),
      },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: {
        status: 'pending',
        updated_at: new Date(),
      },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'parked_manual_review',
        updated_at: new Date(),
      },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        attempt_count: { increment: 1 },
        last_attempt_at: lastAttemptAt,
        updated_at: new Date(),
      },
    });
    return result.count;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      update: {},
      create: {
        txid: data.txid,
        amount_minor_units: data.amount_minor_units,  // line 90 fix
        settled_at: data.settled_at,
        statement_date: data.statement_date,
      },
    });
  }
}
```

Wait, I need to check — does the `Settlement` model have a `statement_date` field? Looking at the plan's data model for settlements:
- `id` uuid PK
- `txid` varchar(64) UNIQUE
- `amount_minor_units` bigint
- `settled_at` timestamptz
- `statement_date` date
- `created_at` timestamptz

Yes. And the field would be `statement_date` in snake_case.

Now, about the `OrderRecord` type — since Prisma returns the model fields as-is (snake_case in this case), the return type of `findMany` and `findUnique` will match. But I'm defining `OrderRecord` explicitly. The Prisma return type would be the full model type which includes all fields. I could either:
1. Let TypeScript infer and just return the Prisma type
2. Define `OrderRecord` as a subset

The plan defines `OrderRecord` as an interface with specific fields. But if I use it as the return type, TypeScript might complain that the Prisma type has extra fields (like `updated_at`, `created_at`). Actually, since I'm using `findMany` and `findUnique`, the return type will be the full Prisma model. I can just not annotate the return type explicitly, or I can make `OrderRecord` match what Prisma returns.

Actually, the simplest approach: don't annotate return types explicitly where Prisma gives us the right shape, or just use `as` if needed. But actually, since the plan says the repository interface returns `OrderRecord[]`, and Prisma will return the full model (which is a superset), it should be fine for structural typing — a Prisma Order type is assignable to `OrderRecord` as long as all required fields are present.

Hmm, but actually if I explicitly annotate `Promise<OrderRecord[]>`, TypeScript will check that the Prisma return type is assignable to `OrderRecord[]`. Since Prisma returns all fields including the ones in `OrderRecord`, it should work.

Let me also think about whether I need to import the `OrderStatus` type or just use `string`. The plan defines it, but for the repository I'll just use `string` since we're not doing type-level validation of statuses in the repo.

Actually wait — I should look at what the service imports from the repository. The service file has errors about not finding `./payment.repository` module, but that's a separate issue (missing file or wrong path). My task is just to fix `payment.repository.ts`.

Let me also consider: the `status` field in the Prisma model — is it an enum or a string? Looking at the plan, it says `varchar(32)` with "One of: ...". In Prisma, this could be a native enum or just a String. If it's a native enum, the Prisma client would have a specific type for it. If it's just a String, then `string` works.

Given that the convention says to use `@map` for snake_case and the errors confirm snake_case field names are used in queries, I'll assume it's a `String` field (not an enum) to keep things simple and matching the error messages.

Let me finalize my answer. I think the file is straightforward — just fix all the camelCase property names to snake_case in the Prisma queries.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: string;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: {
        status: 'in_doubt',
        effective_date: date,
      },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'sent',
        last_attempt_at: lastAttemptAt,
        updated_at: new Date(),
      },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'in_doubt',
        last_attempt_at: lastAttemptAt,
        updated_at: new Date(),
      },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'rejected',
        updated_at: new Date(),
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: {
        status: 'settled',
        settled_at: settledAt,
        updated_at: new Date(),
      },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: {
        status: 'pending',
        updated_at: new Date(),
      },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'parked_manual_review',
        updated_at: new Date(),
      },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: {
        attempt_count: { increment: 1 },
        last_attempt_at: lastAttemptAt,
        updated_at: new Date(),
      },
    });
    return result.count;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      update: {},
      create: {
        txid: data.txid,
        amount_minor_units: data.amount_minor_units,
        settled_at: data.settled_at,
        statement_date: data.statement_date,
      },
    });
  }
}
```
