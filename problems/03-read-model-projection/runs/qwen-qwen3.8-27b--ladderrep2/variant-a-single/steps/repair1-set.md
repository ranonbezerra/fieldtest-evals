# repair1-set

## reasoning

```
Let me analyze the errors holistically to identify the distinct mistakes:

1. **`PaymentOrder` is not exported from `@prisma/client`** — The Prisma schema defines the model as `Order` (mapped to `orders` table), not `PaymentOrder`. So `Prisma.Order` is the correct type, and `prisma.order` is the correct client property. The code references `PaymentOrder` and `prisma.paymentOrder` throughout.

2. **`orderEvent` does not exist on `TransactionClient`** — The Prisma schema defines the model as `Event` (mapped to `events` table), not `OrderEvent`. So `prisma.event` / `tx.event` is the correct property.

3. **Type mismatches: `number` vs `string`** — The Prisma schema uses `String @id @default(uuid())` for all model IDs. But the code uses `number` for order IDs, worker IDs, and company IDs in several places. Let me trace through:

Looking at the schema:
- `Company.id` is `String`
- `Worker.id` is `String`, `Worker.companyId` is `String`
- `Order.id` is `String`, `Order.companyId` is `String`, `Order.workerId` is `String`
- `Event.id` is `String`, `Event.orderId` is `String`
- `OperationReadModel.id` is `String`, `OperationReadModel.orderId` is `String`, etc.

Now let me look at the errors:

**payment-orders.repository.ts:**
- Line 2: `import type { PaymentOrder, Prisma, Worker } from '@prisma/client'` → Should be `Order` not `PaymentOrder`
- Line 12: `this.prisma.paymentOrder` → Should be `this.prisma.order`
- Line 16: `findById(orderId: number)` → Should be `orderId: string`
- Line 23: `tx.paymentOrder` → Should be `tx.order`
- Line 27: `tx.orderEvent` → Should be `tx.event`
- Line 49: `tx.paymentOrder` → Should be `tx.order`
- Line 54: `tx.paymentOrder` → Should be `tx.order`

**payment-orders.service.ts:**
- Line 2: `import type { PaymentOrder } from '@prisma/client'` → Should be `Order`

**test/operations.spec.ts:**
- Line 38: `worker.create({ data: { companyId: 10, name: 'A' } })` — `companyId` is `String` in schema, but passing number `10`. Wait, let me look more carefully.

Actually wait. Let me re-read the schema:

```
model Worker {
  id        String  @id @default(uuid())
  name      String
  companyId String
  @@map("workers")
}
```

So `Worker.companyId` is `String`. The test passes `companyId: 10` (a number). That's the error on line 38.

But wait, the tests also pass `companyId: 1` to `orders.create({ companyId: 1, ... })`. Let me check what `CreatePaymentOrderInput` looks like in the service:

```typescript
export interface CreatePaymentOrderInput {
  companyId: number;
  workerId: number;
  amountCents: number;
}
```

So the service interface uses `number` for `companyId` and `workerId`, but the Prisma schema uses `String` for those fields. The repository then passes them to Prisma which expects strings.

Let me look at the test errors more carefully:

**test/payment-orders.spec.ts:**
- Line 33: `prisma.worker.create({ data: { companyId: 1, name: 'Ana' } })` — `companyId` is `String` in schema, passing number `1`
- Line 34: `orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 })` — `workerId` is `number` in `CreatePaymentOrderInput` but `worker.id` is `String`
- Line 61: same pattern
- Line 62: same pattern
- Line 89: same pattern
- Line 90: same pattern
- Line 102: `prisma.paymentOrder` → should be `prisma.order`
- Line 112: same companyId number issue
- Line 116: same workerId string/number issue

**test/operations.spec.ts:**
- Line 38: `prisma.worker.create({ data: { companyId: 10, name: 'A' } })` — companyId is String, passing number
- Lines 46-49: `orders.create({ companyId: 10, workerId: w10.id, ... })` — `workerId` is `number` in interface but `w10.id` is `String`
- Line 84: `worker.create({ data: { companyId: 20, name: 'Old Name' } })` — companyId number
- Lines 100-101: `orders.create({ companyId: 30, workerId: worker.id, ... })` — workerId
- Lines 141-142: `orders.create({ companyId: 40, workerId: worker.id, ... })` — workerId

So the distinct mistakes are:

1. **`PaymentOrder` → `Order`** (the Prisma model name is `Order`, not `PaymentOrder`). This affects:
   - `payment-orders.repository.ts`: import type, and all `prisma.paymentOrder` / `tx.paymentOrder` → `prisma.order` / `tx.order`
   - `payment-orders.service.ts`: import type
   - `test/payment-orders.spec.ts`: `prisma.paymentOrder` → `prisma.order`

2. **`orderEvent` → `event`** (the Prisma model name is `Event`, not `OrderEvent`). This affects:
   - `payment-orders.repository.ts`: `tx.orderEvent` → `tx.event`

3. **`number` → `string` for IDs** — The Prisma schema uses `String` for all IDs and foreign keys. The code uses `number` in several places. I need to change:
   - `payment-orders.repository.ts`: `findById(orderId: number)` → `findById(orderId: string)`, and the `transitionInTransaction` method signature `orderId: number` → `orderId: string`
   - `payment-orders.service.ts`: `CreatePaymentOrderInput.companyId: number` → `string`, `workerId: number` → `string`, `approve/reject/refund(orderId: number)` → `(orderId: string)`, and the internal `transition` method
   - `test/payment-orders.spec.ts`: All `companyId: 1` → `companyId: '1'`, `workerId: 9999` → `workerId: '9999'`, `orders.approve(999999)` → `orders.approve('999999')`
   - `test/operations.spec.ts`: All `companyId: 10` → `companyId: '10'`, etc.

Wait, but the test files reference things like `ops.getCompanyTotals(1)` and `ops.listOperations({ companyId: 1, ... })`. Let me check what those signatures look like. I don't have the operations service code directly, but based on the errors, only the specific lines mentioned have errors. Let me focus on exactly what the compiler reports.

Let me re-examine each error:

**payment-orders.repository.ts:**
1. `(2,15)`: `PaymentOrder` not exported → change to `Order`
2. `(12,24)`: `paymentOrder` not on PrismaService → change to `order`
3. `(16,44)`: `number` not assignable to `string` → `findById` param should be `string`
4. `(23,15)`: `paymentOrder` not on TransactionClient → `order`
5. `(27,15)`: `orderEvent` not on TransactionClient → `event`
6. `(49,31)`: `paymentOrder` not on Omit<...> → `order`
7. `(54,34)`: `paymentOrder` not on Omit<...> → `order`

**payment-orders.service.ts:**
1. `(2,15)`: `PaymentOrder` not exported → `Order`

**test/operations.spec.ts:**
1. `(38,43)`: `number` not assignable to `string` — `companyId: 10` in worker.create
2. `(46,52)`: `string` not assignable to `number` — `workerId: w10.id` where interface expects number
3. `(47,52)`: same
4. `(48,52)`: same
5. `(49,52)`: same
6. `(84,56)`: `string` not assignable to `number` — likely `workerId: worker.id`
7. `(100,53)`: same
8. `(101,53)`: same
9. `(141,53)`: same
10. `(142,53)`: same

**test/payment-orders.spec.ts:**
1. `(33,57)`: `number` not assignable to `string` — `companyId: 1` in worker.create
2. `(34,57)`: `string` not assignable to `number` — `workerId: worker.id`
3. `(61,57)`: `number` not assignable to `string` — `companyId: 1`
4. `(62,55)`: `string` not assignable to `number` — `workerId: worker.id`
5. `(89,57)`: `number` not assignable to `string` — `companyId: 2`
6. `(90,55)`: `string` not assignable to `number` — `workerId: worker.id`
7. `(102,32)`: `paymentOrder` not on PrismaService → `order`
8. `(112,57)`: `number` not assignable to `string` — `companyId: 7`
9. `(116,56)`: `string` not assignable to `number` — `workerId: worker.id`

So the distinct mistakes are:

**Mistake 1:** Model name `PaymentOrder` should be `Order` (the Prisma model is named `Order`).
- Fix: change all `PaymentOrder` type references to `Order`, and all `prisma.paymentOrder` / `tx.paymentOrder` to `prisma.order` / `tx.order`.

**Mistake 2:** Model name `orderEvent` should be `event` (the Prisma model is named `Event`).
- Fix: change `tx.orderEvent` to `tx.event`.

**Mistake 3:** ID types are `number` in code but `string` in the Prisma schema.
- Fix: Change `companyId` and `workerId` in `CreatePaymentOrderInput` from `number` to `string`.
- Fix: Change `orderId` parameters from `number` to `string` in repository and service.
- Fix: In tests, change numeric literals for `companyId` to string literals (e.g., `1` → `'1'`), and for standalone order IDs like `999999` → `'999999'`, `9999` → `'9999'`.

Wait, but if I change `CreatePaymentOrderInput.companyId` to `string`, then in the tests where they do `orders.create({ companyId: 1, ... })`, the `1` would be a number not assignable to string. So I need to change those to `'1'` etc.

And if I change `workerId` in `CreatePaymentOrderInput` to `string`, then `worker.id` (which is already a string from Prisma) would be fine. The error "string is not assignable to number" confirms that `worker.id` is a string being passed where a number is expected.

For the `companyId` in `worker.create({ data: { companyId: 1, ... })` — this goes directly to Prisma which expects a string. So I need to change `1` to `'1'`.

For `orders.approve(999999)` — the parameter type needs to be `string`, so `999999` → `'999999'`.

For `workerId: 9999` in `orders.create` — needs to be `'9999'`.

Now let me also check: in the test, `ops.getCompanyTotals(1)` and `ops.listOperations({ companyId: 1, ... })` — these are NOT in the error list, so the operations service must already accept the types that the tests pass, OR those specific lines don't have type errors because the operations service uses different types. Since the compiler doesn't flag them, I should leave them alone.

Wait, actually looking more carefully at the test errors for operations.spec.ts:
- Line 38: `companyId: 10` in `worker.create` — this is a direct Prisma call, so Prisma expects string
- Lines 46-49: `workerId: w10.id` in `orders.create` — the service interface expects number but w10.id is string

And for payment-orders.spec.ts:
- Line 33: `companyId: 1` in `worker.create` — direct Prisma call
- Line 34: `workerId: worker.id` in `orders.create` — service interface expects number

So I need to:
1. Change `CreatePaymentOrderInput.workerId` from `number` to `string`
2. Change `CreatePaymentOrderInput.companyId` from `number` to `string`
3. In tests, change `companyId: 1` (in worker.create) to `companyId: '1'`, etc.
4. In tests, change `companyId: 1` (in orders.create) to `companyId: '1'`, etc.
5. Change `orderId` params from `number` to `string` in service and repository
6. In tests, change `orders.approve(999999)` to `orders.approve('999999')`
7. In tests, change `workerId: 9999` to `workerId: '9999'`

But wait — if I change `CreatePaymentOrderInput.companyId` to `string`, then in the tests `orders.create({ companyId: 1, ... })` would error because `1` is a number not assignable to string. The error list shows `test/payment-orders.spec.ts(34,57): error TS2322: Type 'string' is not assignable to type 'number'` which is about `workerId: worker.id` (string not assignable to number). After I fix the interface to use `string`, this error goes away. But then `companyId: 1` would become a NEW error (number not assignable to string).

Hmm, but the instructions say "Fix all of them in one reply" and "Change exactly what the compiler requires." I need to fix the current errors without introducing new ones. So if changing `companyId` to `string` in the interface would cause `companyId: 1` in tests to be a new error, I need to fix those too.

Actually, let me re-read: "Fix all of them in one reply." The goal is to make typecheck pass. So I need to ensure no errors remain. If my fix to one file introduces errors in another, I need to fix those too.

Let me trace through what changes are needed:

**payment-orders.repository.ts:**
- Line 2: `import type { PaymentOrder, Prisma, Worker } from '@prisma/client'` → `import type { Order, Prisma, Worker } from '@prisma/client'`
- Line 11 (approx): `findById(orderId: number)` → `findById(orderId: string)`
- Line 12: `this.prisma.paymentOrder` → `this.prisma.order`
- Line 16: the return type `PaymentOrder` → `Order`
- Line 23: `tx.paymentOrder` → `tx.order`
- Line 27: `tx.orderEvent` → `tx.event`
- Line 49: `tx.paymentOrder` → `tx.order`
- Line 54: `tx.paymentOrder` → `tx.order`
- Also `transitionInTransaction` takes `orderId: number` → `orderId: string`
- `insertOrder` takes `data: { companyId: number; workerId: number; amountCents: number }` → `{ companyId: string; workerId: string; amountCents: number }`

Wait, but `insertOrder` calls `tx.paymentOrder.create({ data })` which after fixing becomes `tx.order.create({ data })`. The `Order` model has `companyId: String` and `workerId: String`, so the data type should use strings.

**payment-orders.service.ts:**
- Line 2: `import type { PaymentOrder } from '@prisma/client'` → `import type { Order } from '@prisma/client'`
- `CreatePaymentOrderInput.companyId: number` → `string`
- `CreatePaymentOrderInput.workerId: number` → `string`
- `create` return type: `Promise<PaymentOrder>` → `Promise<Order>`
- `approve(orderId: number)` → `approve(orderId: string)`
- `reject(orderId: number)` → `reject(orderId: string)`
- `refund(orderId: number)` → `refund(orderId: string)`
- `transition(action: OrderAction, orderId: number)` → `transition(action: OrderAction, orderId: string)`

**test/payment-orders.spec.ts:**
- Line 33: `companyId: 1` → `companyId: '1'` (in worker.create)
- Line 34: `companyId: 1` → `companyId: '1'` (in orders.create), `workerId: worker.id` stays (now string is correct)
- Line 61: `companyId: 1` → `companyId: '1'`
- Line 62: `workerId: worker.id` stays
- Line 89: `companyId: 2` → `companyId: '2'`
- Line 90: `workerId: worker.id` stays
- Line 102: `prisma.paymentOrder` → `prisma.order`
- Line 112: `companyId: 7` → `companyId: '7'`
- Line 116: `workerId: worker.id` stays
- Also: `orders.approve(999999)` → `orders.approve('999999')`
- Also: `workerId: 9999` → `workerId: '9999'`

Wait, let me look at the test more carefully. Line 62 in the original:
```
await expect(orders.approve(order.id)).rejects.toMatchObject({
```
That's fine, `order.id` is already a string.

Let me look at line 61-62 area:
```
const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });
await orders.approve(order.id);
```
Line 61 is the create with `companyId: 1` → needs `'1'`
Line 62 is `orders.approve(order.id)` — `order.id` is string, and after fix `approve` takes string, so this is fine.

Wait, the error says `(62,55): error TS2322: Type 'string' is not assignable to type 'number'`. Let me count columns... In the original test:

```
  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);
