# 03-projections.repository.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `projections.repository.ts` should contain.

According to the plan:

```ts
class ProjectionsRepository {
  constructor(prisma: PrismaClient);

  upsertOrder(order: OperationRow): Promise<void>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>;

  adjustTotals(companyId: string, delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number }): Promise<void>;
  resetTotals(companyId: string, totals: CompanyTotals): Promise<void>;

  /** Reads source tables; returns joined rows for the given window. */
  fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]>;

  /** Reads projection rows for the given window (by `createdAt`). */
  fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]>;

  deleteProjectionWindow(from: Date, to: Date): Promise<number>;
  bulkUpsert(rows: OperationRow[]): Promise<void>;

  getTotals(companyId: string): Promise<CompanyTotals | null>;
}
```

So the repository needs to:
1. `upsertOrder` - upsert a single row into `operation_read_models`
2. `updateOrderStatus` - update the status of a projection row
3. `adjustTotals` - adjust the company financial totals by deltas (using atomic increments)
4. `resetTotals` - reset totals for a company
5. `fetchSourceWindow` - read from source tables (payment_orders JOIN workers JOIN events) for the window
6. `fetchProjectionWindow` - read projection rows for the window
7. `deleteProjectionWindow` - delete projection rows in the window, return count
8. `bulkUpsert` - upsert multiple rows
9. `getTotals` - get totals for a company

Key design considerations:
- The concurrency test requires that `adjustTotals` uses atomic increments (not read-modify-write), otherwise concurrent updates will lose data.
- The `adjustTotals` uses BigInt for cents columns and Int for pending_count.

Let me look at the schema:

**`operation_read_models`:**
- id: String @id
- company_id
- worker_id
- worker_name
- event_id
- event_title
- event_location
- status: OrderStatus
- amount_cents: Int
- created_at: DateTime
- updated_at: DateTime @updatedAt

**`company_financial_totals`:**
- company_id: String @id
- approved_total_cents: BigInt @default(0)
- rejected_total_cents: BigInt @default(0)
- pending_count: Int @default(0)

Now, for the Prisma implementation:

`upsertOrder(order: OperationRow)`:
```ts
await this.prisma.operationReadModel.upsert({
  where: { id: order.id },
  update: {
    companyId: order.companyId,
    workerId: order.workerId,
    workerName: order.workerName,
    eventId: order.eventId,
    eventTitle: order.eventTitle,
    eventLocation: order.eventLocation,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
  },
  create: {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    workerName: order.workerName,
    eventId: order.eventId,
    eventTitle: order.eventTitle,
    eventLocation: order.eventLocation,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
  },
});
```

Wait - the plan says `created_at` is "Order's original `created_at` — sort key". So when upserting, we probably shouldn't overwrite created_at on update? Actually, for drift repair and re-derivation we'd want to set it. Let me keep it simple - always set it in both create and update. Actually, for the sync hook (create), the id is new so it's just a create. For status change we use `updateOrderStatus`. So `upsertOrder` is mainly used in re-derive and drift repair contexts where we want the full row. I'll include createdAt in both.

`updateOrderStatus(orderId: string, status: OrderStatus)`:
```ts
await this.prisma.operationReadModel.update({
  where: { id: orderId },
  data: { status },
});
```

`adjustTotals(companyId, delta)`:
This needs to be atomic. In Prisma:
```ts
await this.prisma.companyFinancialTotal.upsert({
  where: { companyId },
  update: {
    approvedTotalCents: { increment: delta.approvedCents ?? 0n },
    rejectedTotalCents: { increment: delta.rejectedCents ?? 0n },
    pendingCount: { increment: delta.pendingDelta ?? 0 },
  },
  create: {
    companyId,
    approvedTotalCents: delta.approvedCents ?? 0n,
    rejectedTotalCents: delta.rejectedCents ?? 0n,
    pendingCount: delta.pendingDelta ?? 0,
  },
});
```

This is atomic - the increment happens at the DB level so concurrent calls won't lose updates. This is critical for the concurrency test.

