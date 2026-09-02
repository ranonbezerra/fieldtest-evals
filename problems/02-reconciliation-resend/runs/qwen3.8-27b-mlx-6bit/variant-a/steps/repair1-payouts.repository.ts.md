# repair1-payouts.repository.ts

## reasoning

```
Let me analyze the compiler errors specific to `src/payouts/payouts.repository.ts`:

1. `src/payouts/payouts.repository.ts(9,5): error TS2322: Type '{...}[]' is not assignable to type 'never[]'.`
2. `src/payouts/payouts.repository.ts(15,5): error TS2322: Type '{...}[]' is not assignable to type 'never[]'.`
3. `src/payouts/payouts.repository.ts(21,5): error TS2322: Type '{...} | null' is not assignable to type 'null'.`

The errors are about the return types. The methods `findPending`, `findInFlight`, and `findByTxid` are returning objects but their declared return types are incompatible.

Looking at the PLAN.md, the repository interface specifies:
```ts
findPending(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>;
findInFlight(effectiveDate: Date): Promise<Prisma_ordersGetPayload<never>[]>;
findByTxid(txid: string): Promise<Prisma_ordersGetPayload<never> | null>;
```

The problem is `Prisma_ordersGetPayload<never>` — when you pass `never` as the generic parameter, it resolves to an empty object `{}` or in some Prisma versions, it might not work as expected. The actual issue is that `Prisma_ordersGetPayload<never>` likely resolves to `{}` or the type doesn't match what the Prisma client actually returns.

The fix is to use the proper type. In Prisma, the generated type for an order would be `Prisma.OrderGetPayload<{}>` or simply use the model type directly. Since we're using Prisma with an `orders` model, the return type should be something like:

- For the full model without includes: `Prisma.OrderGetPayload<{}>` or just import the type from the Prisma client.

Actually, looking more carefully at the errors:
- Line 9: `Type '{ effectiveDate: Date; id: string; ... }[]' is not assignable to type 'never[]'.`
- Line 15: Same pattern
- Line 21: `Type '{...} | null' is not assignable to type 'null'.`

The return type annotations in the file must be using `never[]` and `null`. This means the current code likely has:
- `findPending` returning `Promise<never[]>`
- `findInFlight` returning `Promise<never[]>`
- `findByTxid` returning `Promise<null>`

This is probably because the code is using `Prisma_ordersGetPayload<never>` which, in the Prisma client generation, when the model is named `order` (singular), the type would be `Prisma.OrderGetPayload`. But if the code references `Prisma_ordersGetPayload` (with underscore), that's not a valid Prisma type name.

Actually, wait. Let me reconsider. The Prisma client generates types like:
- For a model `order`, you get `Prisma.OrderGetPayload<T>`
- The model type itself is `Order` from `@prisma/client`

So the fix is to use the correct type. Let me think about what the file should look like:

```ts
import { PrismaClient, Order } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  async findInFlight(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Order, 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: from },
      data: { status: to, ...patch },
    });
    return result.count > 0;
  }
}
```

Wait, but I need to check - the plan says `txid` is unique. So `findUnique` with `txid` should work if it's marked as `@unique` in the schema.

Looking at the plan again: "Indexes: `(status, effectiveDate)` for send/reconcile scans; unique on `txid` where non-null."

So `txid` should have `@unique` in the Prisma schema.

Now, the other errors in the compiler output are about other files (controller, module, service, test), but the task says to only fix `src/payouts/payouts.repository.ts`. The errors in this file are:
1. Line 9: return type `never[]` instead of the actual array type
2. Line 15: same
3. Line 21: return type `null` instead of the actual nullable type

The fix is straightforward - use proper types. I'll use `Order` from `@prisma/client` as the return type.

Let me also consider: the plan says the field names in Prisma are camelCase with `@map` to snake_case. So the model is likely called `order` in Prisma (the table is `orders`).

Let me write the complete file:
```

## reply

```typescript
import { PrismaClient, Order, OrderStatus } from '@prisma/client';

export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, effectiveDate },
    });
  }

  async findInFlight(effectiveDate: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: OrderStatus.IN_FLIGHT, effectiveDate },
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch?: Partial<Pick<Order, 'attempts' | 'txid'>>,
  ): Promise<boolean> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: from },
      data: { status: to, ...patch },
    });
    return result.count > 0;
  }
}
```
