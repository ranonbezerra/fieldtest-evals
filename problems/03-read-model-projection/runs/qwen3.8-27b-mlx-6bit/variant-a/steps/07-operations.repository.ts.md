# 07-operations.repository.ts

## reasoning

```
Let me analyze the plan carefully to understand what `operations.repository.ts` needs to contain.

From the plan's types and signatures section:

```ts
export class OperationsRepository {
  constructor(prisma: PrismaClient) {}

  // Projection maintenance (called inside a transaction)
  upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;

  // Dashboard read
  queryDashboard(query: DashboardQuery): Promise<DashboardResult>;

  // Aggregate maintenance (called inside a transaction)
  upsertCompanyTotal(tx: PrismaPromise, companyId: string, deltaAmount: string, deltaCount: number): Promise<void>;

  // Source reads (for re-derivation and drift-repair)
  findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>;
  findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null>;
  findLastEventForOrder(orderId: string): Promise<string | null>;

  // Drift-repair comparison
  findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]>;

  // Read-your-own-writes: single-order fetch from projection
  getOperationByOrderId(orderId: string): Promise<OperationRow | null>;

  // Totals read
  getCompanyTotal(companyId: string): Promise<CompanyTotals | null>;
}
```

Now let me think about the Prisma schema. The tables are:
- `payment_orders` (source)
- `events` (source)
- `workers` (source)
- `operations` (projection)
- `company_financial_totals` (aggregate)

The Prisma models would be named in PascalCase: `PaymentOrder`, `Event`, `Worker`, `Operation`, `CompanyFinancialTotal`.

With `@@map` and `@map` for snake_case table/column names.

Now, the plan says:
- `upsertOperation(tx: PrismaPromise, ...)` - this is tricky. In Prisma, interactive transactions give you a `Prisma.TransactionClient`, not a `PrismaPromise`. The plan uses `tx: PrismaPromise` which is actually the type of a function inside `$transaction`. Let me re-read...

Actually, looking more carefully at the plan signature: `tx: PrismaPromise` - this is likely a typo or simplification. In Prisma, when you use `prisma.$transaction(async (tx) => { ... })`, the `tx` parameter is of type `Prisma.TransactionClient`. But the plan explicitly says `tx: PrismaPromise`.

Wait, let me re-read the plan. It says:
```
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
```

Hmm, `PrismaPromise` is a type in Prisma that represents a thenable. But in the context of interactive transactions, you'd pass `Prisma.TransactionClient`. However, the plan explicitly says `PrismaPromise`. Let me just follow the plan literally since it's my specification.

Actually wait - in newer versions of Prisma, `PrismaPromise` is indeed exported and can be used as a type. But for interactive transactions, the client passed is `Prisma.TransactionClient`. Let me think about this...

Actually, I think the plan might be using `PrismaPromise` loosely to mean "the transaction client" - but since the plan is my specification and it says `tx: PrismaPromise`, I should follow it. However, this would be problematic because you can't call `.operation.upsert()` on a `PrismaPromise`. 

Let me reconsider. In Prisma, `$transaction` with a callback gives you `Prisma.TransactionClient`. The type `PrismaPromise<T>` is `Thenable<T>` essentially. 

I think the most defensible reading is that `tx` should be typed as `Prisma.TransactionClient` since that's what you actually pass to these methods inside a transaction. But the plan says `PrismaPromise`. 

Actually, re-reading the plan more carefully: "simulates the write path" and "inside a single Prisma interactive transaction". The `tx` parameter is what you get inside `$transaction(async (tx) => ...)`. In Prisma 5+, that's `Prisma.TransactionClient`.

I'll use `Prisma.TransactionClient` as the type since that's the actual Prisma type for what you get in an interactive transaction. The plan's `PrismaPromise` is likely a shorthand/simplification. Actually no - the plan IS my specification. Let me just use what it says.

Hmm, but `PrismaPromise` doesn't have the model delegates on it. You can't do `tx.operation.upsert(...)` if `tx` is a `PrismaPromise`. This would be a type error.

I think the most defensible reading is to use `Prisma.TransactionClient` since that's what actually works and the plan's intent is clearly "the transaction client". I'll add an ASSUMPTION comment.

Wait, actually let me reconsider. Maybe the plan means that the repository methods receive a PrismaClient-like object (which is what TransactionClient is). Let me just use `Prisma.TransactionClient` and note it.

Now let me think about the actual implementation:

1. **upsertOperation**: Upsert into `operations` table using `order_id` as the key.
   - Fields: order_id, company_id, status, amount, currency, worker_name, worker_role, last_event_type, created_at, updated_at
   - For create: set all fields
   - For update: set company_id, status, amount, currency, worker_name, worker_role, last_event_type, updated_at

2. **queryDashboard**: 
   - SELECT from `operations` with filters
   - WHERE company_id, optional status, optional date range
   - ORDER BY created_at DESC, order_id DESC
   - OFFSET/LIMIT
   - COUNT with same WHERE

3. **upsertCompanyTotal**: 
   - Upsert into `company_financial_totals` using company_id as key
   - Delta-based: add deltaAmount to total_amount, add deltaCount to order_count

4. **findOrdersByWindow**: SELECT from payment_orders WHERE created_at BETWEEN from AND to, ORDER BY created_at ASC

5. **findWorkerById**: SELECT from workers WHERE id = ?

6. **findLastEventForOrder**: SELECT from events WHERE order_id = ?, ORDER BY created_at DESC, LIMIT 1

7. **findProjectionByWindow**: SELECT from operations WHERE updated_at BETWEEN from AND to

8. **getOperationByOrderId**: SELECT from operations WHERE order_id = ?

9. **getCompanyTotal**: SELECT from company_financial_totals WHERE company_id = ?

Now for the Prisma model names - since we're using `@@map`, the Prisma model names are PascalCase but table names are snake_case:
- Model: `Operation`, table: `operations`
- Model: `PaymentOrder`, table: `payment_orders`
- Model: `Event`, table: `events`
- Model: `Worker`, table: `workers`
- Model: `CompanyFinancialTotal`, table: `company_financial_totals`

Column names with `@map`:
- `order_id` → Prisma field: `orderId`
- `company_id` → Prisma field: `companyId`
- etc.

Wait, but the types in `operations.types.ts` use snake_case field names like `order_id`, `company_id`. This means either:
1. The Prisma fields are named in snake_case (no `@map` on individual fields, only `@@map` on tables)
2. Or the repository maps between Prisma's camelCase and the types' snake_case

Looking at the conventions: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)."

So columns in the DB are snake_case, mapped via `@map`. The Prisma field names would be camelCase. But the types use snake_case...

This means the repository needs to map between Prisma's camelCase field names and the snake_case types. OR, the Prisma fields could be named in snake_case without `@map` (since the column names would match). But the convention says "via Prisma @map/@@map" which implies the Prisma fields are NOT snake_case.

Actually, re-reading: "Table and column: snake_case (via Prisma @map/@@map)." This means the DB columns are snake_case, achieved through `@map` (for columns) and `@@map` (for tables). The Prisma field names would be the default (camelCase or whatever you name them in the schema).

But looking at the types file, it uses snake_case field names. So either:
1. The Prisma schema uses snake_case field names directly (no `@map` needed for individual fields since the field name matches the column)
2. Or there's mapping in the repository

Given the convention says "via Prisma @map/@@map", I think the intent is:
- Table names in schema: `model Operation` with `@@map("operations")`
- Column names: field `orderId` with `@map("order_id")`

But then the types would need mapping... unless the repository returns objects with snake_case keys.

Actually, you know what, I think the simplest and most consistent reading is:
- Prisma model fields use camelCase (standard Prisma convention)
- `@map` maps them to snake_case columns
- The repository maps Prisma results to the snake_case types

Let me go with this approach. The repository will need to map field names.

Actually wait - let me reconsider. If I look at the types:
```ts
export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}
```

And the plan says the repository returns `OperationRow`. So the repository must produce objects with these exact keys.

For Prisma, if the model is:
```prisma
model Operation {
  orderId    String   @id @map("order_id")
  companyId  String   @map("company_id")
  status     String
  amount     Decimal
  currency   String
  workerName String   @map("worker_name")
  workerRole String   @map("worker_role")
  lastEventType String? @map("last_event_type")
  createdAt  DateTime @map("created_at")
  updatedAt  DateTime @map("updated_at")
  
  @@map("operations")
}
```

Then Prisma returns objects with keys: `orderId`, `companyId`, `status`, `amount`, `currency`, `workerName`, `workerRole`, `lastEventType`, `createdAt`, `updatedAt`.

I need to map these to the snake_case types in the repository.

For `DashboardQuery`, it uses `company_id`, `date_from`, `date_to`, `page`, `page_size`. The repository receives this and maps to Prisma queries.

For `SimulateWriteInput`, it uses `order_id`, `company_id`, `worker_id`, `status`, `amount`, `currency`.

OK let me now write the repository. Let me think about each method:

**upsertOperation(tx, order, worker, lastEventType)**:
- `order` is `SimulateWriteInput` with snake_case fields
- `worker` has `{ name: string; role: string }`
- Need to upsert into `operations` by `order_id`
- For create: set all fields including created_at (from order... but SimulateWriteInput doesn't have created_at)

Hmm, `SimulateWriteInput` has: order_id, company_id, worker_id, status, amount, currency. No created_at.

But the `operations` table has `created_at` which comes from `payment_orders.created_at`. So for an insert, we'd need to get the created_at from the payment_order that was just upserted.

Wait, looking at the control flow for simulateWrite:
"3. Upsert the `payment_orders` row (insert or update by `order_id`)."
"5. Upsert the `operations` projection row with denormalised fields from steps 3–4."

So after upserting the payment_order, we'd have its created_at. But the `upsertOperation` signature only takes `SimulateWriteInput` which doesn't include created_at.

Hmm, this is a gap. Let me think... Maybe the repository's `upsertOperation` needs to handle this differently. Or maybe for a new order, created_at defaults to now() (which matches the Prisma default).

Actually, looking at the plan's data model: `created_at` on operations is "from payment_orders.created_at (sort key)". So it should mirror the source. But the signature doesn't pass it.

I think the most defensible reading is:
- For create: use `new Date()` (or Prisma's `now()` default) - since the source was just created/updated in the same transaction
- For update: keep the existing created_at (don't overwrite it)

This is a reasonable approach since in an upsert, `create` sets all fields and `update` only changes the mutable ones. The `created_at` would be set on create (to now, which is approximately the same as the source's created_at since they're in the same transaction) and preserved on update.

Actually, I'll use `Prisma.now()` or just `new Date()` for the create case.

Let me also think about `upsertCompanyTotal`. The plan says:
"Compute the delta for company_financial_totals: if this is an insert, delta = (+amount, +1). If status changed from a non-settled to settled or vice-versa, adjust accordingly (for simplicity in v1: recompute the row's contribution as a delta of new − old)."

And the signature is: `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`

So the service computes the delta and passes it. The repository just applies the delta. This means:
- For upsert, on create: total_amount = deltaAmount (assuming starting from 0), order_count = deltaCount
- For update: total_amount += deltaAmount, order_count += deltaCount

Wait, but for an upsert in Prisma, you can't do `total_amount += deltaAmount` directly. You'd need to use raw query or increment.

Actually, Prisma doesn't support `increment` on upsert for Decimal fields easily... Let me think.

For Prisma upsert:
```ts
tx.companyFinancialTotal.upsert({
  where: { companyId },
  create: {
    companyId,
    totalAmount: deltaAmount as Decimal,
    orderCount: deltaCount,
    updatedAt: new Date(),
  },
  update: {
    totalAmount: /* need to increment */,
    orderCount: { increment: deltaCount },
    updatedAt: new Date(),
  },
})
```

For the update part with Decimal, Prisma doesn't have a direct "increment" for Decimal. We'd need to use `prisma.$queryRaw` or fetch-then-update.

Actually, in newer Prisma versions, you can do:
```ts
update: {
  totalAmount: { increment: new Prisma.Decimal(deltaAmount) },
  ...
}
```

Wait, does Prisma support `increment` on Decimal? Let me think... I believe it does in recent versions. The `increment` update operation works on numeric types including Decimal.

Let me go with that assumption.

Actually, I just realized - for the `create` case in upsert, if deltaAmount could be negative (in theory), we'd want to handle that. But since this is a marketplace and amounts are positive, and the first write for a company would be a positive delta, I'll just use the delta value directly.

Hmm, but what if the first operation for a company is actually a correction with a negative delta? That's unlikely in practice. I'll keep it simple and use the delta as-is for create (assuming 0 baseline).

Now let me think about `queryDashboard`:

```ts
queryDashboard(query: DashboardQuery): Promise<DashboardResult>
```

- WHERE: company_id = query.company_id
- AND status = query.status (if provided)
- AND created_at >= query.date_from (if provided)
- AND created_at <= query.date_to (if provided)
- ORDER BY created_at DESC, order_id DESC
- OFFSET = (page - 1) * page_size
- LIMIT = page_size
- COUNT(*) with same WHERE

For Prisma:
```ts
const where = {
  companyId: query.company_id,
  ...(query.status && { status: query.status }),
  ...(query.date_from && { createdAt: { gte: query.date_from } }),
  ...(query.date_to && { createdAt: { lte: query.date_to } }),
};