`resetTotals(companyId, totals)`:
```ts
await this.prisma.companyFinancialTotal.upsert({
  where: { companyId },
  update: {
    approvedTotalCents: totals.approvedTotalCents,
    rejectedTotalCents: totals.rejectedTotalCents,
    pendingCount: totals.pendingCount,
  },
  create: {
    companyId,
    approvedTotalCents: totals.approvedTotalCents,
    rejectedTotalCents: totals.rejectedTotalCents,
    pendingCount: totals.pendingCount,
  },
});
```

`fetchSourceWindow(from, to)`:
This needs a raw query or a Prisma findMany with joins. Since the source tables are `payment_orders`, `events`, `workers`, and we need joined data, the cleanest is `$queryRaw`. But wait - "Zero raw SQL" applies to the service layer, not the repository. The repository is the only layer that touches the database, so raw SQL in the repository should be fine... Actually, let me re-read: "repository is the only layer that touches the database." and "service holds the logic. Zero raw SQL, zero Prisma client calls." So raw SQL in repository is allowed.

However, I could also use Prisma's relational findMany with includes:
```ts
const orders = await this.prisma.paymentOrder.findMany({
  where: {
    createdAt: { gte: from, lt: to },
  },
  include: { worker: true, event: true },
});
```

But that requires defining relations in the Prisma schema. The plan's schema section shows `company_id` as "FK → companies (implicit)" - it says "implicit". Hmm, the schema shows columns but doesn't explicitly show relation fields. Let me look again:

**`payment_orders`**: `company_id | String @map("company_id") | FK → companies (implicit)`, `worker_id | FK → workers`, `event_id | FK → events`

The word "implicit" suggests there are no explicit relation fields defined in the Prisma schema - just scalar FK columns. If that's the case, `include` won't work and we'd need a raw query or multiple queries.

Actually wait - if the schema doesn't define relations (no `worker Worker @relation(...)` field), then Prisma can't do `include`. Given the plan shows the tables with only scalar columns (no relation fields listed), I'll use a raw query for `fetchSourceWindow`.

Actually, let me reconsider. The plan says "FK → companies (implicit)" - this is ambiguous. But the safest interpretation given the table definitions only list scalar columns is that relations are not modeled in Prisma. So a raw SQL query is the way to go for `fetchSourceWindow`.

Let me write it with `$queryRaw`:

```ts
async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
  const rows = await this.prisma.$queryRaw<...>`
    SELECT po.id, po.company_id AS "companyId", po.worker_id AS "workerId",
           w.name AS "workerName", po.event_id AS "eventId",
           e.title AS "eventTitle", e.location AS "eventLocation",
           po.status, po.amount_cents AS "amountCents", po.created_at AS "createdAt"
    FROM payment_orders po
    JOIN workers w ON w.id = po.worker_id
    JOIN events e ON e.id = po.event_id
    WHERE po.created_at >= ${from} AND po.created_at < ${to}
  `;
  ...
}
```

Hmm, but with Prisma and ESM, the tagged template for `$queryRaw` works. The status column is stored as a string in Postgres (Prisma enums are stored as strings by default), so I need to cast it.

Actually, let me think about whether to use raw SQL or Prisma queries. The plan says "repository is the only layer that touches the database" and the service has "Zero raw SQL, zero Prisma client calls". This implies the repository CAN use raw SQL. Given that the schema likely doesn't have relations defined (the plan only lists scalar columns), raw SQL for the join is the most defensible approach.

But wait - I need to be careful. If the Prisma schema DOES have relations, then `include` would work. But based on the plan's table definitions which only show scalar columns, I'll go with raw SQL for the join query.

Let me also consider: the status enum. In Prisma, if `OrderStatus` is defined as a Prisma enum, it's stored as a string in Postgres. When reading via raw SQL, it comes back as a string that I need to cast to `OrderStatus`.

For `fetchProjectionWindow`, this is a simple `findMany` on the projection table:
```ts
const rows = await this.prisma.operationReadModel.findMany({
  where: {
    createdAt: { gte: from, lt: to },
  },
});
```

