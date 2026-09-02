# repair2-operations.repository.ts

## reasoning

```
Let me analyze the compiler errors that are specifically about `src/operations/operations.repository.ts`:

1. `src/operations/operations.repository.ts(118,36): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?`
2. `src/operations/operations.repository.ts(123,22): error TS7006: Parameter 'row' implicitly has an 'any' type.`
3. `src/operations/operations.repository.ts(127,35): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?`
4. `src/operations/operations.repository.ts(134,35): error TS2551: Property 'companyFinancialTotals' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'companyFinancialTotal'?`

And there's a partial message at the top:
`tArgs>'. Did you mean 'event'?`

This suggests there's also an error about a property that should be `event` instead of something else (likely `events`).

So the issues are:
1. The Prisma model for the projection table is named `Operation` (singular), so the client property is `prisma.operation` not `prisma.operations`.
2. The Prisma model for the financial totals is named `CompanyFinancialTotal` (singular), so the client property is `prisma.companyFinancialTotal` not `prisma.companyFinancialTotals`.
3. There's likely a similar issue with `events` → `event` (the model is named `Event`, so the client property is `prisma.event`).
4. Parameter 'row' implicitly has an 'any' type — needs explicit typing.

Now I need to look at the Prisma schema to understand the model names. The plan says tables are mapped with `@@map`, so the Prisma model names would be in PascalCase. Let me infer from the error messages:

- `prisma.operation` — model is `Operation`, table is `operations` (via `@@map("operations")`)
- `prisma.companyFinancialTotal` — model is `CompanyFinancialTotal`, table is `company_financial_totals` (via `@@map("company_financial_totals")`)
- `prisma.event` — model is `Event`, table is `events` (via `@@map("events")`)

And for the source tables:
- `prisma.paymentOrder` — model is `PaymentOrder`, table is `payment_orders`
- `prisma.worker` — model is `Worker`, table is `workers`

Now let me write the complete repository file. I need to follow the plan's signatures:

```ts
export class OperationsRepository {
  constructor(prisma: PrismaClient) {}

  upsertOperation(tx, order, worker, lastEventType): Promise<void>;
  queryDashboard(query): Promise<DashboardResult>;
  upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount): Promise<void>;
  findOrdersByWindow(from, to): Promise<Record<string, unknown>[]>;
  findWorkerById(workerId): Promise<{ id: string; name: string; role: string } | null>;
  findLastEventForOrder(orderId): Promise<string | null>;
  findProjectionByWindow(from, to): Promise<OperationRow[]>;
  getOperationByOrderId(orderId): Promise<OperationRow | null>;
  getCompanyTotal(companyId): Promise<CompanyTotals | null>;
}
```

Wait, the plan mentions `PrismaPromise` type. Let me think about what that is. In Prisma, when using `$transaction(async (prisma) => { ... })`, the `prisma` parameter is a `PrismaClient`. But for interactive transactions, you can also pass the transaction client around. The type is typically `Prisma.TransactionClient` in newer versions.

Actually, looking more carefully at the plan, it says `tx: PrismaPromise`. That's not a real Prisma type. I think the intent is that `tx` is the transaction client (which is `PrismaClient` type in practice, or `Prisma.TransactionClient`). Let me use `Prisma.TransactionClient` which is the correct type for the client passed into interactive transactions.

Wait, actually in Prisma 5+, the type for the transaction client is `Prisma.TransactionClient`. Let me use that.

Now let me write the file. I need to be careful about:
1. Using `prisma.operation` (singular) for the projection table
2. Using `prisma.companyFinancialTotal` (singular) for the totals table
3. Using `prisma.event` (singular) for events
4. Using `prisma.paymentOrder` (singular) for payment orders
5. Using `prisma.worker` (singular) for workers
6. Typing the `row` parameter explicitly

Let me also think about the `upsertCompanyTotal` method. The plan says it takes `deltaAmount: string, deltaCount: number`. This suggests an incremental update (add to existing total). But in the re-derivation flow, the plan says "Recompute (not delta) the company_financial_totals". So maybe I need both a delta-based upsert and a recompute method? Let me re-read the plan...

