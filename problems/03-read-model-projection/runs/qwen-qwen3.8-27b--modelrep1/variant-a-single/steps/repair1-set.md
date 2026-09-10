# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. `src/app.module.ts(2,10)`: `SchedulesModule` should be `ScheduleModule` — the correct export from `@nestjs/schedule` is `ScheduleModule`.

2. `src/common/validation.ts(1,10)`: `isUUID` doesn't exist in `node:crypto`. The correct function is `randomUUID` for generating, but for validating UUIDs, there's no `isUUID` in Node.js crypto. We need to use a different approach. Actually, looking at Node.js docs, `crypto.randomUUID()` generates a UUID but there's no `isUUID` validator. We could use a regex or `crypto.randomUUID()` with a different approach. But the simplest fix that matches the compiler's suggestion is... wait, the compiler says "Did you mean 'UUID'?" — but that's not a valid import either. The real fix is to replace `isUUID` with a manual UUID validation function or use a regex.

Actually, let me reconsider. The compiler is suggesting `UUID` but that's not a real export either. The proper fix is to not import `isUUID` and instead use a regex-based validation. Let me write a simple UUID regex check.

3. `src/projection/projection.service.ts(134,91)`: The `totalsFromGroups` method expects `_sum.amountCents` to be `bigint | null`, but Prisma returns `number | null` for `Int` fields. The schema has `amountCents Int` which maps to a `number` in Prisma, not a `bigint`. So the type signature in `totalsFromGroups` should use `number | null` instead of `bigint | null`, and the cents should be `number` instead of `bigint`.

Wait, but the `CompanyTotals` model has `totalCents BigInt`. So the totals store BigInt, but the source `amountCents` is `Int` (number). Let me look more carefully.

The `OperationRead` model has `amountCents Int` — so when Prisma groups and sums an `Int` field, it returns `number | null`.

The `CompanyTotals` model has `totalCents BigInt` — so when storing totals, it uses BigInt.

So the `totalsFromGroups` method receives groups where `_sum.amountCents` is `number | null` (because the source column is `Int`), but the method's type annotation says `bigint | null`. The fix is to change the type annotation to `number | null` and `number` for the cents.

But wait, then when passing to `companyTotalsRepository.recompute`, it expects `bigint` for `totalCents`. So we need to convert `number` to `BigInt` at the point of use.

Let me look at the `totalsFromGroups` return type and how it's used:

```typescript
private totalsFromGroups(
  groups: Array<{ status: OrderStatus; _sum: { amountCents: bigint | null }; _count: { _all: number } }>,
): Record<OrderStatus, { count: number; cents: bigint }> {
```

It returns `cents: bigint`. And it's used as:
```typescript
await this.companyTotalsRepository.recompute(tx, companyId, this.totalsFromGroups(groups));
```

So the repository's `recompute` expects `bigint` for cents. The fix should be:
- Change the input type from `bigint | null` to `number | null` (matching what Prisma actually returns for an `Int` column)
- Convert to `bigint` when building the return value: `BigInt(group._sum.amountCents ?? 0)`

Let me write the fixes:

**File 1: `src/app.module.ts`**
- Change `SchedulesModule` to `ScheduleModule`

**File 2: `src/common/validation.ts`**
- Remove `import { isUUID } from 'node:crypto'`
- Add a local `isUUID` function using a regex

**File 3: `src/projection/projection.service.ts`**
- Change `totalsFromGroups` signature: `_sum: { amountCents: number | null }` and convert to BigInt in the body

Let me write the complete files now.
```

## reply

Three distinct mistakes:

1. **`SchedulesModule` → `ScheduleModule`** — wrong import name in `app.module.ts`.
2. **`isUUID` does not exist in `node:crypto`** — `validation.ts` imports a non-existent symbol; replace with a local regex check.
3. **`_sum.amountCents` is `number | null`, not `bigint | null`** — Prisma sums an `Int` column into a `number`; the type annotation in `totalsFromGroups` must match, with a conversion to `BigInt` at the point where the `BigInt`-typed `CompanyTotals.totalCents` is populated.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { ProjectionModule } from './projection/projection.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
export class AppModule {}
```

### src/common/validation.ts
```ts
import type { OrderStatus } from '@prisma/client';
import { AppError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw AppError.validation(`${what} must be a JSON object`, { what });
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw AppError.validation(`${field} must be a UUID`, { field, value });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireUuid(value, field);
}

export function requireStatus(value: unknown, field: string): OrderStatus {
  if (typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus)) {
    return value as OrderStatus;
  }
  throw AppError.validation(`${field} must be one of: ${ORDER_STATUSES.join(', ')}`, { field, value });
}

export function optionalStatus(value: unknown, field: string): OrderStatus | undefined {
  if (value === undefined || value === '') return undefined;
  return requireStatus(value, field);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw AppError.validation(`${field} must be a non-empty string of at most ${maxLength} characters`, {
      field,
      value,
      maxLength,
    });
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw AppError.validation(`${field} must be a positive integer`, { field, value });
  }
  if (max !== undefined && value > max) {
    throw AppError.validation(`${field} must not exceed ${max}`, { field, value, max });
  }
  return value;
}

export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}

export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw AppError.validation(`${field} must be an ISO-8601 timestamp`, { field, value });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AppError.validation(`${field} is not a valid ISO-8601 timestamp`, { field, value });
  }
  return parsed;
}

export function optionalIsoDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  return requireIsoDate(value, field);
}
```

### src/projection/projection.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { OperationsRepository, type OperationReadInput } from '../operations/operations.repository.js';
import { ProjectionRepository, type RederiveCursor } from './projection.repository.js';

