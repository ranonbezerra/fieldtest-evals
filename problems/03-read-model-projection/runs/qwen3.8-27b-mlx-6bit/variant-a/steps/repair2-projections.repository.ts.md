# repair2-projections.repository.ts

## reasoning

```
Let me analyze the compiler errors that pertain to `src/projections/projections.repository.ts`:

1. `src/projections/projections.repository.ts(3,58): error TS2307: Cannot find module './projections.types' or its corresponding type declarations.`

This is the only error directly in `projections.repository.ts`. It's importing from `./projections.types` which doesn't exist yet.

Now, looking at the other errors, they reference `projections.repository` being imported by:
- `src/projections/projections.module.ts(3,39): error TS2307: Cannot find module './projections.repository'`
- `src/projections/projections.service.ts(2,39): error TS2307: Cannot find module './projections.repository'`

So the repository file needs to export something that the module and service can import.

The task says "Rewrite `src/projections/projections.repository.ts` complete, fixing what these messages require of this file."

The only error IN the file is:
- Line 3, column 58: Cannot find module `./projections.types`

So the file exists but has a broken import to `./projections.types`. I need to write the complete file such that:
1. The import of `./projections.types` is valid (meaning `projections.types.ts` must exist with the right exports)
2. The file must export what `projections.module.ts` and `projections.service.ts` expect

Wait, but the task says "Change nothing the messages do not name." The messages only name `src/projections/projections.repository.ts` as needing a rewrite. But the error is that `./projections.types` cannot be found.

Hmm, but the task says "Rewrite `src/projections/projections.repository.ts` complete, fixing what these messages require of this file." So I need to fix the errors that are IN this file. The only error in this file is the missing `./projections.types` module.

But wait - if I just write the file with a valid import to `./projections.types`, the error will still be there because `projections.types.ts` doesn't exist. The task says to fix what "these messages require of this file." 

Let me re-read: "Rewrite `src/projections/projections.repository.ts` complete, fixing what these messages require of this file."

I think the intent is: write the complete file so that it compiles. The error `Cannot find module './projections.types'` means I need to make sure that import resolves. Since I can only modify this one file, I have two options:
1. Import the types from somewhere else (but the plan says they should be in `projections.types.ts`)
2. Define the types inline in this file

Wait, but the task says "Change nothing the messages do not name." The messages DO name `projections.repository.ts` as having an error. The fix for the error in THIS file is to make the import work. But if `projections.types.ts` doesn't exist, I can't fix it from this file alone...

Unless I define the types locally in this file and export them. But that would conflict with the plan which has a separate `projections.types.ts`.

Actually, re-reading more carefully: "fixing what these messages require of this file" - I think the intent is that I should write the complete correct file. The `Cannot find module './projections.types'` error will be resolved when `projections.types.ts` is created (by another task/file). So I should write the file assuming `projections.types.ts` exists with the types defined in the plan.

But wait - the task says "Reply with the complete content of `src/projections/projections.repository.ts` inside one fenced block, and nothing else." So I'm only producing this one file.

Let me look at what the plan specifies for `ProjectionsRepository`:

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

Now, looking at the other errors more carefully:

- `src/projections/projections.service.ts(2,39): error TS2307: Cannot find module './projections.repository'` - This means the service imports from this file.
- `src/projections/projections.module.ts(3,39): error TS2307: Cannot find module './projections.repository'` - The module imports from this file.

So this file needs to export `ProjectionsRepository`.

Now, the key question: should I import types from `./projections.types` or define them inline?

Given the plan, the types are in `projections.types.ts`. The error says that module can't be found - but that's because the file doesn't exist yet (it will be created separately). The task says to fix "what these messages require of this file" - the message requires that the import be valid. Since I'm told to keep the plan and not drop requirements, I should keep the import from `./projections.types`.

But actually wait - let me re-read the instruction: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The types are defined in the PLAN.md which I can see. So I know the shapes. I should import them from `./projections.types` as the plan specifies.

Let me now write the complete file based on the plan:

```typescript
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
    // Use a transaction with raw SQL for atomic increment
    await this.prisma.$transaction(async (tx) => {
      // We need to do atomic updates. Since Prisma doesn't support atomic increments easily,
      // we'll use raw query for the increment part.
      
      // Actually, let me think about this differently. We can use updateMany with a computed value,
      // but that's not atomic either. The safest approach is to use $executeRaw with SQL increment.
      
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (delta.approvedCents && delta.approvedCents !== 0n) {
        updates.push(`approved_total_cents = approved_total_cents + $${paramIndex}`);
        params.push(delta.approvedCents.toString());
        paramIndex++;
      }
      if (delta.rejectedCents && delta.rejectedCents !== 0n) {
        updates.push(`rejected_total_cents = rejected_total_cents + $${paramIndex}`);
        params.push(delta.rejectedCents.toString());
        paramIndex++;
      }
      if (delta.pendingDelta && delta.pendingDelta !== 0) {
        updates.push(`pending_count = pending_count + $${paramIndex}`);
        params.push(delta.pendingDelta);
        paramIndex++;
      }

      if (updates.length === 0) return;

      // First try to update existing row
      const setClause = updates.join(', ');
      const result = await tx.$executeRaw`
        UPDATE company_financial_totals 
        SET ${Prisma.sql(setClause)} 
        WHERE company_id = ${companyId}
      `;

      // If no row was updated, create one
      if (result === 0) {
        // Calculate the values to insert
        const approved = delta.approvedCents ?? 0n;
        const rejected = delta.rejectedCents ?? 0n;
        const pending = delta.pendingDelta ?? 0;

        await tx.companyFinancialTotal.create({
          data: {
            companyId,
            approvedTotalCents: approved,
            rejectedTotalCents: rejected,
            pendingCount: pending,
          },
        });
      }
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
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
      include: {
        worker: true,
        event: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.worker.name,
      eventId: r.eventId,
      eventTitle: r.event.title,
      eventLocation: r.event.location,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    return this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });
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
    // Prisma doesn't have a native upsertMany, so we do it in a transaction
    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.operationReadModel.upsert({
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
        }),
      ),
    );
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