```

Line 61 would be `const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });`
- Column 57 would be around `workerId: worker.id` — the `worker.id` part. Error: `string` not assignable to `number` (because `workerId` in interface is `number`).

Line 62 would be `await orders.approve(order.id);`
- Column 55... hmm, that doesn't seem right for a simple line. Let me recount.

Actually, I don't need to be exact about column numbers. The point is:
- Wherever `companyId` is a number literal being passed to a Prisma create or to the service's create, it needs to be a string.
- Wherever `workerId` is `worker.id` (a string) being passed to the service's create, the interface needs to accept string.
- Wherever `orderId` is a number literal (like `999999`, `9999`), it needs to be a string.

Let me also check: `ops.getCompanyTotals(1)` — is this in the error list? No. So either the operations service already accepts `string` for companyId, or it accepts `number`. Since there's no error, I'll leave it. But wait, if I change `CreatePaymentOrderInput.companyId` to `string`, that's a different interface from what `ops.getCompanyTotals` uses. The operations service has its own input types.

Actually, I realize I should be more careful. Let me look at what the test passes to `ops`:
- `ops.listOperations({ companyId: 1, page: 1, pageSize: 10 })`
- `ops.getCompanyTotals(1)`

These are NOT in the error list. So the operations service must define `companyId` as `number` in its input types, OR it defines it as a union that accepts both. Since there's no error, I won't touch the operations service or those test lines.

But wait — if the Prisma schema has `companyId` as `String` in all models, and the operations service queries the projection table with `companyId`, then the operations service must be converting or using string internally. The fact that the tests pass `companyId: 1` (number) to `ops.listOperations` without error means the operations service's input type must be `number` or `number | string`. I'll leave it alone since there's no error.

OK so let me also check: in the test, `orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 })` — after I change the interface to `companyId: string`, the `1` becomes a type error. So I MUST change it to `'1'`.

Similarly for all other `companyId: <number>` in `orders.create` calls.

And for `worker.create({ data: { companyId: 1, ... } })` — this goes directly to Prisma which expects `string`, so `1` must become `'1'`.

Let me now write out all the files:

**Files to change:**
1. `src/payment-orders/payment-orders.repository.ts`
2. `src/payment-orders/payment-orders.service.ts`
3. `test/payment-orders.spec.ts`
4. `test/operations.spec.ts`

Let me write each one:

### src/payment-orders/payment-orders.repository.ts

```typescript
import { Injectable } from '@nestjs/common';
import type { Order, Prisma, Worker } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  workerInTransaction(tx: Prisma.TransactionClient, workerId: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id: workerId } });
  }

  insertOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string; amountCents: number },
  ): Promise<Order> {
    return tx.order.create({ data });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: string, kind: string): Promise<void> {
    return tx.event.create({ data: { orderId, kind } }).then(() => undefined);
  }

  /** Runs the write and its synchronous projection maintenance in one transaction. */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Atomic status transition: the UPDATE matches only while the order is
   * still `from`. Two racing transitions on the same order serialize on the
   * row lock; the loser matches zero rows and gets a typed error. `work`
   * (the projection maintenance hook) runs in the same transaction, so it
   * commits or rolls back with the write.
   */
  transitionInTransaction(
    orderId: string,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status },
        );
      }
      await work(tx);
      return orderId;
    });
  }
}
```

Wait, `transitionInTransaction` returns `Promise<number>` but `orderId` is now a `string`. Let me check what the service does with the return value... In the service:

```typescript
approve(orderId: number): Promise<number> {
  return this.transition('approve', orderId);
}
```

And `transition` returns `this.repo.transitionInTransaction(...)`. So if `transitionInTransaction` returns `string`, then `approve` should return `Promise<string>`.

But wait — the tests do:
```typescript
await expect(orders.refund(order.id)).resolves.toBe(order.id);
```

So `refund` resolves to the order ID, which is a string. That's consistent.

Let me check if there are any other places where the return type matters... The test does `const created = await orders.create(...)` and then uses `created.id`. That's fine.

So `transitionInTransaction` should return `Promise<string>`.

### src/payment-orders/payment-orders.service.ts

```typescript
import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;