The plan's repository interface only has `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`. But in the re-derivation flow, it says to recompute. I think for re-derivation, the service would need a different method or handle it differently. But the task says "Change nothing the messages do not name." So I should only fix what the compiler errors require.

Let me focus on just fixing the four errors in this file:
1. `prisma.operations` → `prisma.operation` (lines 118, 127)
2. `prisma.companyFinancialTotals` → `prisma.companyFinancialTotal` (line 134)
3. Parameter 'row' implicitly has an 'any' type (line 123)
4. The partial error about `event` (likely `prisma.events` → `prisma.event`)

Since I'm rewriting the complete file, I need to write it all correctly. Let me write a complete, working repository that matches the plan's interface and uses the correct Prisma model names.

Let me think about what methods need to exist based on the plan and what other files expect:

From the plan's types file, we have `OperationRow`, `DashboardQuery`, `DashboardResult`, `CompanyTotals`, `SimulateWriteInput`, `ReDeriveInput`, `DriftRepairReport`.

From the service, the repository needs:
- `upsertOperation` - for simulateWrite
- `queryDashboard` - for getDashboard
- `upsertCompanyTotal` - for simulateWrite
- `getOperationByOrderId` - for read-your-own-writes
- `getCompanyTotal` - for getCompanyTotals

From re-derivation service:
- `findOrdersByWindow` - to fetch source orders in a window
- `findWorkerById` - to look up workers
- `findLastEventForOrder` - to get last event
- `upsertOperation` - to write projection
- Some way to recompute totals (maybe a separate method or using raw query)

From drift-repair service:
- `findProjectionByWindow` - to find projection rows in window
- Same as re-derivation for repair

Let me also think about the `tx` parameter type. In Prisma interactive transactions:
```ts
await prisma.$transaction(async (tx) => {
  // tx is Prisma.TransactionClient
})
```

So `tx` should be typed as `Prisma.TransactionClient`.

Now let me write the complete file. I'll need to import from `@prisma/client` and the types file.

Actually, wait. The compiler error at the top is truncated: `tArgs>'. Did you mean 'event'?` — this is likely from a line before line 118. It could be that somewhere in the file, `prisma.events` is used instead of `prisma.event`. Let me include that fix too.

Let me also think about what the `upsertCompanyTotal` with delta means in practice. If we're doing an incremental update:
- On insert: `total_amount += amount`, `order_count += 1`
- On update (status change): we need to adjust. The plan says "for simplicity in v1: recompute the row's contribution as a delta of new − old"

But for the repository, the plan just says `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`. So it takes pre-computed deltas. The service computes the delta and passes it in.

For the actual implementation, I'll use a raw query or an upsert with arithmetic. Actually, Prisma doesn't support atomic increments easily without raw queries or using `$queryRaw`. Let me use an upsert with `increment` in the data:

```ts
await tx.companyFinancialTotal.upsert({
  where: { company_id: companyId },
  create: {
    company_id: companyId,
    total_amount: new Decimal(deltaAmount),
    order_count: deltaCount,
  },
  update: {
    total_amount: { increment: new Decimal(deltaAmount) },
    order_count: { increment: deltaCount },
  },
});
```

Wait, but the plan says the table has `company_id` as PK. In Prisma, the model would have `companyId` as the field (with `@map("company_id")`). So the `where` clause would use `companyId`.

Actually, I need to be careful about the field naming convention. In Prisma:
- The model field in TypeScript uses camelCase (e.g., `companyId`)
- The database column uses snake_case via `@map` (e.g., `company_id`)

So in Prisma queries, I use the camelCase field names.

Let me now write the complete file:

```ts
import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Projection maintenance (called inside a transaction)
  async upsertOperation(
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operation.upsert({
      where: { order_id: order.order_id },
      create: {
        order_id: order.order_id,
        company_id: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
        created_at: new Date(), // Hmm, this should be from the order
      },
      update: {
        company_id: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
    });
  }
  
  ...
}
```

