# 03-payouts.repository.ts

## reasoning

```
Let me analyze what I need to write for `src/payouts/payouts.repository.ts` based on the plan.

From the plan, the repository should have:
- `PayoutsRepository` class
- Constructor takes `PrismaClient`
- Methods:
  - `findPending(effectiveDate: Date): Promise<...>`
  - `findInFlight(effectiveDate: Date): Promise<...>`
  - `findByTxid(txid: string): Promise<... | null>`
  - `transition(id: string, from: OrderStatus, to: OrderStatus, patch?: Partial<Pick<Order, 'attempts' | 'txid'>>): Promise<boolean>`

From the schema:
- Model `Order` with fields: id, amountCents, bankKey, status (OrderStatus), attempts, txid, effectiveDate, createdAt, updatedAt
- Enum `OrderStatus`: PENDING, IN_FLIGHT, SETTLED, REJECTED, PARKED
- Table mapped to `orders`
- Index on `[status, effectiveDate]`

Now let me think about the return types. The plan uses `Prisma_ordersGetPayload<never>[]` which is the generated Prisma type. In a NestJS project with Prisma, the generated types would be available from `@prisma/client`.

For the `transition` method, the plan says:
- "Atomically transition. Returns true if the row was updated (status matched)."
- Uses `UPDATE … WHERE id = ? AND status = $from`
- The patch can include `attempts` and `txid`

Let me think about how to implement this with Prisma:
- Use `prisma.order.updateMany({ where: { id, status: from }, data: { status: to, ...patch } })`
- Check `result.count > 0` to return boolean

Wait, the plan says "Each `repo.transition` is a single Prisma `$transaction` (or a bare parameterised UPDATE)." So I can use `updateMany` which is atomic by nature, or wrap in `$transaction`. Let me use `updateMany` since it's a single statement and inherently atomic.

Actually, looking more carefully at the plan: "Each `repo.transition` is a single Prisma `$transaction` (or a bare parameterised UPDATE)."

I'll use `updateMany` which is a single atomic operation. That's the simplest and most correct approach.

For the return types, I need to use the Prisma generated type. The plan references `Prisma_ordersGetPayload<never>` - this is the standard Prisma generated type for a model's select payload. Let me use that.

Actually, let me reconsider. The `Prisma_ordersGetPayload` type - in newer versions of Prisma, the naming convention might differ. But since the plan explicitly uses `Prisma_ordersGetPayload<never>`, I'll go with that.

Wait - looking at the Prisma client generated types, for a model called `Order` (with `@@map("orders")`), the generated type would be `Prisma.OrderGetPayload<never>`. But the plan writes `Prisma_ordersGetPayload<never>` which uses underscore. Let me check - in some Prisma versions, the generated types use the model name directly (e.g., `Prisma.OrderGetPayload`). The underscore version `Prisma_ordersGetPayload` might be from an older convention or a specific naming.

Actually, I think the plan is using a slightly non-standard notation. The actual Prisma generated type would be `Prisma.OrderGetPayload<never>` (using the model name `Order`, not the table name `orders`). Let me use `Prisma.OrderGetPayload<never>` since that's what the Prisma client actually generates.

Hmm, but I should follow the plan exactly. The plan says `Prisma_ordersGetPayload<never>`. But this isn't a real Prisma type - the real type would be `Prisma.OrderGetPayload<never>`. I think the plan is just using a shorthand/notation. Let me use the actual Prisma generated type which would be `Prisma.OrderGetPayload<never>`.

Actually, let me reconsider. In Prisma, when you have a model:
```prisma
model Order {
  ...
  @@map("orders")
}
```

The generated type in the Prisma namespace would be `Prisma.OrderGetPayload<T>`. The `@@map("orders")` only affects the database table name, not the TypeScript type names.

So I'll use `Prisma.OrderGetPayload<never>`.

Now let me also think about imports:
- `PrismaClient` from `@prisma/client`
- `Prisma` from `@prisma/client` (for the type)
- `OrderStatus` from `@prisma/client` (the enum)

Let me also think about whether I need a decorator. The plan says the repository is a provider in the module. In NestJS, it would typically use `@Injectable()`. Let me add that.

Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, OrderStatus } from '@prisma/client';

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(effectiveDate: Date) {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  async findInFlight(effectiveDate: Date) {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  async findByTxid(txid: string) {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Awaited<ReturnType<typeof this.findPending>>[number], 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const data: Record<string, unknown> = { status: to };
    if (patch) {
      if (patch.attempts !== undefined) data.attempts = patch.attempts;
      if (patch.txid !== undefined) data.txid = patch.txid;
    }
    const result = await this.prisma.order.updateMany({
      where: { id, status: from },
      data,
    });
    return result.count > 0;
  }
}
```