export interface CreatePaymentOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<Order> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, {
          workerId: input.workerId,
        });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: string): Promise<string> {
    return this.transition('approve', orderId);
  }

  reject(orderId: string): Promise<string> {
    return this.transition('reject', orderId);
  }

  refund(orderId: string): Promise<string> {
    return this.transition('refund', orderId);
  }

  private transition(action: OrderAction, orderId: string): Promise<string> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from },
        );
      }
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
}
```

Now for the tests. Let me carefully go through each:

### test/payment-orders.spec.ts

Looking at the original:
```typescript
describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    ...
```

Changes needed:
- `companyId: 1` in `worker.create` → `companyId: '1'`
- `companyId: 1` in `orders.create` → `companyId: '1'`
- `companyId: 1` in `ops.listOperations` — NOT in error list, leave as is? But wait, if the operations service expects `number` for companyId, that's fine. But if it expects `string`... Hmm.

Actually, the key insight: the errors only flag specific lines. Lines NOT in the error list are currently type-checking fine. So `ops.listOperations({ companyId: 1, ... })` is fine as-is. I should NOT change it.

But `orders.create({ companyId: 1, ... })` IS in the error list (well, the `companyId: 1` part isn't directly flagged, but after I change the interface, it would be). Wait no — the current error on that line is about `workerId: worker.id` (string not assignable to number). After I fix the interface to use `string` for both, `companyId: 1` would become a new error.

So I MUST change `companyId: 1` to `companyId: '1'` in `orders.create` calls to avoid introducing new errors.

Similarly, `prisma.worker.create({ data: { companyId: 1, ... } })` is currently flagged (number not assignable to string), so I must change it to `companyId: '1'`.

Let me go through the test file line by line:

```typescript
it('a create and an approve are visible...', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });  // ERROR: companyId 1 → '1'
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });  // ERROR: workerId (will be fixed by interface change), but companyId 1 → '1' to avoid new error
```

Wait, I need to be more careful. The CURRENT errors are:
- Line 33, col 57: `number` not assignable to `string` → this is `companyId: 1` in worker.create
- Line 34, col 57: `string` not assignable to `number` → this is `workerId: worker.id` in orders.create

After my fix:
- `companyId: 1` in worker.create → must change to `'1'` (fixes current error)
- `companyId: 1` in orders.create → after interface change to `string`, this would be a NEW error, so must change to `'1'`
- `workerId: worker.id` in orders.create → after interface change to `string`, this is now correct (string assignable to string)

OK so I need to change ALL `companyId: <number>` in both `worker.create` and `orders.create` to `companyId: '<number>'`.

And `workerId: 9999` (a literal number) → `workerId: '9999'`.
And `orders.approve(999999)` → `orders.approve('999999')`.

Let me now write out the complete test files.

### test/payment-orders.spec.ts (complete):

```typescript
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const created = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    expect(asPending.items).toHaveLength(1);
    expect(asPending.items[0].status).toBe('pending');
    expect(asPending.items[0].lastEventKind).toBe('created');
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(12000);

    await orders.approve(created.id);

    const asApproved = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    const item = asApproved.items.find((i) => i.orderId === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    expect(item!.amountCents).toBe(12000);
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const order = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);

    await expect(orders.approve(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.reject(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.refund(order.id)).resolves.toBe(order.id);
    await expect(orders.refund(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.approve('999999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'resource_not_found',
    });
    await expect(orders.create({ companyId: '1', workerId: '9999', amountCents: 1 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '2', name: 'Bo' } });
    const order = await orders.create({ companyId: '2', workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);

    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2',
        );
        throw new Error('simulate a failure after the source update');
      }),
    ).rejects.toThrow('simulate a failure after the source update');

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '7', name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const amountCents of amounts) {
      created.push(await orders.create({ companyId: '7', workerId: worker.id, amountCents }));
    }
    const totalsBefore = await ops.getCompanyTotals(7);
    expect(totalsBefore.pendingCount).toBe(4);
    expect(totalsBefore.pendingAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.amountCents).sort((a, b) => b - a)).toEqual([4000, 2500, 1000, 555]);
  });
});
```

### test/operations.spec.ts (complete):

Looking at the original, the changes needed:
- Line 38: `companyId: 10` → `companyId: '10'` (in worker.create)
- Lines 46-49: `companyId: 10` → `companyId: '10'` (in orders.create), `companyId: 11` → `companyId: '11'`
- Line 84: `companyId: 20` → `companyId: '20'` (in worker.create)
- Lines 100-101: `companyId: 30` → `companyId: '30'` (in orders.create)
- Lines 141-142: `companyId: 40` → `companyId: '40'` (in orders.create)

And the `seedWorker` helper:
```typescript
async function seedWorker(companyId: number, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
}
```
This needs to change to `companyId: string` since Prisma expects string.

Wait, but then the calls to `seedWorker(10, 'A')` would pass a number where string is expected. Let me check if those are in the error list...

The error at line 38 is `companyId: 10` which is inside the `seedWorker` function call? No wait, let me re-read the test:

```typescript
async function seedWorker(companyId: number, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
}
```

If `companyId` is typed as `number` in the function signature, and it's passed to `prisma.worker.create` which expects `string`, that's the error. The fix is to change the parameter type to `string`, and then the callers must pass strings.

But wait, the callers are like `seedWorker(10, 'A')`. If I change the param to `string`, then `10` is a number not assignable to string. So I need to change the callers too: `seedWorker('10', 'A')`.

But are those caller lines in the error list? Let me check... The error list for operations.spec.ts shows:
- (38,43): `number` not assignable to `string`
- (46,52): `string` not assignable to `number`
- (47,52): same
- (48,52): same
- (49,52): same
- (84,56): `string` not assignable to `number`
- (100,53): same
- (101,53): same
- (141,53): same
- (142,53): same

Line 38 is likely `return prisma.worker.create({ data: { companyId, name } });` inside the `seedWorker` function — the `companyId` variable (typed as number) being passed where string is expected.

Lines 46-49 are the `orders.create` calls with `workerId: w10.id` etc.

Line 84 is likely another `orders.create` with `workerId: worker.id`.

So I need to:
1. Change `seedWorker` param from `number` to `string`
2. Change all `seedWorker(10, ...)` calls to `seedWorker('10', ...)`
3. Change all `companyId: <number>` in `orders.create` to `companyId: '<number>'`

Let me look at the test more carefully to identify all the lines:

```typescript
  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker(10, 'A');       // line ~43
    const w11 = await seedWorker(11, 'B');       // line ~44
    const a = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 100 });  // line 46
    const b = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 200 });  // line 47
    const c = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 300 });  // line 48
    const d = await orders.create({ companyId: 11, workerId: w11.id, amountCents: 500 });  // line 49