Wait, I need to think about the Prisma model names. Based on the plan:
- `operation_read_models` → Prisma model would be `OperationReadModel` (camelCase of table name with `@@map`)
- `company_financial_totals` → Prisma model would be `CompanyFinancialTotal`
- `payment_orders` → Prisma model would be `PaymentOrder`
- `workers` → Prisma model would be `Worker`
- `events` → Prisma model would be `Event`

Actually, in Prisma, the model name in the schema defines the client property. If the model is defined as `model OperationReadModel { ... @@map("operation_read_models") }`, then in the Prisma client it would be `prisma.operationReadModel`.

Let me also think about the `fetchSourceWindow` method. The plan says it reads from source tables with JOINs. In Prisma, if we define relations between `PaymentOrder` → `Worker` and `PaymentOrder` → `Event`, we can use `include`. But if the source tables are "pre-existing" and we're just defining them in the schema for Prisma, we need to make sure relations are defined.

Looking at the plan's data model:
- `payment_orders` has `company_id`, `worker_id`, `event_id`
- `workers` has `id`, `name`, `company_id`
- `events` has `id`, `title`, `location`

For Prisma relations to work, we need relation fields. Since I'm only writing the repository file, I'll assume the schema has proper relations defined (as the plan implies).

Actually, wait. Let me reconsider. The plan says "Source tables (pre-existing, defined in schema for Prisma)". This means the schema.prisma will have these models. The relations between them need to be defined in the schema. Since I'm only writing the repository, I'll assume the schema has:
- `PaymentOrder` with relations to `Worker` and `Event`
- The Prisma client will support `include: { worker: true, event: true }`

But actually, looking more carefully at the plan, it doesn't explicitly define relation fields in the Prisma models. It just has foreign key columns. In Prisma, you need both the scalar field (e.g., `workerId String`) AND the relation field (e.g., `worker Worker @relation(fields: [workerId], references: [id])`).

