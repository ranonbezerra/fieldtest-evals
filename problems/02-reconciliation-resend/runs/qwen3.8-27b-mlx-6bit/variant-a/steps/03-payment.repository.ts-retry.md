# 03-payment.repository.ts-retry

## reasoning

```
The user wants me to write `src/payment/payment.repository.ts` based on the PLAN.md specification. Let me carefully extract what's needed:

From the plan, the `PaymentRepository` class needs these methods:
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
- `upsertSettlement(data: { txid: string; amount_minor_units: number; settled_at: Date; statement_date: Date }): Promise<void>`

Key ordering rules from the plan:
- `markSettled` is only valid when current status is `sent` or `in_doubt`. Uses conditional update (`WHERE id = ? AND status IN ('sent','in_doubt')`).
- `markPendingForResend` is only valid when current status is `in_doubt`. Conditional update ensures idempotency.
- `upsertSettlement` uses `ON CONFLICT (txid) DO NOTHING`.
- `incrementAttempt` uses atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; if rows affected is 0, another process won the race.

The repository is the only layer that touches the database (Prisma).

Looking at the schema:
- `orders` table with columns: id, supplier_key, amount_minor_units, effective_date, txid, status, attempt_count, last_attempt_at, settled_at, created_at, updated_at
- `settlements` table with columns: id, txid, amount_minor_units, settled_at, statement_date, created_at

The Prisma models would be named `Order` and `Settlement` (PascalCase per conventions), mapped to tables `orders` and `settlements`.

Now let me think about the Prisma calls:

1. `findPending(limit)` - find orders where status = 'pending', ordered by created_at ASC, limited to `limit`
2. `findByTxid(txid)` - find order where txid = txid
3. `findInDoubtByEffectiveDate(date)` - find orders where status = 'in_doubt' AND effective_date = date
4. `markSent(id, lastAttemptAt)` - update order where id AND status IN ('pending') → status = 'sent', last_attempt_at = lastAttemptAt. Wait, actually looking at the state machine, `markSent` is called after a successful send from `pending` status. So the condition should be `status = 'pending'`.

Actually wait, let me re-read the plan. The state machine says:
- pending → sent (on accepted/duplicate)
- pending → in_doubt (on transient_error/timeout)
- pending → rejected (on permanent_rejection)

So `markSent` should be conditional on status being 'pending'. But the plan only explicitly mentions conditional updates for `markSettled` and `markPendingForResend`. Let me re-read...

The plan says:
- `markSettled` is only valid when current status is `sent` or `in_doubt`.
- `markPendingForResend` is only valid when current status is `in_doubt`.
- `incrementAttempt` uses atomic UPDATE with WHERE status = 'pending'

For `markSent`, `markInDoubt`, `markRejected`, `markParked` - the plan doesn't explicitly state conditional updates for these. But logically, they should be safe. Let me think...

Actually, looking more carefully at the control flow:
- Step 2b in `executePayments` says "Atomically increment attempt and set last_attempt_at" - this is `incrementAttempt`. If it succeeds (returns a count), then we proceed to call the bank.
- After the bank call, we call `markSent`, `markInDoubt`, or `markRejected`.

Since `incrementAttempt` already guards with `status = 'pending'`, the subsequent mark calls are safe in the sense that only one worker will proceed. But for extra safety and to follow the plan's spirit, I'll add status conditions where it makes sense.

Wait, but the plan specifically only calls out conditional updates for `markSettled` and `markPendingForResend`. For the others, it doesn't mention it. Let me be faithful to the plan - I'll add the conditional where the plan specifies it, and for others I'll just do a simple update by id (since the `incrementAttempt` already guards the flow).

Actually, re-reading more carefully: the plan says `markSent(id, lastAttemptAt)` - but in the control flow, after `incrementAttempt` succeeds, we call the bank, then call the appropriate mark method. The `lastAttemptAt` was already set by `incrementAttempt`. So why does `markSent` take a `lastAttemptAt`? 

Looking at the interface again:
```
markSent(id: string, lastAttemptAt: Date): Promise<void>;
markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
```

These take `lastAttemptAt` as a parameter. This might be redundant since `incrementAttempt` already sets it, but the interface specifies it. I'll implement it as specified - update both status and last_attempt_at.

Actually wait - maybe the design is that `incrementAttempt` sets the attempt count and last_attempt_at, and then the mark methods just set the status. But the interface has `lastAttemptAt` in the mark methods. I'll follow the interface exactly as specified in the plan.

Let me also think about `markParked`. The plan says it's called when `attempt_count >= maxAttempts`. The order should be in `pending` status at that point (since it was fetched as pending). So the condition would be `status = 'pending'`.

Actually, looking at the state machine diagram again:
```
   (insert)   ▼        accepted / duplicate                     │
  ┌──────────┐    ─────────────────────►   ┌──────────┐        │
  │ pending  │                             │   sent   │        │