```

So I need to change:
- `seedWorker(10, 'A')` → `seedWorker('10', 'A')`
- `seedWorker(11, 'B')` → `seedWorker('11', 'B')`
- `companyId: 10` → `companyId: '10'` (in orders.create)
- `companyId: 11` → `companyId: '11'` (in orders.create)

And similarly for the other test cases.

Let me also check: `ops.listOperations({ companyId: 10, ... })` — NOT in error list, so leave as is.
`ops.getCompanyTotals(10)` — NOT in error list, leave as is.

Now let me write the complete operations.spec.ts:

```typescript
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { ReprojectionService } from '../src/operations/reprojection.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('operations read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;
  let reproject: ReprojectionService;
  let drift: DriftRepairJob;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
    reproject = app.get(ReprojectionService);
    drift = app.get(DriftRepairJob);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedWorker(companyId: string, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
  }

  const windowTo = () => new Date(Date.now() + 60_000);

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker('10', 'A');
    const w11 = await seedWorker('11', 'B');
    const a = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 100 });
    const b = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 200 });
    const c = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 300 });
    const d = await orders.create({ companyId: '11', workerId: w11.id, amountCents: 500 });
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(d.id), orders.reject(c.id)]);

    // Backdate one order in the source, then re-derive so the projection carries it.
    await prisma.$executeRawUnsafe(
      `UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`,
    );
    await reproject.rederive(new Date(0), windowTo());

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]);

    const approvedOnly = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await ops.listOperations({ companyId: 10, from: oneHourAgo, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: oneHourAgo, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    const page1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(page1.items.map((i) => i.orderId)).toEqual([c.id, b.id]);
    expect(page1.total).toBe(3);
    const page2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(page2.items.map((i) => i.orderId)).toEqual([a.id]);

    const otherCompany = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(otherCompany.items.map((i) => i.orderId)).toEqual([d.id]);
  });

  it('the dashboard reads only the projection: a source-only change is invisible until re-derivation', async () => {
    const worker = await seedWorker('20', 'Old Name');
    const order = await orders.create({ companyId: '20', workerId: worker.id, amountCents: 10 });
    await orders.approve(order.id);

    // No worker write path exists: this source change happens outside the hooks.
    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${worker.id}`);

    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // hot path does not join workers

    await reproject.rederive(new Date(0), windowTo());
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window from the source and is idempotent', async () => {
    const worker = await seedWorker('30', 'D');
    const o1 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`,
    );
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);

    const first = await reproject.rederive(new Date(0), windowTo());
    expect(first.orders).toBe(2);

    const snapshot = async () => ({
      rows: await prisma.$queryRawUnsafe(
        `SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
         FROM operations_read_model WHERE company_id = 30 ORDER BY order_id`,
      ),
      totals: await prisma.$queryRawUnsafe(
        `SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
                rejected_count, rejected_amount, refunded_count, refunded_amount
         FROM company_totals WHERE company_id = 30`,
      ),
    });

    const afterFirst = await snapshot();
    expect(afterFirst.rows).toHaveLength(2);
    for (const row of afterFirst.rows as Array<{ status: string }>) {
      expect(row.status).toBe('approved');
    }
    const totalsRow = (afterFirst.totals as Array<Record<string, unknown>>)[0];
    expect(Number(totalsRow.approved_count)).toBe(2);
    expect(Number(totalsRow.approved_amount)).toBe(333);
    expect(Number(totalsRow.pending_count)).toBe(0);

    await reproject.rederive(new Date(0), windowTo());
    const afterSecond = await snapshot();
    expect(afterSecond).toEqual(afterFirst);
  });

  it('the drift-repair job detects injected drift and repairs it', async () => {
    const worker = await seedWorker('40', 'E');
    const o1 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    // Inject drift: one row wrong, one row missing, totals off.
    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(
      `UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`,
    );

    const report = await drift.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();

    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.status).toBe('approved');
      expect(item.lastEventKind).toBe('approved');
    }
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);

    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
    expect(clean.repaired).toBeNull();
  });
});
```

Now let me double-check the `transitionInTransaction` return type. In the repository, it returns `orderId` which is now a `string`. The service's `transition` method returns the result of `transitionInTransaction`, so it should be `Promise<string>`. And `approve/reject/refund` return `Promise<string>`.

In the test: `await expect(orders.refund(order.id)).resolves.toBe(order.id)` — `order.id` is a string, and `refund` returns `Promise<string>`, so `.resolves.toBe(order.id)` works fine.

Let me also verify: in the rolled-back test, `repo.transitionInTransaction(order.id, 'pending', 'approved', ...)` — `order.id` is a string (from the Order model), and the method now accepts `string`. Good.

One more thing to check: the `insertOrder` method in the repository. It takes `data: { companyId: string; workerId: string; amountCents: number }` and calls `tx.order.create({ data })`. The Prisma `Order` model has `amount` as `Decimal @db.Decimal(12, 2)`, not `amountCents`. Hmm, but this is the existing code structure and the compiler doesn't flag this. The `amountCents` field doesn't exist on the Prisma model...

Wait, actually looking at the schema again:
```
model Order {
  id        String   @id @default(uuid())
  companyId String
  workerId  String
  status    String
  amount    Decimal  @db.Decimal(12, 2)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("orders")
}
```

The field is `amount`, not `amountCents`. But the code passes `amountCents` in the data. This would be a type error... but it's NOT in the error list. So either:
1. The Prisma client has been generated with different field names (unlikely)
2. The `@map` on the field maps it differently
3. There's something else going on

Wait, I don't see a `@map` on the `amount` field. So in the Prisma client, it would be `amount` not `amountCents`. But the error list doesn't include this...

Hmm, maybe the Prisma client hasn't been generated yet, or the type definitions are loose enough that this doesn't show up. Or maybe I'm wrong about the schema. Let me re-read...

Actually, you know what, the instructions say "Fix all of them" referring to the listed errors. If the compiler doesn't flag `amountCents` vs `amount`, then either:
- The Prisma client is generated with `amountCents` as the field name (maybe there's a `@map` I'm missing, or the schema shown is slightly different from what's actually in the workspace)
- Or the type checking is loose enough

Since it's NOT in the error list, I should NOT change it. The instruction is clear: "Change exactly what the compiler requires."

Similarly, the `status` field in the `Order` model is `String`, and the code uses `status: 'pending'` etc. as string literals, which is fine.

OK, I'm confident in my changes. Let me also double-check: in the repository, `workerInTransaction` takes `workerId: number` in the original. I'm changing it to `string`. The caller in the service passes `input.workerId` which after my interface change is `string`. Good.

Let me finalize my four files.
```