Since the plan defines the schema and I'm only writing the repository, I'll assume the relations are properly defined in the schema. If they aren't, `include` won't work and I'd need to do separate queries or raw SQL.

Actually, let me reconsider the approach. The plan says `fetchSourceWindow` "Reads source tables; returns joined rows for the given window." This could be done with:
1. Prisma `include` (if relations are defined)
2. Raw SQL with JOINs

Given that the plan's schema section doesn't explicitly show relation fields, and to be safe, maybe I should use raw SQL for the source window fetch. But that feels wrong given we're using Prisma.

Let me go with `include` and add an ASSUMPTION comment if needed. Actually, the plan clearly shows the data model with foreign keys, and in a proper Prisma schema you'd have relations. I'll use `include` and assume the schema defines them.

Now, about the `adjustTotals` method - the key requirement from the plan is: "Concurrent updates to one company's totals" must work correctly. The test says "Totals remain exact under concurrent writes (no lost updates)."

Using `UPDATE ... SET col = col + delta` is the atomic way to do this in SQL. Prisma's `update` with a computed value won't be atomic (it reads then writes). So I need to use raw SQL or a transaction with SELECT FOR UPDATE.

Actually, Prisma does support this pattern with `$executeRaw`. Let me use that approach for the increment.

But wait - there's a subtlety. If the row doesn't exist yet (first order for a company), we need to create it. The pattern would be:
1. Try UPDATE (atomic increment)
2. If 0 rows affected, try INSERT
3. If INSERT fails (unique violation), retry UPDATE

Or we could use `INSERT ... ON CONFLICT ... DO UPDATE` which is atomic.

Let me use raw SQL for this:

```sql
INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
VALUES ($1, $2, $3, $4)
ON CONFLICT (company_id) DO UPDATE SET
  approved_total_cents = company_financial_totals.approved_total_cents + EXCLUDED.approved_total_cents,
  rejected_total_cents = company_financial_totals.rejected_total_cents + EXCLUDED.rejected_total_cents,
  pending_count = company_financial_totals.pending_count + EXCLUDED.pending_count;
```

This is atomic and handles both insert and update cases. The `EXCLUDED` keyword refers to the values that would have been inserted.

Wait, but if I'm using `$executeRaw`, I need to be careful with BigInt parameters. Prisma's `$executeRaw` should handle bigint as a string or number.

Actually, let me think about this differently. The plan says the service calls `adjustTotals` inside a transaction (same `$transaction` as the source write). So the transaction is managed by the service, not the repository. But the repository method itself needs to be atomic.

Hmm, but if the caller is already in a transaction and passes a transaction client... Actually, looking at the plan again:

"applyOrderStatusChanged must execute after the source write commits (same transaction). The projection row is updated, then totals are adjusted — both in one prisma.$transaction."

So the transaction wraps both the source write AND the projection updates. The repository methods would be called with the transaction client.

Wait, but in the plan's signatures:
```ts
class ProjectionsRepository {
  constructor(prisma: PrismaClient);
  ...
}
```

It takes `PrismaClient` directly. But if we need to use a transaction client, the methods would need to accept an optional transaction client parameter.

Actually, looking at how NestJS + Prisma transactions typically work: the service opens a `$transaction` and passes the `tx` client to the repository methods. But the plan's signature shows the repository just takes `PrismaClient` in the constructor.

Let me look at this more carefully. In Prisma, `PrismaClient` and the transaction client (`Prisma.TransactionClient`) are structurally compatible for most operations. So I could type the constructor parameter as `PrismaClient` and it would work with both.

Actually, in Prisma, `prisma.$transaction(async (tx) => { ... })` gives you a `Prisma.TransactionClient` which has the same interface as `PrismaClient` for model operations. So if the service does:

```ts
await this.prisma.$transaction(async (tx) => {
  // source write
  await tx.paymentOrder.update(...)
  // projection update
  await this.projectionsRepository.upsertOrder(tx, order);
});
```

But the plan's repository methods don't take a `tx` parameter. They just take the data. So either:
1. The repository methods accept an optional `tx` parameter
2. The service handles the transaction and the repository just uses the injected `PrismaClient`