```

And the parking happens from `in_doubt` → when attempt exhaustion is detected. Wait no, re-reading:

"Cap attempts at 5; after that, park for manual review and never auto-revert."

And in the executePayments flow:
"a. If `attempt_count >= maxAttempts` → call `markParked`. Continue."

This check happens before the increment, so the order is still in `pending` status (it was fetched as pending). So `markParked` should be conditional on `status = 'pending'`.

Wait, but looking at the state machine diagram more carefully:
```
  ┌──────────┐   proven absent    ┌──────────┐         ┌────────┤
  │ in_doubt │ ─────────────────► │ pending  │         │settled │
  └──────────┘  (past lag,        └──────────┘         │        ┤
                not in stmt)         │                    └────────┘
       │                            │ attempt_count >= max
       │ found in statement         ▼
       └────────────────►   ┌──────────────┐
                            │ parked_manual│
                            │   _review    │
                            └──────────────┘
```

Hmm, the diagram shows parking from `in_doubt` when attempt_count >= max. But the control flow says it's checked in `executePayments` which fetches `pending` orders. So the flow is:
1. Order is in `in_doubt`
2. Reconcile proves it absent → `markPendingForResend` → status becomes `pending`
3. Next `executePayments` picks it up as `pending`
4. Checks `attempt_count >= maxAttempts` → if yes, `markParked`

So `markParked` is called on a `pending` order. The condition should be `status = 'pending'`.

Now let me write the file. I need to use Prisma. The Prisma client would be injected (typical NestJS pattern). Let me think about how to inject it...

In a typical NestJS + Prisma setup, you'd have a `PrismaService` that extends `PrismaClient`. The repository would inject this. But the plan doesn't mention a `PrismaService` explicitly. Let me look at what's available...

The plan's manifest shows:
- `src/payment/payment.repository.ts | reads: src/payment/bank-client.interface.ts`

It reads the bank-client interface (for types) but the plan doesn't mention a PrismaService. In a standard NestJS + Prisma setup, you'd typically have the Prisma client injected. Since the plan doesn't specify a separate `PrismaService` file, I'll inject `PrismaClient` directly or use a common pattern.

Actually, the most common NestJS + Prisma pattern is to have a `PrismaService` that's provided globally or in the app module. Since the plan doesn't create one explicitly, I'll assume it's available as `PrismaClient` injected via a token. Let me use the standard approach of injecting `PrismaClient` from `@prisma/client`.

Wait, but the plan says "repository is the only layer that touches the database." So the repository directly uses Prisma. In NestJS, the typical pattern is:

```typescript
@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}
}
```

But actually, many NestJS projects use a `PrismaService` that extends `PrismaClient` and is provided in the module. Since the plan doesn't mention creating a `PrismaService`, I'll just inject `PrismaClient` directly. Or better yet, I can use a token-based injection that the module would provide.

Hmm, let me just go with injecting `PrismaClient` directly from `@prisma/client`. This is the simplest approach and doesn't require additional files not mentioned in the plan.

Actually, looking at this more carefully - in a real NestJS app, you'd typically have a `PrismaModule` or provide `PrismaClient` somewhere. But since the plan's manifest only lists specific files and doesn't include a Prisma module or service, I'll inject `PrismaClient` directly. The module would need to provide it, but that's the module's concern.

Let me write the repository now:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Order, Settlement } from '@prisma/client';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { txid },
    });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'in_doubt', effectiveDate: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'sent', lastAttemptAt, updatedAt: new Date() },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'in_doubt', lastAttemptAt, updatedAt: new Date() },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', updatedAt: new Date() },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settledAt, updatedAt: new Date() },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending', updatedAt: new Date() },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'parked_manual_review', updatedAt: new Date() },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { attemptCount: { increment: 1 }, lastAttemptAt, updatedAt: new Date() },
    });
    if (result.count === 0) {
      return 0;
    }
    // We need to return the new attempt count. Since updateMany doesn't return the row,
    // we need to fetch it or use a different approach.
    const order = await this.prisma.order.findUnique({ where: { id } });
    return order ? order.attemptCount : 0;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      create: {
        txid: data.txid,
        amountMinorUnits: data.amount_minor_units,
        settledAt: data.settled_at,
        statementDate: data.statement_date,
      },
      update: {},
    });
  }
}
```