## reply

Looking at the errors as a whole, I see three distinct mistakes:

1. **Model name `PaymentOrder` should be `Order`** — the Prisma schema names the model `Order`. This causes `PaymentOrder` type not exported, and `prisma.paymentOrder` / `tx.paymentOrder` not existing.
2. **Model name `orderEvent` should be `event`** — the Prisma schema names the model `Event`.
3. **ID types are `number` in code but `string` in the Prisma schema** — all IDs and FKs are `String @id @default(uuid())` or `String`, so parameters and literals must be `string`.

### src/payment-orders/payment-orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Order, Prisma, Worker } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  workerInTransaction(tx: Prisma.TransactionClient, workerId: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id: workerId } });
  }

  insertOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string; amountCents: number },
  ): Promise<Order> {
    return tx.order.create({ data });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: string, kind: string): Promise<void> {
    return tx.event.create({ data: { orderId, kind } }).then(() => undefined);
  }

  /** Runs the write and its synchronous projection maintenance in one transaction. */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Atomic status transition: the UPDATE matches only while the order is
   * still `from`. Two racing transitions on the same order serialize on the
   * row lock; the loser matches zero rows and gets a typed error. `work`
   * (the projection maintenance hook) runs in the same transaction, so it
   * commits or rolls back with the write.
   */
  transitionInTransaction(
    orderId: string,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status },
        );
      }
      await work(tx);
      return orderId;
    });
  }
}
```

### src/payment-orders/payment-orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

// ASSUMPTION: the simulated write path is create plus these transitions;
// refund is only valid from approved.
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;

export interface CreatePaymentOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<Order> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, {
          workerId: input.workerId,
        });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous projection maintenance hook: runs inside this very
      // transaction, so the read model is updated at the same instant as the
      // source row, and a rolled-back create leaves no projection trace.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: string): Promise<string> {
    return this.transition('approve', orderId);
  }

  reject(orderId: string): Promise<string> {
    return this.transition('reject', orderId);
  }

  refund(orderId: string): Promise<string> {
    return this.transition('refund', orderId);
  }

  private transition(action: OrderAction, orderId: string): Promise<string> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from },
        );
      }
      // transitionInTransaction re-checks the status under the row lock, so a
      // concurrent transition on the same order wins or loses atomically.
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // Synchronous projection maintenance hook, in the same transaction as
        // the source write: order row, event, projection row and totals all
        // commit together.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
}
```