Hmm, but the `patch` type in the plan is `Partial<Pick<Order, 'attempts' | 'txid'>>`. The `Order` here refers to the Prisma model type. Let me use `Prisma.OrderGetPayload<never>` for the Order type reference.

Actually, let me simplify. The `Order` type from Prisma would be the full model instance type. I can just use:

```typescript
import { PrismaClient, OrderStatus, Order } from '@prisma/client';
```

And then use `Partial<Pick<Order, 'attempts' | 'txid'>>` for the patch parameter.

Wait - does Prisma export `Order` as a type? Yes, it does. Each model gets an exported type in the `@prisma/client` package.

Let me also think about the return types more carefully. The plan says:
- `findPending(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>`
- `findInFlight(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>`
- `findByTxid(txid: string): Promise<Prisma_ordersGetPayload<never> | null>`

The `Prisma.OrderGetPayload<never>` is equivalent to the `Order` type (the full model without any relation transforms). So I can either use `Promise<Order[]>` or explicitly use the Prisma namespace type. Let me use the explicit return type as the plan suggests but with correct naming.

Actually, I'll just let TypeScript infer the return types from the Prisma calls, or I can explicitly type them. Let me be explicit to match the plan's intent.

Let me finalize:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, OrderStatus, Prisma } from '@prisma/client';

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPending(effectiveDate: Date): Promise<Prisma.OrderGetPayload<never>[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  findInFlight(effectiveDate: Date): Promise<Prisma.OrderGetPayload<never>[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  findByTxid(txid: string): Promise<Prisma.OrderGetPayload<never> | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Prisma.OrderGetPayload<never>, 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const data: Record<string, unknown> = { status: to };
    if (patch) {
      if (patch.attempts !== undefined) {
        data.attempts = patch.attempts;
      }
      if (patch.txid !== undefined) {
        data.txid = patch.txid;
      }
    }
    return this.prisma.order
      .updateMany({
        where: { id, status: from },
        data,
      })
      .then((result) => result.count > 0);
  }
}
```

This looks good. Let me review against the plan:
1. ✅ `PayoutsRepository` class
2. ✅ Constructor takes `PrismaClient`
3. ✅ `findPending(effectiveDate: Date)` - finds PENDING orders for the date
4. ✅ `findInFlight(effectiveDate: Date)` - finds IN_FLIGHT orders for the date
5. ✅ `findByTxid(txid: string)` - finds by txid, returns null if not found
6. ✅ `transition(id, from, to, patch?)` - atomic state transition with status guard
7. ✅ Returns boolean from transition (true if row was updated)
8. ✅ Uses `updateMany` with `WHERE id AND status = from` for atomicity
9. ✅ Only repository layer touches the database
10. ✅ No business logic in repository

The `effectiveDate` filter - should it be exact match or range? The plan says orders have a specific `effectiveDate` (UTC midnight of settlement day). So exact match with the passed-in Date is correct.

I think this is complete and correct. Let me also make sure I'm not adding anything the plan doesn't specify - no extra methods, no extra exports beyond the class.

One thing: should I use `async` keyword or not? The plan shows methods without `async` in some cases but the return types are Promises. Using `async` is more idiomatic and makes it clear these are async methods. But since the Prisma methods already return promises, I could just return them directly without `async`. However, for the `transition` method where I have a `.then()`, using `async/await` would be cleaner. Let me use `async` for all methods for consistency and readability.

Actually, let me reconsider - if I use `async` and just `return this.prisma.order.findMany(...)`, that's fine. The async wrapper is slightly unnecessary but harmless and more readable. Let me use it.

For the transition method, I'll use async/await for clarity:

```typescript
async transition(...): Promise<boolean> {
  const data = ...;
  const result = await this.prisma.order.updateMany({ where: { id, status: from }, data });
  return result.count > 0;
}
```

This is cleaner. Let me finalize.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, OrderStatus, Prisma } from '@prisma/client';

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(effectiveDate: Date): Promise<Prisma.OrderGetPayload<never>[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  async findInFlight(effectiveDate: Date): Promise<Prisma.OrderGetPayload<never>[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  async findByTxid(txid: string): Promise<Prisma.OrderGetPayload<never> | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Prisma.OrderGetPayload<never>, 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const data: Record<string, unknown> = { status: to };
    if (patch) {
      if (patch.attempts !== undefined) {
        data.attempts = patch.attempts;
      }
      if (patch.txid !== undefined) {
        data.txid = patch.txid;
      }
    }
    const result = await this.prisma.order.updateMany({
      where: { id, status: from },
      data,
    });
    return result.count > 0;
  }
}
```