If option 2, then the repository operations would be outside the transaction, which contradicts the plan's requirement that everything is in one transaction.

I think the cleanest approach given the plan is: the repository methods should accept an optional Prisma client (transaction client) parameter. But the plan's signatures don't show this...

Let me re-read the plan: "applyOrderStatusChanged must execute after the source write commits (same transaction)."

Hmm, "after the source write commits" but "same transaction"? That's contradictory. If it's in the same transaction, it hasn't committed yet when the projection is updated. I think they mean "after the source write is issued (within the same transaction)."

OK, I think the practical approach is:
- The `ProjectionsService` methods like `applyOrderCreated` and `applyOrderStatusChanged` are called within a transaction
- The service methods take an optional transaction client or the repository methods do

Actually, you know what, let me just look at what makes sense for the code to compile and work. The key constraint is:
1. The file must compile (fix the `./projections.types` import)
2. It must follow the plan's signatures
3. It must be correct for the concurrency requirements

For the concurrency requirement, `adjustTotals` MUST use atomic SQL. I'll use `$executeRaw` with an `INSERT ... ON CONFLICT DO UPDATE` pattern.

For the transaction concern, I'll add an optional `tx` parameter to methods that need it, or I'll just use the injected client. Since the plan's signatures don't show a `tx` parameter, and the task says "Do not drop a requirement to silence an error" and "Change nothing the messages do not name," I should stick with the plan's signatures.

But wait - if the repository uses `this.prisma` (the injected client) and the service wraps everything in a `$transaction`, then the repository operations would be OUTSIDE the transaction. That's a problem for correctness.

I think the solution is: the repository methods should accept an optional `Prisma.TransactionClient` parameter that defaults to `this.prisma`. This is a common pattern. The plan doesn't explicitly show this, but it's implied by the transaction requirement.

Actually, let me re-read the task constraints: "Change nothing the messages do not name." The compiler messages don't say anything about the signatures being wrong. They only say the module can't be found. So I should keep the plan's signatures as close as possible.

But if I keep the exact signatures from the plan (no `tx` parameter), then the concurrency tests will fail because operations won't be atomic. The plan REQUIRES atomicity ("Totals remain exact under concurrent writes (no lost updates)").

I think the right approach is to add an optional `tx` parameter. The plan's signatures are a sketch, and the implementation detail of passing the transaction client is necessary for correctness. I won't add an ASSUMPTION comment because this isn't about a shape I can't see - it's a standard implementation detail.

Actually wait, let me re-read: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one // ASSUMPTION: line saying what you could not reconcile."

The compiler errors don't require me to change the signatures. The only error in this file is the missing module. So I should keep the plan's signatures exactly and just fix the import. The concurrency issue is a runtime concern, not a compile-time one.

But... if I use `this.prisma` for all operations and the service wraps things in a transaction, the repository operations won't be in that transaction. The concurrency tests WILL fail at runtime.