### test/payment-orders.spec.ts
```ts
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const created = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    expect(asPending.items).toHaveLength(1);
    expect(asPending.items[0].status).toBe('pending');
    expect(asPending.items[0].lastEventKind).toBe('created');
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(12000);

    await orders.approve(created.id);

    const asApproved = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    const item = asApproved.items.find((i) => i.orderId === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    expect(item!.amountCents).toBe(12000);
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const order = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);

    await expect(orders.approve(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.reject(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.refund(order.id)).resolves.toBe(order.id);
    await expect(orders.refund(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.approve('999999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'resource_not_found',
    });
    await expect(orders.create({ companyId: '1', workerId: '9999', amountCents: 1 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '2', name: 'Bo' } });
    const order = await orders.create({ companyId: '2', workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);

    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2',
        );
        throw new Error('simulate a failure after the source update');
      }),
    ).rejects.toThrow('simulate a failure after the source update');

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '7', name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const amountCents of amounts) {
      created.push(await orders.create({ companyId: '7', workerId: worker.id, amountCents }));
    }
    const totalsBefore = await ops.getCompanyTotals(7);
    expect(totalsBefore.pendingCount).toBe(4);
    expect(totalsBefore.pendingAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.amountCents).sort((a, b) => b - a)).toEqual([4000, 2500, 1000, 555]);
  });
});
```