Wait, there's an issue with `incrementAttempt`. The plan says it should return the new count and if rows affected is 0, another process won the race. But Prisma's `updateMany` only returns `{ count }`. To get the new value, I'd need to either:
1. Do a read after the update (race condition possible)
2. Use `$queryRaw` to do `UPDATE ... RETURNING attempt_count`

Option 2 is better for atomicity. Let me use raw query for this one:

```typescript
async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
  const result = await this.prisma.$queryRaw<Array<{ attempt_count: number }>>`
    UPDATE orders
    SET attempt_count = attempt_count + 1,
        last_attempt_at = ${lastAttemptAt},
        updated_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING attempt_count
  `;
  return result.length > 0 ? Number(result[0].attempt_count) : 0;
}
```

This is atomic and returns the new count. If no rows were affected (another worker got it), it returns 0.

Actually, wait. The plan says "zero raw SQL" for the service layer, but the repository IS allowed to touch the database directly. And `$queryRaw` is a Prisma method, so it's still going through Prisma. This should be fine for the repository layer.

Let me also think about whether I need to handle the `updatedAt` field. The plan says it has a default and is "updated on change". In Prisma, you can use `@updatedAt` decorator which automatically updates it. But for the raw query, I need to set it manually. For Prisma ORM calls, if the model has `@updatedAt`, Prisma will handle it automatically. But to be safe and explicit, I'll include it in the data.

Actually, if I use `@updatedAt` in the schema, Prisma automatically sets it on updates. So I don't need to include `updatedAt` in the data object for Prisma ORM calls. But for the raw query, I do need to set it.

Hmm, but I'm not writing the schema file, so I'll just be explicit and include `updatedAt` in the data for all updates. This is safer and works regardless of whether `@updatedAt` is used.

Wait, actually if the schema uses `@updatedAt`, Prisma will automatically set it and I don't need to include it. If I do include it, it might conflict. Let me just not include it for the Prisma ORM calls and assume `@updatedAt` is in the schema (which is standard practice). For the raw query, I'll set it explicitly.