const REDEIVE_CHUNK_SIZE = 500;
const DEFAULT_REPAIR_CRON = '0 * * * *';
const DEFAULT_REPAIR_WINDOW_HOURS = 24;

export interface RederiveResult {
  ordersRederived: number;
  companiesRecomputed: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);
  private repairRunning = false;

  constructor(
    private readonly repository: ProjectionRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly companyTotalsRepository: CompanyTotalsRepository,
    private readonly transactions: TransactionService,
  ) {}

  // --- Maintenance hooks: invoked by the write services, inside their tx ---

  async onOrderCreated(tx: Prisma.TransactionClient, order: PaymentOrder): Promise<void> {
    const workerName = await this.repository.findWorkerName(tx, order.workerId);
    if (workerName === null) {
      // The write service pre-checks the worker; this only happens if the row
      // vanished between the check and this statement (FK makes it near-impossible).
      throw new AppError('internal_error', `worker ${order.workerId} vanished while projecting order ${order.id}`, {});
    }
    const read: OperationReadInput = {
      id: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      workerName,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
      lastEventType: null,
      lastEventAt: null,
    };
    await this.operationsRepository.upsert(tx, read);
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onOrderStatusChanged(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
    previousStatus: OrderStatus,
  ): Promise<void> {
    await this.operationsRepository.setStatus(tx, order.id, order.status);
    // Move the amount between the two status buckets. Each step is one atomic
    // statement, so no other writer can slip between a read and a write.
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, previousStatus, -1, -BigInt(order.amountCents));
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  onEventRecorded(tx: Prisma.TransactionClient, orderId: string, type: string, occurredAt: Date): Promise<void> {
    return this.operationsRepository.setLatestEventIfNewer(tx, orderId, type, occurredAt).then(() => undefined);
  }

  onWorkerRenamed(tx: Prisma.TransactionClient, workerId: string, workerName: string): Promise<void> {
    return this.operationsRepository.renameWorker(tx, workerId, workerName).then(() => undefined);
  }

  // --- Re-derivation / drift repair -----------------------------------------

  /**
   * Rebuilds operation_reads from the source tables for orders created in
   * [from, to), then recomputes the exact company_totals for every affected
   * company from the rebuilt rows. Idempotent: safe to run repeatedly, with
   * overlapping windows, and concurrently with live writes.
   */
  async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    if (from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    let cursor: RederiveCursor | null = null;
    let ordersRederived = 0;
    const affectedCompanies = new Set<string>();

    while (true) {
      const batch = await this.transactions.run(async (tx) => {
        const orders = await this.repository.findOrdersInWindow(tx, from, to, cursor, REDEIVE_CHUNK_SIZE);
        if (orders.length === 0) return orders;

        const workerNames = await this.repository.findWorkerNames(tx, [...new Set(orders.map((o) => o.workerId))]);
        const latestEvents = await this.repository.findLatestEventPerOrder(tx, orders.map((o) => o.id));

        for (const order of orders) {
          const lastEvent = latestEvents.get(order.id);
          const read: OperationReadInput = {
            id: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            workerName: workerNames.get(order.workerId) ?? '',
            status: order.status,
            amountCents: order.amountCents,
            createdAt: order.createdAt,
            lastEventType: lastEvent?.type ?? null,
            lastEventAt: lastEvent?.occurredAt ?? null,
          };
          await this.operationsRepository.upsert(tx, read);
        }
        return orders;
      });

      if (batch.length === 0) break;
      ordersRederived += batch.length;
      for (const order of batch) affectedCompanies.add(order.companyId);
      const last = batch[batch.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    // Totals are authoritative aggregates over the projection: recompute each
    // affected company's buckets from the rows that are correct now.
    let companiesRecomputed = 0;
    for (const companyId of [...affectedCompanies].sort()) {
      await this.transactions.run(async (tx) => {
        const groups = await this.operationsRepository.sumByStatus(tx, companyId);
        await this.companyTotalsRepository.recompute(tx, companyId, this.totalsFromGroups(groups));
        companiesRecomputed += 1;
      });
    }

    this.logger.log(
      `re-derived ${ordersRederived} operations in [${from.toISOString()}, ${to.toISOString()}); ` +
        `recomputed totals for ${companiesRecomputed} companies`,
    );
    return { ordersRederived, companiesRecomputed };
  }

  /**
   * Scheduled drift-repair job: re-derives a rolling window on a cron. The
   * window overlaps previous runs by design, so anything skipped while a live
   * write was in flight is picked up by the next pass.
   */
  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_REPAIR_CRON, { name: 'drift-repair' })
  async scheduledDriftRepair(): Promise<void> {
    if (process.env.DRIFT_REPAIR_ENABLED === 'false') return;
    if (this.repairRunning) {
      this.logger.warn('previous drift-repair run is still in progress; skipping this tick');
      return;
    }
    this.repairRunning = true;
    try {
      const rawHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_REPAIR_WINDOW_HOURS);
      const windowHours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_REPAIR_WINDOW_HOURS;
      const to = new Date();
      const from = new Date(to.getTime() - windowHours * 3_600_000);
      await this.rederiveWindow(from, to);
    } catch (error) {
      this.logger.error(`drift-repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairRunning = false;
    }
  }

  private totalsFromGroups(
    groups: Array<{ status: OrderStatus; _sum: { amountCents: number | null }; _count: { _all: number } }>,
  ): Record<OrderStatus, { count: number; cents: bigint }> {
    const totals: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    for (const group of groups) {
      totals[group.status] = { count: group._count._all, cents: BigInt(group._sum.amountCents ?? 0) };
    }
    return totals;
  }
}
```