const [data, total_count] = await Promise.all([
  this.prisma.operation.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { orderId: 'desc' }],
    skip: (query.page - 1) * query.page_size,
    take: query.page_size,
  }),
  this.prisma.operation.count({ where }),
]);
```

Then map the results to `OperationRow[]`.

Now, about the `tx` parameter type. Let me look at this more carefully.

In Prisma, `Prisma.TransactionClient` is the type you get inside `$transaction(async (tx) => {...})`. It has all the model delegates.

`PrismaPromise<T>` is defined as:
```ts
export type PrismaPromise<T> = Thenable<T> & {
  $isPrismaPromise: true
}
```

This is clearly not what you'd use to call model delegates on. So the plan's `tx: PrismaPromise` must be a simplification or error. I'll use `Prisma.TransactionClient` and add an assumption comment.

Wait, actually in some Prisma versions, the transaction client IS a `PrismaClient`-like object. Let me just type it as what makes sense: the object that has all the model delegates. In Prisma 5+, it's `Prisma.TransactionClient`.

Let me also consider: should I import from `@prisma/client`? Yes, for `PrismaClient`, `Prisma`, and `Decimal`.

Now let me write the full file:

```ts
import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import type {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOperation(
    // ASSUMPTION: plan specifies `tx: PrismaPromise`; using Prisma.TransactionClient as that is the actual type with model delegates available inside an interactive transaction
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operation.upsert({
      where: { orderId: order.order_id },
      create: {
        orderId: order.order_id,
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType,
        updatedAt: new Date(),
      },
    });
  }

  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.company_id,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.date_from || query.date_to) {
      where.createdAt = {};
      if (query.date_from) where.createdAt.gte = query.date_from;
      if (query.date_to) where.createdAt.lte = query.date_to;
    }

    const skip = (query.page - 1) * query.page_size;

    const [rows, totalCount] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
        skip,
        take: query.page_size,
      }),
      this.prisma.operation.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toOperationRow(r)),
      total_count: totalCount,
      page: query.page,
      page_size: query.page_size,
    };
  }

  async upsertCompanyTotal(
    tx: Prisma.TransactionClient,
    companyId: string,
    deltaAmount: string,
    deltaCount: number,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount: new Decimal(deltaAmount),
        orderCount: deltaCount,
        updatedAt: new Date(),
      },
      update: {
        totalAmount: { increment: new Decimal(deltaAmount) },
        orderCount: { increment: deltaCount },
        updatedAt: new Date(),
      },
    });
  }

  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findWorkerById(
    workerId: string,
  ): Promise<{ id: string; name: string; role: string } | null> {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) return null;
    return { id: worker.id, name: worker.name, role: worker.role };
  }

  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.event.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { eventType: true },
    });
    return event ? event.eventType : null;
  }

  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operation.findMany({
      where: {
        updatedAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.toOperationRow(r));
  }

  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operation.findUnique({
      where: { orderId },
    });
    if (!row) return null;
    return this.toOperationRow(row);
  }

  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
    if (!row) return null;
    return {
      company_id: row.companyId,
      total_amount: row.totalAmount.toString(),
      order_count: row.orderCount,
    };
  }

  private toOperationRow(row: {
    orderId: string;
    companyId: string;
    status: string;
    amount: Decimal;
    currency: string;
    workerName: string;
    workerRole: string;
    lastEventType: string | null;
    createdAt: Date;
  }): OperationRow {
    return {
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    };
  }
}
```

Wait, I need to check - does `Prisma.TransactionClient` exist as a named export? In Prisma 5, it's available as `Prisma.TransactionClient`. Let me make sure I import it correctly.

Actually, in Prisma, you access it as `Prisma.TransactionClient` where `Prisma` is the namespace from `@prisma/client`. So I'd import `{ Prisma, PrismaClient, Decimal }` from `@prisma/client`.

Let me also double-check the `increment` on Decimal. In Prisma, for Decimal fields, you CAN use `increment`:
```ts
totalAmount: { increment: new Prisma.Decimal("10.00") }
```

Yes, this is supported.

One more thought: the `findOrdersByWindow` returns `Record<string, unknown>[]`. The plan says this. I'll keep it as-is since the re-derivation service would need to access fields dynamically or the return type is intentionally loose.

Actually wait, looking at the plan again for `findOrdersByWindow`:
```
findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>;
```

This is the signature. I'll implement it returning the Prisma results cast to this type. The Prisma result would be `PaymentOrder[]` which is assignable to `Record<string, unknown>[]`.

Let me also reconsider the `updated_at` field on the operations table. The plan says it's "projection row timestamp". For upserts, I'm setting it to `new Date()` on both create and update. That's correct.

For the `created_at` on operations: "from payment_orders.created_at (sort key)". On create, I'm using `new Date()` which approximates the source's created_at (since they're in the same transaction). On update, I don't touch it. This is the most defensible approach given the signature doesn't pass created_at.

Let me also verify: do I need to handle the case where `lastEventType` is explicitly null vs undefined? In Prisma, if you pass `null` to an optional field in `update`, it sets it to null. If you don't include the field, it leaves it unchanged. Since we always pass `lastEventType` (which could be null), this is correct - we want to set it to null if there's no event.

I think the implementation is solid. Let me finalize it.

One more thing - the `Prisma.OperationWhereInput` type. I should make sure this is correct. In Prisma, the where input for a model `Operation` would be `Prisma.OperationWhereInput`. Yes.

Actually, I realize I should double-check: does the plan use `Prisma.TransactionClient` or something else? The plan says `tx: PrismaPromise`. Let me just go with `Prisma.TransactionClient` and note the assumption.

Let me also make sure I'm not importing anything that's not needed or using any pattern not in the plan.

Final check on the file structure - the plan says this file is at `src/operations/operations.repository.ts` and it imports from `./operations.types`. Good.

I think I'm ready to write the final version.
```