Actually, to be safe and not make assumptions about the schema (which I'm not writing), let me include `updatedAt` explicitly in all updates. This way it works regardless of whether `@updatedAt` is present.

Hmm, but if `@updatedAt` IS present and I also set it, Prisma might throw an error or just use my value. Let me think... Actually in Prisma, if a field has `@updatedAt`, you cannot set it manually in an update - it will be ignored or cause an error. So I should NOT include it if the schema has `@updatedAt`.

Since I can't see the schema and the plan says `updated_at` is "Default now(), updated on change", the most likely implementation is `@default(now()) @updatedAt`. In that case, I should NOT include `updatedAt` in my update data.

Let me go with not including `updatedAt` in Prisma ORM calls (assuming `@updatedAt` is used), and setting it explicitly in the raw query.

Let me also reconsider the `Order` and `Settlement` types from Prisma. The plan defines an `OrderRecord` interface:

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

But the Prisma model would use camelCase for fields (e.g., `supplierKey`, `amountMinorUnits`, etc.) with `@map` to snake_case in the database. So the Prisma-generated types would use camelCase.

The plan's `OrderRecord` interface uses snake_case, which matches the database columns but not the Prisma model fields. This is a bit confusing. Let me think about what the repository should return...

The repository methods in the plan return `Promise<OrderRecord[]>` etc. But if I'm using Prisma, the returned objects will have camelCase field names (matching the Prisma model). So either:
1. The repository maps Prisma results to `OrderRecord` (snake_case)
2. The `OrderRecord` in the plan is just a conceptual representation and the actual return type is the Prisma `Order` model

I think option 2 is more practical. The plan's `OrderRecord` is a conceptual description of the data shape. In practice, the repository returns Prisma `Order` objects (camelCase). The service would work with those.

But wait - the plan says the repository's interface uses `OrderRecord`. If I strictly follow the plan, I should return `OrderRecord` objects. But that would require mapping from Prisma's camelCase to snake_case, which is ugly and unusual.

I think the most defensible reading is that `OrderRecord` in the plan is a shorthand for "the Prisma Order model" and the snake_case in the plan is just reflecting the database column names (which the plan uses throughout for documentation). The actual TypeScript code would use camelCase as Prisma generates.

Let me just use the Prisma `Order` type directly. This is the most natural approach.

Actually, you know what, let me reconsider. The plan says:

```typescript
interface OrderRecord {
  id: string;
  supplier_key: string;
  ...
}
```

And the repository methods return `Promise<OrderRecord[]>`. If I take this literally, I need to define and use this interface. But then I'd be returning objects with snake_case keys from a repository that uses Prisma (which gives camelCase). That's a mismatch.

I think the cleanest approach is:
- Use Prisma's `Order` type as the return type
- The plan's `OrderRecord` is just documentation of what data is available

This is the "most defensible reading" since the plan is a design document, not literal code.

Let me finalize my implementation:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Order } from '@prisma/client';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'in_doubt', effectiveDate: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'sent', lastAttemptAt },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'in_doubt', lastAttemptAt },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected' },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settledAt },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending' },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'parked_manual_review' },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ attempt_count: number }>>`
      UPDATE orders
      SET attempt_count = attempt_count + 1,
          last_attempt_at = ${lastAttemptAt},
          updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING attempt_count
    `;
    return result.length > 0 ? Number(result[0].attempt_count) : 0;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      create: {
        txid: data.txid,
        amountMinorUnits: data.amount_minor_units,
        settledAt: data.settled_at,
        statementDate: data.statement_date,
      },
      update: {},
    });
  }
}
```

Wait, I need to think about whether `status` values in Prisma would be strings or enums. The plan uses string literals like `'pending'`, `'sent'`, etc. If the Prisma schema uses an enum, the types would be different. But since I'm not writing the schema and the plan uses string literals, I'll use string literals. Prisma supports both - if it's a `String` field in the schema, string literals work fine.

Also, I should consider: does the `Order` model from Prisma export include all the fields? Yes, it would include all scalar fields.

One more thought: the `upsertSettlement` uses `update: {}` which means if the record already exists, nothing is updated. This matches the plan's "ON CONFLICT (txid) DO NOTHING" semantics.

Let me also double-check: the plan says the repository should use `ON CONFLICT (txid) DO NOTHING` for settlements. Prisma's `upsert` with empty `update` does exactly this - it tries to insert, and if there's a conflict, it does nothing. Perfect.

I think my implementation is solid. Let me also make sure I'm not importing anything I don't need. I import:
- `Injectable` from `@nestjs/common` - for the decorator
- `PrismaClient, Order` from `@prisma/client` - for the client and type

I don't need `Settlement` from `@prisma/client` because I'm not using it as a return type anywhere in the repository (the `upsertSettlement` method takes explicit params and returns void).

Actually wait, do I need to import `Settlement`? No, because the `upsertSettlement` method's parameter is an inline type, not the Prisma model. And I'm not returning any settlement objects.

One final check: the plan says the file reads `src/payment/bank-client.interface.ts`. Looking at my implementation, I don't actually import anything from that file. The `OrderRecord` interface and the domain types are in the plan but I'm using Prisma's `Order` type instead. So technically I don't need that import.

But wait - should I define the `OrderRecord` interface in this file? The plan shows it as part of the repository's types. Let me re-read the plan...

The plan shows:
```typescript
interface OrderRecord {
  id: string;
  supplier_key: string;
  ...
}

class PaymentRepository {
  findPending(limit: number): Promise<OrderRecord[]>;
  ...
}
```

So `OrderRecord` is part of the repository's public API. But as I discussed, using Prisma's `Order` type directly is more natural. The plan's `OrderRecord` with snake_case is a conceptual representation.

I'll go with Prisma's `Order` type. This is the most defensible reading - the plan is a design document using snake_case to reflect database columns, and the actual implementation uses Prisma's generated types.

Let me finalize. I'm satisfied with my implementation. Let me write it out cleanly.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Order } from '@prisma/client';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'in_doubt', effectiveDate: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'sent', lastAttemptAt },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'in_doubt', lastAttemptAt },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected' },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settledAt },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending' },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'parked_manual_review' },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ attempt_count: number }>>`
      UPDATE orders
      SET attempt_count = attempt_count + 1,
          last_attempt_at = ${lastAttemptAt},
          updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING attempt_count
    `;
    return result.length > 0 ? Number(result[0].attempt_count) : 0;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      create: {
        txid: data.txid,
        amountMinorUnits: data.amount_minor_units,
        settledAt: data.settled_at,
        statementDate: data.statement_date,
      },
      update: {},
    });
  }
}
```