Wait, but the plan says `created_at` in the projection is "from payment_orders.created_at (sort key)". So I need to pass the `created_at` from the source order. But the `SimulateWriteInput` type doesn't have a `created_at` field... Let me look at the plan again.

The plan's `SimulateWriteInput`:
```ts
export interface SimulateWriteInput {
  order_id: string;
  company_id: string;
  worker_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
}
```

No `created_at`. So either:
1. The repository fetches the `payment_orders` row to get `created_at`, or
2. The `upsertOperation` method signature needs to include `created_at`.

Looking at the control flow:
```
3. Upsert the `payment_orders` row (insert or update by `order_id`).
4. Read the latest event for this order (SELECT … ORDER BY created_at DESC LIMIT 1) — may be null.
5. Upsert the `operations` projection row with denormalised fields from steps 3–4.
```

So step 5 uses data from step 3 (which includes `created_at` from the source). The service would pass the full order data including `created_at` to the repository method.

But the plan's signature for `upsertOperation` is:
```ts
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
```

Hmm, `SimulateWriteInput` doesn't have `created_at`. This is a design issue. But the task says "Change nothing the messages do not name." The compiler errors don't complain about this — they only complain about property names on PrismaClient and the implicit any.

So I'll just use `new Date()` for `created_at` in the create case (since it's a new order, `now()` is correct — matches the source table default). For the update case, we don't update `created_at` in the projection (it should stay as the original). Actually wait, if we're updating an existing order, the `created_at` in the projection should remain the same. So we only set it on create, and on create, using `new Date()` is fine (it matches the source default of `now()`).

Actually, I realize I should be more careful. The plan says the `payment_orders` table has `created_at` with `default now()`. When we upsert a new order, the source gets `created_at = now()`, and the projection should also get `created_at = now()`. Using `new Date()` in the projection create is semantically correct here since both are being set at the same time.

But for the update case, we don't touch `created_at` in the projection — it stays as whatever was set during create. That's correct.

Now, for `findOrdersByWindow`, the plan says it returns `Promise<Record<string, unknown>[]>`. That's a bit odd for typed code, but I'll follow the plan. Actually, this might cause issues with the `row` parameter in the re-derivation service, but that's not my file to fix.

Wait, let me re-read the error: `src/operations/operations.repository.ts(123,22): error TS7006: Parameter 'row' implicitly has an 'any' type.`

This is in MY file. So somewhere in my repository file, there's a callback with parameter `row` that needs explicit typing. This is probably in the `queryDashboard` method where we map results, or in `findProjectionByWindow`.

Let me think about where a `row` parameter would appear. In `queryDashboard`, I'd do something like:
```ts
const rows = await this.prisma.operation.findMany({ ... });
return { data: rows.map(row => ({...})), ... };
```

Or in `findProjectionByWindow`:
```ts
const rows = await this.prisma.operation.findMany({ where: { ... } });
return rows.map(row => ({...}));
```

The `row` parameter in the `.map()` callback needs explicit typing if TypeScript can't infer it. But normally TypeScript would infer it from the return type of `findMany`. Unless there's something wrong with the types...

Actually, the issue might be that if I use `$queryRaw` or if the Prisma model types aren't resolving properly. But since the errors are about property names on PrismaClient, once I fix those, the types should flow correctly.

Let me just make sure to add explicit types where needed. I'll type the `row` parameter explicitly.

Let me now write the complete file. I'll be careful to:
1. Use `prisma.operation` (singular)
2. Use `prisma.companyFinancialTotal` (singular)  
3. Use `prisma.event` (singular)
4. Use `prisma.paymentOrder` (singular)
5. Use `prisma.worker` (singular)
6. Add explicit types to callback parameters

For the `tx` parameter, I'll use `Prisma.TransactionClient`.

Let me also think about the `findProjectionByWindow` method. It should return `OperationRow[]`. The Prisma model would have camelCase fields, so I need to map them.