## reply

```typescript
import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import type {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Projection maintenance (called inside a transaction)
  // ASSUMPTION: plan specifies `tx: PrismaPromise`; using Prisma.TransactionClient
  // because that is the type that exposes model delegates inside an interactive transaction.
  async upsertOperation(
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operation.upsert({
      where: { orderId: order.order_id },
      create: {
        orderId: order.order_id,
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType,
        updatedAt: new Date(),
      },
    });
  }

  // Dashboard read
  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.company_id,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.date_from || query.date_to) {
      where.createdAt = {};
      if (query.date_from) where.createdAt.gte = query.date_from;
      if (query.date_to) where.createdAt.lte = query.date_to;
    }

    const skip = (query.page - 1) * query.page_size;

    const [rows, totalCount] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
        skip,
        take: query.page_size,
      }),
      this.prisma.operation.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toOperationRow(r)),
      total_count: totalCount,
      page: query.page,
      page_size: query.page_size,
    };
  }

  // Aggregate maintenance (called inside a transaction)
  async upsertCompanyTotal(
    tx: Prisma.TransactionClient,
    companyId: string,
    deltaAmount: string,
    deltaCount: number,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount: new Decimal(deltaAmount),
        orderCount: deltaCount,
        updatedAt: new Date(),
      },
      update: {
        totalAmount: { increment: new Decimal(deltaAmount) },
        orderCount: { increment: deltaCount },
        updatedAt: new Date(),
      },
    });
  }

  // Source reads (for re-derivation and drift-repair)
  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findWorkerById(
    workerId: string,
  ): Promise<{ id: string; name: string; role: string } | null> {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });
    if (!worker) return null;
    return { id: worker.id, name: worker.name, role: worker.role };
  }

  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.event.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { eventType: true },
    });
    return event ? event.eventType : null;
  }

  // Drift-repair comparison
  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operation.findMany({
      where: {
        updatedAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.toOperationRow(r));
  }

  // Read-your-own-writes: single-order fetch from projection
  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operation.findUnique({
      where: { orderId },
    });
    if (!row) return null;
    return this.toOperationRow(row);
  }

  // Totals read
  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
    if (!row) return null;
    return {
      company_id: row.companyId,
      total_amount: row.totalAmount.toString(),
      order_count: row.orderCount,
    };
  }

  private toOperationRow(row: {
    orderId: string;
    companyId: string;
    status: string;
    amount: Decimal;
    currency: string;
    workerName: string;
    workerRole: string;
    lastEventType: string | null;
    createdAt: Date;
  }): OperationRow {
    return {
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    };
  }
}
```
