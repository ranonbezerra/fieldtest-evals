# repair1-operations.repository.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/operations/operations.repository.ts`:

1. `src/operations/operations.repository.ts(1,32): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.`
2. `src/operations/operations.repository.ts(8,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.`

So the issues with this file are:
1. It imports `Decimal` from `@prisma/client`, which doesn't exist as an exported member. I need to remove that import or find another way.
2. It imports from `./operations.types` which doesn't exist yet (or has a different path).

Wait, looking at the error list more carefully:
- `src/operations/operations.repository.ts(1,32)` - line 1, column 32 - this is the `Decimal` import from `@prisma/client`
- `src/operations/operations.repository.ts(8,8)` - line 8, column 8 - this is the import from `./operations.types`

The other errors in other files reference `./operations.repository` not being found - but that's because the file doesn't compile, so it can't be resolved. Once I fix this file, those other errors should go away (assuming the file exists at the right path).

Now, for the `Decimal` issue: In Prisma, `Decimal` is not exported from `@prisma/client`. It's available as a type from `decimal.js` or you can use the type that Prisma generates. Actually, in newer versions of Prisma, you can import it from `@prisma/client/runtime` or just use the type inline. But the safest approach is to not import `Decimal` at all and use the Prisma model types directly, or import from the correct location.

Actually, looking at this more carefully - in Prisma 5+, `Decimal` is not directly exported from `@prisma/client`. You can:
1. Use `Prisma.Decimal` (namespace access)
2. Import from `decimal.js` directly
3. Just use the type inferred from the model

Since I don't know exactly what the Prisma version is, let me think about what's safest. The plan says amounts use `numeric(14,2)` / Prisma `Decimal`. In the types file, amounts are represented as strings. So in the repository, I probably don't need to explicitly reference `Decimal` type at all - I can just let TypeScript infer it from the Prisma model types, or use `Prisma.Decimal` if needed.

Actually, looking at the plan's types:
```ts
export interface OperationRow {
  amount: string;          // Decimal as string for JSON safety
  ...
}
```

So the repository returns amounts as strings. I probably don't need to import `Decimal` at all.

For the `./operations.types` import - the file should exist at that path based on the plan. The error says it can't be found, which means either:
1. The file hasn't been created yet
2. It's at a different path

But the task says "Change nothing the messages do not name." So I should keep the import as `./operations.types` since that's what the plan specifies. The error will be resolved once that file is created. Wait, but the task says to fix what these messages require of THIS file. The message says the module can't be found - but I can't create other files. I should keep the import as-is since the plan specifies it, and note that it's expected to exist.

Actually wait - re-reading the instructions: "Rewrite `src/operations/operations.repository.ts` complete, fixing what these messages require of this file." So I need to fix the issues IN this file. The `Decimal` import is clearly wrong and needs fixing. The `./operations.types` import - the file might not exist yet, but the plan says it should. I'll keep it since the plan governs.

Let me now write the complete repository file based on the plan:

From the plan, `OperationsRepository` needs these methods:
- `upsertOperation(tx, order, worker, lastEventType)` - called inside a transaction
- `queryDashboard(query)` - dashboard read
- `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)` - aggregate maintenance
- `findOrdersByWindow(from, to)` - source reads for re-derivation
- `findWorkerById(workerId)` - worker lookup
- `findLastEventForOrder(orderId)` - last event lookup
- `findProjectionByWindow(from, to)` - drift-repair comparison
- `getOperationByOrderId(orderId)` - read-your-own-writes
- `getCompanyTotal(companyId)` - totals read

The `tx` parameter in `upsertOperation` and `upsertCompanyTotal` is typed as `PrismaPromise` in the plan. But actually, for interactive transactions in Prisma, you get a `Prisma.TransactionClient`. Let me use that.

Wait, the plan says:
```ts
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
```

`PrismaPromise` is not the right type for a transaction client. The correct type is `Prisma.TransactionClient`. But the plan explicitly says `PrismaPromise`. Hmm, but `PrismaPromise` is not a standard Prisma type either. I think the plan meant `Prisma.TransactionClient`. Let me use that since it's what actually works with Prisma interactive transactions.

Actually, I need to be careful. The plan says `PrismaPromise` - but that's not a real type in Prisma. The correct type for interactive transactions is `Prisma.TransactionClient`. Since the plan's intent is clearly to pass a transaction client, I'll use `Prisma.TransactionClient` and add an ASSUMPTION comment.