I think the practical solution is: use `$executeRaw` for `adjustTotals` (which is atomic regardless of transaction context because it's a single SQL statement with `ON CONFLICT`), and for other methods, accept that they'll be called within a transaction by the service (the service will pass the tx client somehow).

Actually, you know what, let me just look at this pragmatically. The Prisma client's methods (like `upsert`, `update`, etc.) can be called on either the main client or a transaction client. If I type the constructor as `PrismaClient`, and the service creates a transaction and calls methods on the repository, those methods will use `this.prisma` (the main client), not the transaction client.

The standard pattern in NestJS + Prisma is either:
1. Pass the transaction client to each method
2. Use `PrismaClient` in the constructor and rely on the fact that for single operations, atomicity is sufficient (each Prisma operation is its own transaction)

For `adjustTotals`, using a single atomic SQL statement (`INSERT ... ON CONFLICT DO UPDATE SET col = table.col + excluded.col`) means it's atomic even without an outer transaction. This solves the concurrency problem for totals.

For `upsertOrder` and `updateOrderStatus`, each is a single Prisma operation which is atomic by itself. The issue would only be if we need both `upsertOrder` AND `adjustTotals` to be in the same transaction (all-or-nothing). But for the concurrency tests, what matters is that the totals are correct, and the `INSERT ... ON CONFLICT` pattern guarantees that.

So my approach:
- `adjustTotals`: Use `$executeRaw` with atomic SQL (INSERT ON CONFLICT)
- Other methods: Use `this.prisma` directly (each operation is atomic individually)

This should satisfy the compiler AND the concurrency requirements.

Let me also think about what `Prisma.sql` is and whether I need it. For the `adjustTotals` method, I'll construct the SQL carefully.

Actually, for simplicity and correctness, let me just use a single `INSERT ... ON CONFLICT` statement:

```sql
INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
VALUES ($1, $2, $3, $4)
ON CONFLICT (company_id) DO UPDATE SET
  approved_total_cents = company_financial_totals.approved_total_cents + $5,
  rejected_total_cents = company_financial_totals.rejected_total_cents + $6,
  pending_count = company_financial_totals.pending_count + $7;
```

Where $2, $3, $4 are the initial values (for new rows) and $5, $6, $7 are the deltas (for existing rows). In practice, for a new row, the initial values ARE the deltas. For an existing row, we add the deltas to the current values.

So I can just use the same delta values for both:
- If inserting: the row gets the delta values directly
- If updating: the row's columns are incremented by the delta values

This works perfectly!

```sql
INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
VALUES ($1, $2::bigint, $3::bigint, $4)
ON CONFLICT (company_id) DO UPDATE SET
  approved_total_cents = company_financial_totals.approved_total_cents + $2::bigint,
  rejected_total_cents = company_financial_totals.rejected_total_cents + $3::bigint,
  pending_count = company_financial_totals.pending_count + $4;
```

Wait, but `$2` is used twice. In parameterized queries, you can reuse parameters. Let me check if Prisma's `$executeRaw` supports this... Actually with tagged template literals, each interpolation is a separate parameter. So I'd need to repeat the value.

Let me use the tagged template literal syntax:

```ts
await this.prisma.$executeRaw`
  INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
  VALUES (${companyId}, ${approvedCents}, ${rejectedCents}, ${pendingDelta})
  ON CONFLICT (company_id) DO UPDATE SET
    approved_total_cents = company_financial_totals.approved_total_cents + ${approvedCents},
    rejected_total_cents = company_financial_totals.rejected_total_cents + ${rejectedCents},
    pending_count = company_financial_totals.pending_count + ${pendingDelta}
`;
```

This should work. Each `${}` becomes a separate parameter in the query.

Now, for BigInt values in Prisma's `$executeRaw`, I need to check how they're handled. Prisma typically handles BigInt as a string for PostgreSQL. Let me convert them to strings or use `BigInt` directly - Prisma should handle it.

Actually, looking at Prisma docs, for `$executeRaw` with BigInt values in PostgreSQL, you should pass them as strings or use `Prisma.sql` helpers. But in practice, passing a `bigint` value in a tagged template should work because Prisma's query engine handles the type conversion.

Let me just pass them directly and see. If there's an issue, I'd need to cast in SQL.

Now let me write the complete file:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CompanyTotals, OperationRow, OrderStatus } from './projections.types';

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
    const approved = delta.approvedCents ?? 0n;
    const rejected = delta.rejectedCents ?? 0n;
    const pending = delta.pendingDelta ?? 0;

    await this.prisma.$executeRaw`
      INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
      VALUES (${companyId}, ${approved}, ${rejected}, ${pending})
      ON CONFLICT (company_id) DO UPDATE SET
        approved_total_cents = company_financial_totals.approved_total_cents + ${approved},
        rejected_total_cents = company_financial_totals.rejected_total_cents + ${rejected},
        pending_count = company_financial_totals.pending_count + ${pending}
    `;
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
        companyId: totals.companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
      include: {
        worker: true,
        event: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.worker.name,
      eventId: r.eventId,
      eventTitle: r.event.title,
      eventLocation: r.event.location,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.workerName,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventLocation: r.eventLocation,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
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

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.operationReadModel.upsert({
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
        }),
      ),
    );
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