### test/operations.spec.ts
```ts
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { ReprojectionService } from '../src/operations/reprojection.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('operations read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;
  let reproject: ReprojectionService;
  let drift: DriftRepairJob;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
    reproject = app.get(ReprojectionService);
    drift = app.get(DriftRepairJob);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedWorker(companyId: string, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
  }

  const windowTo = () => new Date(Date.now() + 60_000);

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker('10', 'A');
    const w11 = await seedWorker('11', 'B');
    const a = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 100 });
    const b = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 200 });
    const c = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 300 });
    const d = await orders.create({ companyId: '11', workerId: w11.id, amountCents: 500 });
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(d.id), orders.reject(c.id)]);

    // Backdate one order in the source, then re-derive so the projection carries it.
    await prisma.$executeRawUnsafe(
      `UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`,
    );
    await reproject.rederive(new Date(0), windowTo());

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]);

    const approvedOnly = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await ops.listOperations({ companyId: 10, from: oneHourAgo, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: oneHourAgo, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    const page1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(page1.items.map((i) => i.orderId)).toEqual([c.id, b.id]);
    expect(page1.total).toBe(3);
    const page2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(page2.items.map((i) => i.orderId)).toEqual([a.id]);

    const otherCompany = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(otherCompany.items.map((i) => i.orderId)).toEqual([d.id]);
  });

  it('the dashboard reads only the projection: a source-only change is invisible until re-derivation', async () => {
    const worker = await seedWorker('20', 'Old Name');
    const order = await orders.create({ companyId: '20', workerId: worker.id, amountCents: 10 });
    await orders.approve(order.id);

    // No worker write path exists: this source change happens outside the hooks.
    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${worker.id}`);

    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // hot path does not join workers

    await reproject.rederive(new Date(0), windowTo());
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window from the source and is idempotent', async () => {
    const worker = await seedWorker('30', 'D');
    const o1 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`,
    );
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);

    const first = await reproject.rederive(new Date(0), windowTo());
    expect(first.orders).toBe(2);

    const snapshot = async () => ({
      rows: await prisma.$queryRawUnsafe(
        `SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
         FROM operations_read_model WHERE company_id = 30 ORDER BY order_id`,
      ),
      totals: await prisma.$queryRawUnsafe(
        `SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
                rejected_count, rejected_amount, refunded_count, refunded_amount
         FROM company_totals WHERE company_id = 30`,
      ),
    });

    const afterFirst = await snapshot();
    expect(afterFirst.rows).toHaveLength(2);
    for (const row of afterFirst.rows as Array<{ status: string }>) {
      expect(row.status).toBe('approved');
    }
    const totalsRow = (afterFirst.totals as Array<Record<string, unknown>>)[0];
    expect(Number(totalsRow.approved_count)).toBe(2);
    expect(Number(totalsRow.approved_amount)).toBe(333);
    expect(Number(totalsRow.pending_count)).toBe(0);

    await reproject.rederive(new Date(0), windowTo());
    const afterSecond = await snapshot();
    expect(afterSecond).toEqual(afterFirst);
  });

  it('the drift-repair job detects injected drift and repairs it', async () => {
    const worker = await seedWorker('40', 'E');
    const o1 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    // Inject drift: one row wrong, one row missing, totals off.
    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(
      `UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`,
    );

    const report = await drift.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();

    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.status).toBe('approved');
      expect(item.lastEventKind).toBe('approved');
    }
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);

    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
    expect(clean.repaired).toBeNull();
  });
});
```