This returns Prisma model objects which have all the fields I need.

`deleteProjectionWindow(from, to)`:
```ts
const result = await this.prisma.operationReadModel.deleteMany({
  where: {
    createdAt: { gte: from, lt: to },
  },
});
return result.count;
```

`bulkUpsert(rows)`:
I can use `$transaction` with multiple upserts, or a raw query. For simplicity and correctness, I'll use a transaction of upserts. Actually, for performance with potentially many rows, a raw `INSERT ... ON CONFLICT` would be better. But let me keep it simple with Prisma:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await this.prisma.$transaction(
    rows.map(row => this.upsertOrder(row))
  );
}
```

Hmm, but that's N separate upserts. For the re-derivation of a date window with potentially many rows, this could be slow but functionally correct. Alternatively, I could use a raw query with `INSERT ... ON CONFLICT DO UPDATE`. Let me think...

Actually, for the scale we're dealing with (re-derivation of a date window), and since this is a test/eval context, I'll use the transaction approach for clarity. But actually, a raw SQL bulk upsert would be more performant and still in the repository layer. Let me go with raw SQL for bulk upsert since it's more appropriate:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Use raw SQL for efficient bulk upsert
}
```

Actually, let me just keep it simple and use Prisma's `$transaction` with individual upserts. It's clearer, type-safe, and for the eval context it's fine. The plan doesn't specify performance requirements for the bulk operation specifically.

Wait, actually there's a subtlety. If I call `this.upsertOrder(row)` inside the `$transaction`, it uses the outer `this.prisma` which is NOT the transaction client. I need to pass the transaction client. Let me restructure:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await this.prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.operationReadModel.upsert({ ... });
    }
  });
}
```

Hmm, but that's duplicating the upsert logic. Let me factor it or just use a loop. Actually, for this file I'll just inline it in the transaction callback.

Alternatively, I could make `upsertOrder` accept an optional Prisma client... but that complicates the interface defined in the plan. The plan says `upsertOrder(order: OperationRow): Promise<void>` - no transaction param.

Let me just use a for-loop inside `$transaction` in `bulkUpsert`:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await this.prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.operationReadModel.upsert({
        where: { id: row.id },
        update: {
          companyId: row.companyId,
          workerId: row.workerId,
          workerName: row.workerName,
          eventId: row.eventId,
          eventTitle: row.eventTitle,
          eventLocation: row.eventLocation,
          status: row.status,
          amountCents: row.amountCents,
          createdAt: row.createdAt,
        },
        create: {
          id: row.id,
          companyId: row.companyId,
          workerId: row.workerId,
          workerName: row.workerName,
          eventId: row.eventId,
          eventTitle: row.eventTitle,
          eventLocation: row.eventLocation,
          status: row.status,
          amountCents: row.amountCents,
          createdAt: row.createdAt,
        },
      });
    }
  });
}
```

This is correct but verbose. Alternatively, I could use a raw SQL approach for bulk upsert. Let me go with the Prisma approach for type safety.