Actually, looking at this more carefully — the plan uses snake_case in the `OperationRow` interface:
```ts
export interface OperationRow {
  order_id: string;
  company_id: string;
  ...
}
```

But Prisma models use camelCase in TypeScript. So I need to map from the Prisma model's camelCase to the snake_case `OperationRow` interface.

Hmm, but that's a lot of mapping. Let me think about whether the plan intends for the Prisma model fields to be named in snake_case (using `@map` on each field). If the Prisma model uses `@map` for each field, then the TypeScript property names would still be camelCase (Prisma convention), and I'd need to map.

Actually, in Prisma, you can name the model fields in any case, and use `@map` to specify the database column name. The convention is:
- Model field (TS): `orderId`
- Database column: `order_id` (via `@map("order_id")`)

So in Prisma queries, I use `orderId`, and when mapping to `OperationRow`, I convert to `order_id`.

Let me write the full file now. I'll need to be comprehensive but focused on fixing only what the errors require (plus making the file actually compile).

Here's my plan for the file:

```ts
import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
        lastEventType: lastEventType,
        createdAt: new Date(),
      },
      update: {
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType: lastEventType,
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
    if (query.date_from && query.date_to) {
      where.createdAt = { gte: query.date_from, lte: query.date_to };
    } else if (query.date_from) {
      where.createdAt = { gte: query.date_from };
    } else if (query.date_to) {
      where.createdAt = { lte: query.date_to };
    }

    const [rows, total] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operation.count({ where }),
    ]);

    const data: OperationRow[] = rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status,
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));

    return { data, total_count: total, page: query.page, page_size: query.page_size };
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
      },
      update: {
        totalAmount: { increment: new Decimal(deltaAmount) },
        orderCount: { increment: deltaCount },
      },
    });
  }

  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ ...row }) as Record<string, unknown>);
  }

  async findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null> {
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
    });
    return rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status,
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));
  }

  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operation.findUnique({
      where: { orderId },
    });
    if (!row) return null;
    return {
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status,
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    };
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
}
```

Wait, I need to double-check the field names. The plan says:
- `operations` table has columns: `order_id`, `company_id`, `status`, `amount`, `currency`, `worker_name`, `worker_role`, `last_event_type`, `created_at`, `updated_at`
- In Prisma, these would be mapped to: `orderId`, `companyId`, `status`, `amount`, `currency`, `workerName`, `workerRole`, `lastEventType`, `createdAt`, `updatedAt`

- `company_financial_totals` table has columns: `company_id`, `total_amount`, `order_count`, `updated_at`
- In Prisma: `companyId`, `totalAmount`, `orderCount`, `updatedAt`

- `payment_orders` table has columns: `id`, `company_id`, `worker_id`, `status`, `amount`, `currency`, `created_at`, `updated_at`
- In Prisma: `id`, `companyId`, `workerId`, `status`, `amount`, `currency`, `createdAt`, `updatedAt`

- `events` table has columns: `id`, `order_id`, `event_type`, `payload`, `created_at`
- In Prisma: `id`, `orderId`, `eventType`, `payload`, `createdAt`

- `workers` table has columns: `id`, `company_id`, `name`, `role`
- In Prisma: `id`, `companyId`, `name`, `role`

This all looks consistent. Let me also make sure the `status` field type works. The plan says it's a text field with an enum-like set of values. In Prisma, this would just be a `String` field (unless they used a proper Prisma enum). I'll assume it's a `String` in the Prisma model.

One more thing: the `updated_at` field. The plan says the projection has `updated_at` as "projection row timestamp". In Prisma, if we use `@default(now()) @updatedAt`, it auto-updates. But in the `upsert`, we might need to explicitly set it or rely on the `@updatedAt` attribute. I'll rely on `@updatedAt` in the schema (which is a schema concern, not this file's concern).

Actually wait — for the drift-repair logic to work, the `updated_at` on the projection needs to be settable or auto-managed. If it's `@updatedAt`, Prisma handles it automatically on any update. That should be fine.