Wait, I need to double-check: does the plan say `fetchProjectionWindow` should return `OperationRow[]`? Looking at the plan:

```
/** Reads projection rows for the given window (by `createdAt`). */
fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]>;
```

Yes. And the projection table has the same fields as `OperationRow` (plus `updatedAt` which we can ignore).

Now, one concern: the `include: { worker: true, event: true }` in `fetchSourceWindow`. This requires that the Prisma schema has relations defined between `PaymentOrder` and `Worker`, and between `PaymentOrder` and `Event`. The plan's data model section shows the columns but not explicit relation fields. However, for the code to work at runtime, these relations must exist in the schema.

Since I'm only writing the repository file and the schema is a separate file, I'll assume the relations are defined. If they're not, this will be a runtime error, not a compile-time error. The compiler errors I'm fixing are only about the missing module import.

Let me also check: the `status` field in the Prisma model is an enum `OrderStatus`. When Prisma returns it, it'll be a string value of the enum. The `as OrderStatus` cast should be fine since the Prisma enum type is compatible with our string union type.

Actually, wait. In Prisma, if you define:
```prisma
enum OrderStatus {
  pending
  approved
  rejected
}
```

Then the generated type is `OrderStatus` (a union of literals). Our `projections.types.ts` also defines `OrderStatus` as `'pending' | 'approved' | 'rejected'`. These should be compatible.

But there might be a naming conflict. If I import `OrderStatus` from `./projections.types` and Prisma also exports an `OrderStatus` type, there could be a conflict. But since I'm only importing from `./projections.types` and not from `@prisma/client` (except for `PrismaClient`), there shouldn't be a conflict.

Actually, I do import `Prisma` from `@prisma/client` in case I need it... but I don't think I actually use it. Let me remove that import if I don't need it.

Looking at my code, I don't use `Prisma` directly. I only use `PrismaClient`. So the import should be:
```ts
import { PrismaClient } from '@prisma/client';
```

Let me finalize the file. I think it's ready. Let me also make sure the `fetchProjectionWindow` return type mapping is correct - the Prisma model `OperationReadModel` has fields that map directly to `OperationRow`.

One more thought: the `status` field. In the Prisma model, it's typed as the `OrderStatus` enum. When returned by Prisma, it'll be of type `OrderStatus` (the Prisma-generated enum). Our local `OrderStatus` type is `'pending' | 'approved' | 'rejected'`. These should be structurally compatible, so no cast needed. But to be safe and explicit, I'll keep the `as OrderStatus` cast.

Actually, if the Prisma enum and our type are structurally identical (both are `'pending' | 'approved' | 'rejected'`), the cast is unnecessary but harmless. I'll keep it for clarity.

Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CompanyTotals, OperationRow, OrderStatus } from './projections.types';

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
    const approved = delta.approvedCents ?? 0n;
    const rejected = delta.rejectedCents ?? 0n;
    const pending = delta.pendingDelta ?? 0;

    await this.prisma.$executeRaw`
      INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
      VALUES (${companyId}, ${approved}, ${rejected}, ${pending})
      ON CONFLICT (company_id) DO UPDATE SET
        approved_total_cents = company_financial_totals.approved_total_cents + ${approved},
        rejected_total_cents = company_financial_totals.rejected_total_cents + ${rejected},
        pending_count = company_financial_totals.pending_count + ${pending}
    `;
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
        companyId: totals.companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  // ASSUMPTION: The Prisma schema defines relation fields (worker, event) on PaymentOrder
  // so that `include` can be used for the source-window join.

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
      include: {
        worker: true,
        event: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.worker.name,
      eventId: r.eventId,
      eventTitle: r.event.title,
      eventLocation: r.event.location,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.workerName,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventLocation: r.eventLocation,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
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

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.operationReadModel.upsert({
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
        }),
      ),
    );
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