Actually, you know what, let me use a raw SQL bulk upsert. It's cleaner for a "bulk" operation and avoids the N+1 pattern:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  
  const values = rows.map((row, i) => `(${
    [
      this.prisma.$types... // hmm, this gets complicated with parameterized queries
    ]
  })`);
}
```

No, this gets messy with parameterization. Let me stick with the Prisma transaction approach. It's correct, type-safe, and the plan doesn't require a specific implementation for bulk upsert.

Actually, let me reconsider the whole approach. Let me use Prisma's `prisma.$transaction` with an array of promises for `bulkUpsert`. This is the simplest correct approach:

```ts
async bulkUpsert(rows: OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await this.prisma.$transaction(rows.map((row) => this.upsertOrder(row)));
}
```

Wait, but `this.upsertOrder(row)` uses `this.prisma` not the transaction client. In Prisma, when you pass an array of promises to `$transaction`, each promise should use the same transaction. But `this.upsertOrder` uses `this.prisma.operationReadModel` which is outside the transaction.

Actually, in Prisma, `$transaction` with an array of promises does NOT create a proper interactive transaction for those operations. Each operation runs independently. For a true transaction, I need the interactive form:

```ts
await this.prisma.$transaction(async (tx) => {
  for (const row of rows) {
    await tx.operationReadModel.upsert({ ... });
  }
});
```

OK let me just do the interactive transaction with a loop. It's the most correct approach.

Now, for `fetchSourceWindow`, let me think about the raw SQL more carefully.

The Prisma model names:
- `payment_orders` → Prisma model name would be `PaymentOrder` (camelCase of the table name... actually no. In Prisma, the model name is what you define in `model X { }`. The plan says `@@map("payment_orders")` so the model is probably `PaymentOrder`.)
- `events` → `Event`
- `workers` → `Worker`
- `operation_read_models` → `OperationReadModel`
- `company_financial_totals` → `CompanyFinancialTotal`

For raw SQL, I need to use the actual table names: `payment_orders`, `events`, `workers`.

Let me write the raw query:

```sql
SELECT 
  po.id AS "id",
  po.company_id AS "companyId",
  po.worker_id AS "workerId",
  w.name AS "workerName",
  po.event_id AS "eventId",
  e.title AS "eventTitle",
  e.location AS "eventLocation",
  po.status AS "status",
  po.amount_cents AS "amountCents",
  po.created_at AS "createdAt"