Let me also think about whether I need a `recomputeCompanyTotal` method for the re-derivation flow. The plan's repository interface only lists `upsertCompanyTotal` with delta parameters. But the re-derivation flow says "Recompute (not delta) the company_financial_totals". 

Looking at the plan's manifest, the re-derivation service reads from `operations.repository.ts`. So either:
1. The re-derivation service uses a different method not listed in the plan's repo interface (unlikely since the plan is supposed to be complete)
2. The re-derivation service calls `upsertCompanyTotal` with the full recomputed values (but that's an increment, not a set)

Hmm, this is a design gap in the plan. But my task is to fix the compiler errors in `operations.repository.ts` only. The re-derivation service is a different file. I'll stick to the plan's listed interface for this file.

Actually, wait. Let me re-read the task: "Rewrite `src/operations/operations.repository.ts` complete, fixing what these messages require of this file."

So I just need to make this file compile correctly. The other files have their own errors that aren't my concern here. I just need to make sure this file's exports match what other files expect (based on the plan) and that it compiles.

Let me finalize my file. I think it's solid. Let me just double-check the `Decimal` import — in Prisma, `Decimal` is exported from `@prisma/client`.

One concern: the `findOrdersByWindow` returns `Record<string, unknown>[]`. The actual Prisma return type would be `PaymentOrder[]` (the model type). I'm casting it. This might cause issues downstream but it's what the plan specifies.

Actually, I realize I should double-check: does the plan's `SimulateWriteInput` have all the fields I need? Let me look:
```ts
export interface SimulateWriteInput {
  order_id: string;
  company_id: string;
  worker_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
}
```

Yes, I use `order_id`, `company_id`, `status`, `amount`, `currency` from it. The `worker_id` is used by the service to look up the worker before calling `upsertOperation`.

I think my file is correct. Let me write it out cleanly.
```

## reply

```typescript
import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Projection maintenance — called inside a transaction. */
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
        lastEventType: lastEventType,
        createdAt: new Date(),
      },
      update: {
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType: lastEventType,
      },
    });
  }

  /** Dashboard read — single query against the projection. */
  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.company_id,
    };
    if (query.status) {
      where.status = query.status;
    }
    const dateFilter: Record<string, Date> = {};
    if (query.date_from) dateFilter.gte = query.date_from;
    if (query.date_to) dateFilter.lte = query.date_to;
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter as Prisma.OperationWhereInput["createdAt"];
    }

    const [rows, totalCount] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operation.count({ where }),
    ]);

    const data: OperationRow[] = rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));

    return { data, total_count: totalCount, page: query.page, page_size: query.page_size };
  }

  /** Aggregate maintenance (delta-based) — called inside a transaction. */
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
      },
      update: {
        totalAmount: { increment: new Decimal(deltaAmount) },
        orderCount: { increment: deltaCount },
      },
    });
  }

  /** Source read for re-derivation and drift-repair. */
  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ ...row }) as Record<string, unknown>);
  }

  /** Look up a worker by id. */
  async findWorkerById(
    workerId: string,
  ): Promise<{ id: string; name: string; role: string } | null> {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return null;
    return { id: worker.id, name: worker.name, role: worker.role };
  }

  /** Most recent event type for an order, or null. */
  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.event.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { eventType: true },
    });
    return event ? event.eventType : null;
  }

  /** Projection rows whose updated_at falls within [from, to]. */
  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operation.findMany({
      where: {
        updatedAt: { gte: from, lte: to },
      },
    });
    return rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));
  }

  /** Single-order fetch from the projection (read-your-own-writes). */
  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operation.findUnique({ where: { orderId } });
    if (!row) return null;
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

  /** Read a company's exact financial totals. */
  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({ where: { companyId } });
    if (!row) return null;
    return {
      company_id: row.companyId,
      total_amount: row.totalAmount.toString(),
      order_count: row.orderCount,
    };
  }
}
```
