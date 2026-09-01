# repair2-payment.repository.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/payment/payment.repository.ts(21,5)`, `(29,5)`, `(33,5)`: The error is that `amount_minor_units` is `bigint` (from Prisma's BigInt field) but the `OrderRecord` type expects `number`. The fix is to change the `OrderRecord` interface's `amount_minor_units` from `number` to `bigint`.

2. `src/app.module.ts(3,31)`: Cannot find module `./payment/payment.module` — this is not in the file I'm asked to fix.

3. `test/payment.spec.ts(2,32)`, `(3,80)`: Cannot find modules — not in the file I'm asked to fix.

So the only errors I need to fix in `src/payment/payment.repository.ts` are the three `bigint` vs `number` mismatches. The `OrderRecord` type (or wherever it's defined that the repository uses) has `amount_minor_units: number` but Prisma returns `bigint`.

Now I need to look at what the file likely contains. Based on the PLAN.md, the repository has:
- `findPending(limit: number): Promise<OrderRecord[]>`
- `findByTxid(txid: string): Promise<OrderRecord | null>`
- `findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>`
- Various mark methods
- `upsertSettlement(...)`

The `OrderRecord` type is defined in the plan as:
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

The fix is to change `amount_minor_units: number` to `amount_minor_units: bigint` in the `OrderRecord` type.

Wait, but where is `OrderRecord` defined? It could be in the repository file itself or imported from elsewhere. Based on the plan's manifest, the repository file contains "All Prisma queries and conditional updates for orders and settlements". The `OrderRecord` type is likely defined in the repository file or in a types file.

Looking at the manifest:
- `src/payment/bank-client.interface.ts` — BankClient interface, BankSendRequest/Response, Settlement types
- `src/payment/payment.repository.ts` — All Prisma queries and conditional updates for orders and settlements

The `OrderRecord` type isn't explicitly listed in either file's description. It could be in the repository file. Let me assume it's defined in the repository file since that's where it's used and no other types file is listed.

Now, the plan says `amount_minor_units` in the data model is `bigint` (Prisma type `BigInt`). So the correct fix is to change the TypeScript type to `bigint`.

Let me write the complete file. I need to reconstruct it based on the plan:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ... methods
}
```

Wait, but looking at the error messages more carefully:

```
src/payment/payment.repository.ts(21,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; ... }[]' is not assignable to type 'OrderRecord[]'.
```

This means the return type annotation is `OrderRecord[]` and the actual Prisma query returns `bigint` for `amount_minor_units`. So `OrderRecord` has `amount_minor_units: number` and needs to be `bigint`.

Let me reconstruct the full file based on the plan's specifications:

1. The `OrderRecord` interface needs `amount_minor_units: bigint`
2. The methods from the plan:
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

The plan specifies:
- `markSettled` uses `WHERE status IN ('sent','in_doubt')`
- `markPendingForResend` uses `WHERE status = 'in_doubt'`
- `upsertSettlement` uses `ON CONFLICT (txid) DO NOTHING`
- `incrementAttempt` uses atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'`

Let me write this out. I'll use `PrismaClient` directly since the repository is the only layer that touches the database.

Actually, looking at the layout conventions, it says `src/<feature>/<feature>.repository.ts`. And the plan says the class is `PaymentRepository`.

Let me write the complete file:
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: bigint;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
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
      where: { status: 'in_doubt', effective_date: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'sent', last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'in_doubt', last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'rejected', updated_at: new Date() },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settled_at: settledAt, updated_at: new Date() },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending', updated_at: new Date() },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'parked_manual_review', updated_at: new Date() },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { attempt_count: { increment: 1 }, last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
    return result.count;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: bigint;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      update: {},
      create: data,
    });
  }
}
```