FROM payment_orders po
JOIN workers w ON w.id = po.worker_id
JOIN events e ON e.id = po.event_id
WHERE po.created_at >= $1 AND po.created_at < $2
```

In Prisma's `$queryRaw`, I use tagged templates:

```ts
const rows = await this.prisma.$queryRaw<Array<{
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventTitle: string;
  eventLocation: string;
  status: string;
  amountCents: number;
  createdAt: Date;
}>>`
  SELECT ...
  WHERE po.created_at >= ${from} AND po.created_at < ${to}
`;
```

Then I map `status` from `string` to `OrderStatus`:
```ts
return rows.map(row => ({ ...row, status: row.status as OrderStatus }));
```

This should work. Let me now put together the complete file.

One more consideration: the import for `PrismaClient`. In NestJS with Prisma, the typical setup is to have a `PrismaService` that extends `PrismaClient`. But the plan says the repository constructor takes `prisma: PrismaClient`. So I'll import `PrismaClient` directly from `@prisma/client`.

Actually, in a typical NestJS + Prisma setup, you'd have a `PrismaService` that provides the client. But the plan explicitly says `constructor(prisma: PrismaClient)`. Let me just use that. In NestJS DI, I'd need to provide it. But the plan's module section says:

```
src/projections/projections.module.ts | reads: src/projections/projections.service.ts, src/projections/projections.repository.ts | Module wiring; exports ProjectionsService
```

The module would handle the DI setup. For this file, I just need to declare the constructor param. In NestJS, I'd use `@Inject` or just constructor injection if the token matches. Since the plan says `constructor(prisma: PrismaClient)`, I'll use that. In practice, you'd need a provider for `PrismaClient` or use a custom token, but that's the module's concern.

Actually, looking more carefully at typical NestJS+Prisma patterns, you'd often inject a `PrismaService`. But the plan explicitly states `constructor(prisma: PrismaClient)`. I'll follow the plan exactly.

Let me also think about whether I need `@Injectable()` decorator. Yes, for NestJS DI, the class needs `@Injectable()`.

Now let me also consider: do I need to import anything else? Let me check the types file:
- `OperationRow` - from `./projections.types`
- `OrderStatus` - from `./projections.types`  
- `CompanyTotals` - from `./projections.types`

And from `@prisma/client`:
- `PrismaClient`

Let me write the complete file now.

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OperationRow, OrderStatus, CompanyTotals } from './projections.types';

@Injectable()
export class ProjectionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOrder(order: OperationRow): Promise<void> {
    await this.prisma.operationReadModel.upsert({
      where: { id: order.id },
      update: {
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
      create: {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    await this.prisma.operationReadModel.update({
      where: { id: orderId },
      data: { status },
    });
  }

  async adjustTotals(
    companyId: string,
    delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number },
  ): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: { increment: delta.approvedCents ?? 0n },
        rejectedTotalCents: { increment: delta.rejectedCents ?? 0n },
        pendingCount: { increment: delta.pendingDelta ?? 0 },
      },
      create: {
        companyId,
        approvedTotalCents: delta.approvedCents ?? 0n,
        rejectedTotalCents: delta.rejectedCents ?? 0n,
        pendingCount: delta.pendingDelta ?? 0,
      },
    });
  }

  async resetTotals(companyId: string, totals: CompanyTotals): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
      create: {
        companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      companyId: string;
      workerId: string;
      workerName: string;
      eventId: string;
      eventTitle: string;
      eventLocation: string;
      status: string;
      amountCents: number;
      createdAt: Date;
    }>>`
      SELECT
        po.id AS "id",
        po.company_id AS "companyId",
        po.worker_id AS "workerId",
        w.name AS "workerName",
        po.event_id AS "eventId",
        e.title AS "eventTitle",
        e.location AS "eventLocation",
        po.status AS "status",
        po.amount_cents AS "amountCents",
        po.created_at AS "createdAt"
      FROM payment_orders po
      JOIN workers w ON w.id = po.worker_id
      JOIN events e ON e.id = po.event_id
      WHERE po.created_at >= ${from} AND po.created_at < ${to}
    `;

    return rows.map((row) => ({
      ...row,
      status: row.status as OrderStatus,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      workerId: row.workerId,
      workerName: row.workerName,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      eventLocation: row.eventLocation,
      status: row.status,
      amountCents: row.amountCents,
      createdAt: row.createdAt,
    }));
  }

  async deleteProjectionWindow(from: Date, to: Date): Promise<number> {
    const result = await this.prisma.operationReadModel.deleteMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });
    return result.count;
  }

  async bulkUpsert(rows: OperationRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.operationReadModel.upsert({
          where: { id: row.id },
          update: {
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
          create: {
            id: row.id,
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
        });
      }
    });
  }

  async getTotals(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });

    if (!row) return null;

    return {
      companyId: row.companyId,
      approvedTotalCents: row.approvedTotalCents,
      rejectedTotalCents: row.rejectedTotalCents,
      pendingCount: row.pendingCount,
    };
  }
}
```

Wait, I need to double-check the Prisma model names. The plan says:
- `@@map("payment_orders")` - so the table is `payment_orders`, the model name in Prisma would be whatever is defined. Typically it'd be `PaymentOrder`.
- `@@map("operation_read_models")` - table is `operation_read_models`, model would be `OperationReadModel`.
- `@@map("company_financial_totals")` - table is `company_financial_totals`, model would be `CompanyFinancialTotal`.

For Prisma client property access, you use the model name (camelCase). So:
- `this.prisma.operationReadModel` ✓
- `this.prisma.companyFinancialTotal` ✓

These look correct.

One thing I want to verify: the `status` field in the Prisma model. The plan says `status | OrderStatus` - so it's a Prisma enum field. When I do `findMany`, the returned `status` will be of type `OrderStatus` (the Prisma enum). When I do raw SQL, it comes back as a string.

For `fetchProjectionWindow`, the `row.status` from Prisma will already be typed as `OrderStatus`, so I don't need a cast. Good.

For the raw SQL in `fetchSourceWindow`, I need to cast `row.status as OrderStatus`. Good.

Let me also verify: does the plan mention anything about the `updated_at` field in the projection table? Yes: `updated_at | DateTime @updatedAt @map("updated_at") | When projection last touched`. Since it's `@updatedAt`, Prisma handles it automatically - I don't need to set it in my upsert/update calls.

I think the file looks good. Let me also make sure I'm not missing any method from the plan's interface:

1. ✓ `upsertOrder(order: OperationRow): Promise<void>`
2. ✓ `updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>`
3. ✓ `adjustTotals(companyId: string, delta: {...}): Promise<void>`
4. ✓ `resetTotals(companyId: string, totals: CompanyTotals): Promise<void>`
5. ✓ `fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]>`
6. ✓ `fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]>`
7. ✓ `deleteProjectionWindow(from: Date, to: Date): Promise<number>`
8. ✓ `bulkUpsert(rows: OperationRow[]): Promise<void>`
9. ✓ `getTotals(companyId: string): Promise<CompanyTotals | null>`

All methods are present. Let me finalize the file.

One more thought: should I use `@Injectable()` from NestJS? Yes, this is a NestJS application and the repository will be provided in the module. The `@Injectable()` decorator is needed for DI to work.

Also, I should check: the plan says `constructor(prisma: PrismaClient)`. In NestJS, for constructor injection to work with a raw `PrismaClient` type, you'd typically need either:
1. A `PrismaService` that extends `PrismaClient` and is provided
2. An injection token

But the plan explicitly states `constructor(prisma: PrismaClient)`, so I'll follow that. The module setup (which is in a different file) will handle the actual DI wiring.

I'm satisfied with the implementation. Let me write the final version.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OperationRow, OrderStatus, CompanyTotals } from './projections.types';

@Injectable()
export class ProjectionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOrder(order: OperationRow): Promise<void> {
    await this.prisma.operationReadModel.upsert({
      where: { id: order.id },
      update: {
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
      create: {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    await this.prisma.operationReadModel.update({
      where: { id: orderId },
      data: { status },
    });
  }

  async adjustTotals(
    companyId: string,
    delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number },
  ): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: { increment: delta.approvedCents ?? 0n },
        rejectedTotalCents: { increment: delta.rejectedCents ?? 0n },
        pendingCount: { increment: delta.pendingDelta ?? 0 },
      },
      create: {
        companyId,
        approvedTotalCents: delta.approvedCents ?? 0n,
        rejectedTotalCents: delta.rejectedCents ?? 0n,
        pendingCount: delta.pendingDelta ?? 0,
      },
    });
  }

  async resetTotals(companyId: string, totals: CompanyTotals): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
      create: {
        companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      companyId: string;
      workerId: string;
      workerName: string;
      eventId: string;
      eventTitle: string;
      eventLocation: string;
      status: string;
      amountCents: number;
      createdAt: Date;
    }>>`
      SELECT
        po.id AS "id",
        po.company_id AS "companyId",
        po.worker_id AS "workerId",
        w.name AS "workerName",
        po.event_id AS "eventId",
        e.title AS "eventTitle",
        e.location AS "eventLocation",
        po.status AS "status",
        po.amount_cents AS "amountCents",
        po.created_at AS "createdAt"
      FROM payment_orders po
      JOIN workers w ON w.id = po.worker_id
      JOIN events e ON e.id = po.event_id
      WHERE po.created_at >= ${from} AND po.created_at < ${to}
    `;

    return rows.map((row) => ({
      ...row,
      status: row.status as OrderStatus,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      workerId: row.workerId,
      workerName: row.workerName,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      eventLocation: row.eventLocation,
      status: row.status,
      amountCents: row.amountCents,
      createdAt: row.createdAt,
    }));
  }

  async deleteProjectionWindow(from: Date, to: Date): Promise<number> {
    const result = await this.prisma.operationReadModel.deleteMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });
    return result.count;
  }

  async bulkUpsert(rows: OperationRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.operationReadModel.upsert({
          where: { id: row.id },
          update: {
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
          create: {
            id: row.id,
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
        });
      }
    });
  }

  async getTotals(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });

    if (!row) return null;

    return {
      companyId: row.companyId,
      approvedTotalCents: row.approvedTotalCents,
      rejectedTotalCents: row.rejectedTotalCents,
      pendingCount: row.pendingCount,
    };
  }
}
```