Wait, actually let me re-read: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The `PrismaPromise` type doesn't exist in Prisma. The correct type is `Prisma.TransactionClient`. I'll use that and note it.

Now let me think about what the file needs:

```typescript
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DashboardQuery,
  DashboardResult,
  OperationRow,
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
    await tx.operations.upsert({
      where: { order_id: order.order_id },
      create: {
        order_id: order.order_id,
        company_id: order.company_id,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
      update: {
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
    });
  }

  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationsWhereInput = {
      company_id: query.company_id,
    };
    if (query.status) where.status = query.status;
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = query.date_from;
      if (query.date_to) where.created_at.lte = query.date_to;
    }

    const [data, total_count] = await Promise.all([
      this.prisma.operations.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { order_id: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operations.count({ where }),
    ]);

    return {
      data: data.map((row) => this.toOperationRow(row)),
      total_count,
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
    // Use a raw update to atomically increment
    await tx.$executeRaw`
      INSERT INTO company_financial_totals (company_id, total_amount, order_count, updated_at)
      VALUES (${companyId}, ${deltaAmount}::numeric, ${deltaCount}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        total_amount = company_financial_totals.total_amount + EXCLUDED.total_amount,
        order_count = company_financial_totals.order_count + EXCLUDED.order_count,
        updated_at = now()
    `;
  }

  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRaw`
      SELECT * FROM payment_orders
      WHERE created_at >= ${from} AND created_at <= ${to}
      ORDER BY created_at ASC
    ` as Promise<Record<string, unknown>[]>;
  }

  async findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null> {
    return this.prisma.workers.findUnique({
      where: { id: workerId },
      select: { id: true, name: true, role: true },
    });
  }

  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.events.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: "desc" },
      select: { event_type: true },
    });
    return event?.event_type ?? null;
  }

  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operations.findMany({
      where: {
        updated_at: { gte: from, lte: to },
      },
    });
    return rows.map((row) => this.toOperationRow(row));
  }

  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operations.findUnique({
      where: { order_id: orderId },
    });
    return row ? this.toOperationRow(row) : null;
  }

  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotals.findUnique({
      where: { company_id: companyId },
    });
    return row
      ? {
          company_id: row.company_id,
          total_amount: row.total_amount.toString(),
          order_count: row.order_count,
        }
      : null;
  }

  private toOperationRow(row: Prisma.OperationsGetPayload<{}>): OperationRow {
    return {
      order_id: row.order_id,
      company_id: row.company_id,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.worker_name,
      worker_role: row.worker_role,
      last_event_type: row.last_event_type,
      created_at: row.created_at,
    };
  }
}
```

Wait, I need to think about the Prisma model names. The plan says tables are `operations`, `company_financial_totals`, `payment_orders`, `events`, `workers`. With Prisma's `@@map` convention, the model names would be PascalCase: `Operations`, `CompanyFinancialTotals`, `PaymentOrders`, `Events`, `Workers`. But the Prisma client property names are camelCase of the model name: `operations`, `companyFinancialTotals`, `paymentOrders`, `events`, `workers`.

For `toOperationRow`, I'm using `Prisma.OperationsGetPayload<{}>` which might not be the right type. Let me just use the model's inferred type. Actually, since I don't have the actual schema file, I'll use a simpler approach - just type it as the return of `findUnique`/`findMany`.

Actually, I can just let TypeScript infer the type from the Prisma client calls. Let me use a private method that takes the row type inferred from Prisma.

Hmm, but I need to be explicit about the parameter type for `toOperationRow`. Let me think...

I could do:
```typescript
private toOperationRow(row: {
  order_id: string;
  company_id: string;
  status: string;
  amount: Prisma.Decimal;  // No, Decimal isn't exported
  ...
}): OperationRow {
```

Wait, the issue is that `Decimal` isn't exported from `@prisma/client`. So I can't reference it by name. But the field in the Prisma model will be of type `Decimal` (which is actually `decimal.Decimal` under the hood). I can just use `.toString()` on it without needing to name the type.

Let me restructure: I'll let TypeScript infer the row types from the Prisma client, and in my `toOperationRow` helper, I'll accept a parameter that has the right shape without needing to name `Decimal`.

Actually, the simplest approach: just inline the mapping where needed, or use a generic approach.

Let me think about this differently. The Prisma client will return objects where `amount` is of type `Decimal` (from decimal.js). I just need to call `.toString()` on it. I don't need to name the type explicitly if I let inference handle it.

Let me write it more carefully:

```typescript
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DashboardQuery,
  DashboardResult,
  OperationRow,
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
    await tx.operations.upsert({
      where: { order_id: order.order_id },
      create: {
        order_id: order.order_id,
        company_id: order.company_id,
        status: order.status,
        amount: new Prisma.Decimal(order.amount),  // No! Can't do this either
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
      update: {
        status: order.status,
        amount: order.amount,  // Prisma accepts string for Decimal fields
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
    });
  }
```

Wait - Prisma accepts `string | number | Decimal` for Decimal fields in inputs. So I can just pass the string directly. That's fine.

For the `toOperationRow` method, I need to handle the fact that `amount` will be a `Decimal` instance (which has `.toString()`). I can type the parameter loosely:

```typescript
private toOperationRow(row: {
  order_id: string;
  company_id: string;
  status: string;
  amount: { toString(): string };
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}): OperationRow {
  return {
    order_id: row.order_id,
    company_id: row.company_id,
    status: row.status as OperationRow["status"],
    amount: row.amount.toString(),
    currency: row.currency,
    worker_name: row.worker_name,
    worker_role: row.worker_role,
    last_event_type: row.last_event_type,
    created_at: row.created_at,
  };
}
```

This way I don't need to import `Decimal` at all. The structural typing will work because Prisma's Decimal (from decimal.js) has a `toString()` method.

Actually, even simpler - I can just use the type that Prisma infers. Let me use:

```typescript
private toOperationRow(row: Prisma.OperationsGetPayload<{}> | (await ReturnType<...>)) 
```

No, that's getting too complex. Let me just use the structural approach with `{ toString(): string }` for the amount field. That's clean and doesn't require importing Decimal.

Wait, actually there's an even simpler approach. Since I'm calling `this.prisma.operations.findMany(...)` and `this.prisma.operations.findUnique(...)`, TypeScript will infer the return type. I can just inline the mapping or use a generic helper.

Let me just go with the structural type approach for `toOperationRow`. It's clean and avoids the Decimal import entirely.

Now, about the `Prisma.TransactionClient` vs `PrismaPromise` issue. The plan says `PrismaPromise` but that's not a real type. I'll use `Prisma.TransactionClient` and add an assumption comment.

Let me also think about `findOrdersByWindow`. The plan says it returns `Record<string, unknown>[]`. Using `$queryRaw` is appropriate here since we're reading from the source table and need raw access. But actually, if I have a Prisma model for `payment_orders`, I could use the typed client. Let me check - the plan says these are "source, simulated" tables that we own the DDL for. So they should have Prisma models.

Actually, looking at the plan more carefully:
- `payment_orders` - we own this DDL (simulated)
- `events` - we own this DDL (simulated)  
- `workers` - we own this DDL (simulated)

So they all have Prisma models. I can use the typed Prisma client for them too. Let me use `this.prisma.paymentOrders.findMany(...)` instead of raw queries.

But wait - the plan's signature says `findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>`. If I use the typed client, the return type would be more specific. But since the re-derivation service needs to work with these, maybe returning `Record<string, unknown>[]` is intentional for flexibility.

Hmm, but the convention says "repository is the only layer that touches the database" and "zero raw SQL, zero Prisma client calls" in the service layer. The repository CAN use raw SQL or typed Prisma - either is fine at that level.

Let me use the typed Prisma client where possible since we have models for all tables. For `findOrdersByWindow`, I'll use `this.prisma.paymentOrders.findMany(...)`.

Actually wait - looking at the plan again for `findOrdersByWindow`, it returns `Record<string, unknown>[]`. This suggests the plan intended raw SQL or at least a loosely-typed return. But since we have a Prisma model, let me just use the typed client and let the return type be what Prisma gives us. The re-derivation service can work with that.

But the plan explicitly specifies the return type as `Record<string, unknown>[]`. If I change it, other files that depend on this signature might break. Let me keep it as `Record<string, unknown>[]` and use a raw query, or cast the result.

Actually, I'll use the typed Prisma client and cast to `Record<string, unknown>[]`:

```typescript
async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
  const rows = await this.prisma.paymentOrders.findMany({
    where: {
      created_at: { gte: from, lte: to },
    },
    orderBy: { created_at: "asc" },
  });
  return rows as unknown as Record<string, unknown>[];
}
```

Hmm, but that's a bit ugly. Alternatively, I could use `$queryRaw`. Let me think about what's cleaner.

Actually, you know what - let me just use the typed Prisma client and return the proper type. The plan's `Record<string, unknown>[]` is just a loose typing choice. Since I'm writing this file and the re-derivation service will consume it, I can return a more specific type. But wait - the task says "Change nothing the messages do not name." The messages don't say anything about the return type of `findOrdersByWindow`. So I should keep it as specified in the plan.

OK let me just use `$queryRaw` for this one to match the `Record<string, unknown>[]` return type cleanly.

Actually, I realize I'm overthinking this. Let me just write the file properly:

1. No `Decimal` import (fixes error 1)
2. Keep `./operations.types` import (the file should exist per plan; if it doesn't yet, that's a separate issue)
3. Use `Prisma.TransactionClient` instead of the non-existent `PrismaPromise` (with an ASSUMPTION comment)
4. Implement all methods from the plan

Let me write the final version now.

One more thought: for `upsertCompanyTotal`, the plan says it takes `deltaAmount` and `deltaCount`. Using `$executeRaw` with an INSERT...ON CONFLICT...DO UPDATE SET total = total + delta is the correct approach for atomic increments. This handles concurrent updates correctly (PostgreSQL row-level locking).

For the `where` clause in `queryDashboard`, I need to build a Prisma where input dynamically. Let me use `Prisma.OperationsWhereInput` type.

Let me finalize:
```

## reply

```typescript
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DashboardQuery,
  DashboardResult,
  OperationRow,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

// ASSUMPTION: The plan specifies the transaction parameter type as `PrismaPromise`,
// which is not a type exported by @prisma/client. The correct type for an interactive
// transaction client is `Prisma.TransactionClient`, used here instead.

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOperation(
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operations.upsert({
      where: { order_id: order.order_id },
      create: {
        order_id: order.order_id,
        company_id: order.company_id,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
      update: {
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
    });
  }

  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationsWhereInput = {
      company_id: query.company_id,
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = query.date_from;
      if (query.date_to) where.created_at.lte = query.date_to;
    }

    const [data, total_count] = await Promise.all([
      this.prisma.operations.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { order_id: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operations.count({ where }),
    ]);

    return {
      data: data.map((row) => this.toOperationRow(row)),
      total_count,
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
    await tx.$executeRaw`
      INSERT INTO company_financial_totals (company_id, total_amount, order_count, updated_at)
      VALUES (${companyId}, ${deltaAmount}::numeric, ${deltaCount}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        total_amount = company_financial_totals.total_amount + EXCLUDED.total_amount,
        order_count  = company_financial_totals.order_count  + EXCLUDED.order_count,
        updated_at   = now()
    `;
  }

  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRaw`
      SELECT * FROM payment_orders
      WHERE created_at >= ${from} AND created_at <= ${to}
      ORDER BY created_at ASC
    ` as Promise<Record<string, unknown>[]>;
  }

  async findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null> {
    return this.prisma.workers.findUnique({
      where: { id: workerId },
      select: { id: true, name: true, role: true },
    });
  }

  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.events.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: "desc" },
      select: { event_type: true },
    });
    return event?.event_type ?? null;
  }

  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operations.findMany({
      where: {
        updated_at: { gte: from, lte: to },
      },
    });
    return rows.map((row) => this.toOperationRow(row));
  }

  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operations.findUnique({
      where: { order_id: orderId },
    });
    return row ? this.toOperationRow(row) : null;
  }

  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotals.findUnique({
      where: { company_id: companyId },
    });
    return row
      ? {
          company_id: row.company_id,
          total_amount: row.total_amount.toString(),
          order_count: row.order_count,
        }
      : null;
  }

  private toOperationRow(row: {
    order_id: string;
    company_id: string;
    status: string;
    amount: { toString(): string };
    currency: string;
    worker_name: string;
    worker_role: string;
    last_event_type: string | null;
    created_at: Date;
  }): OperationRow {
    return {
      order_id: row.order_id,
      company_id: row.company_id,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.worker_name,
      worker_role: row.worker_role,
      last_event_type: row.last_event_type,
      created_at: row.created_at,
    };
  }
}
```
