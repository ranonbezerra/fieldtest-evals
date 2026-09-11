# repair1-set

## reasoning

```
Let me analyze the errors:

1. All the TS2307 errors are "Cannot find module" errors. Looking at the reference files, I can see the project uses ESM (`"type": "module"`). In ESM with TypeScript, relative imports need explicit file extensions (`.js` for `.ts` files).

Let me verify by looking at the imports:
- `./payout/payout.module` → should be `./payout/payout.module.js`
- `./app.module` → should be `./app.module.js`
- `../prisma/prisma.module` → should be `../prisma/prisma.module.js`
- `./bank.client` → should be `./bank.client.js`
- `./payout.repository` → should be `./payout.repository.js`
- `./payout.service` → should be `./payout.service.js`
- `./payout.processor` → should be `./payout.processor.js`
- `../prisma/prisma.service` → should be `../prisma/prisma.service.js`
- `../src/payout/payout.processor` → should be `../src/payout/payout.processor.js`
- `../src/payout/payout.service` → should be `../src/payout/payout.service.js`
- `../src/payout/bank.client` → should be `../src/payout/bank.client.js`
- `../src/payout/payout.repository` → should be `../src/payout/payout.repository.js`

2. The last error is different:
```
test/payout.service.spec.ts(132,7): error TS2561: Object literal may only specify known properties, but 'order' does not exist in type '{ id: string; txid: string; settledAt: Date; orderId: string; statementDate: string; recordedAt: Date; }'. Did you mean to write 'orderId'?
```

Looking at the test file, line 132 is in the `FakeOrderRepository.recordSettlement` method:
```ts
const row: SettlementRecord = {
  ...input,
  id: randomUUID(),
  recordedAt: new Date(),
  order: null as unknown as Order, // relation not exercised in tests
};
```

The issue is that the `SettlementRecord` type from `@prisma/client` doesn't have an `order` property in its type definition (it's a relation, not a scalar field). The `SettlementRecord` model has fields: `id`, `orderId`, `txid`, `statementDate`, `settledAt`, `recordedAt`. The `order` is a relation, not a direct field on the type.

Wait, actually in Prisma, the generated type for a model does include relation fields. Let me think again...

Actually, looking at the Prisma schema:
```prisma
model SettlementRecord {
  id            String   @id @default(uuid()) @map("id")
  orderId       String   @unique @map("order_id")
  txid          String   @unique @map("txid")
  statementDate String   @map("statement_date")
  settledAt     DateTime @map("settled_at")
  recordedAt    DateTime @default(now()) @map("recorded_at")

  order Order @relation(fields: [orderId], references: [id])

  @@map("settlement_records")
}
```

The `SettlementRecord` type from `@prisma/client` would have the scalar fields: `id`, `orderId`, `txid`, `statementDate`, `settledAt`, `recordedAt`. The `order` relation field is NOT part of the base model type - it's only available when you explicitly request it in a Prisma query (e.g., `include: { order: true }`).

So the fix is to remove the `order` property from the object literal. The type is `SettlementRecord` which only has the scalar fields.

Wait, but the error says the type is `{ id: string; txid: string; settledAt: Date; orderId: string; statementDate: string; recordedAt: Date; }` - that confirms `order` is not in the type.

So the fix is to remove `order: null as unknown as Order` from the object literal.

Now let me list all files that need changes:

1. `src/app.module.ts` - fix import `./payout/payout.module` → `./payout/payout.module.js`
2. `src/main.ts` - fix import `./app.module` → `./app.module.js`
3. `src/payout/payout.module.ts` - fix all imports
4. `src/payout/payout.processor.ts` - fix import `./payout.service` → `./payout.service.js`
5. `src/payout/payout.repository.ts` - fix imports `../prisma/prisma.service` → `../prisma/prisma.service.js` and `./bank.client` → `./bank.client.js`
6. `src/payout/payout.service.ts` - fix imports `./bank.client` → `./bank.client.js` and `./payout.repository` → `./payout.repository.js`
7. `src/prisma/prisma.module.ts` - fix import `./prisma.service` → `./prisma.service.js`
8. `test/payout.processor.spec.ts` - fix imports
9. `test/payout.service.spec.ts` - fix imports AND fix the `order` property issue

Wait, let me re-check. The project says ESM with `"type": "module"`. In TypeScript with ESM, you need `.js` extensions in relative imports. That's the one distinct mistake repeated across all files.

Let me also check: does `src/prisma/prisma.service.ts` exist? It's not in the reference files shown, but it's referenced. Since the error is only about the import path (missing extension), not about the file not existing, I'll assume it exists.

Now let me write out each file that needs changes:

1. **src/app.module.ts**
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

2. **src/main.ts**
```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`supplier-payouts running on port ${port}`, 'Bootstrap');
}

void bootstrap();
```

3. **src/payout/payout.module.ts**
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_CLIENT } from './bank.client.js';
import { OrderRepository } from './payout.repository.js';
import { PayoutService, CLOCK } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [PrismaModule],
  providers: [
    OrderRepository,
    PayoutService,
    PayoutProcessor,
    { provide: CLOCK, useValue: () => new Date() },
    {
      provide: BANK_CLIENT,
      useValue: {
        send: () => {
          throw new Error('bank client not wired');
        },
        getStatement: () => {
          throw new Error('bank client not wired');
        },
      },
    },
  ],
})
export class PayoutModule {}
```

4. **src/payout/payout.processor.ts**
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PayoutService, ReconcileWindow } from './payout.service.js';

/** Reconcile cadence. */
export const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Trailing window per run. Wider than the interval, so consecutive runs
 * overlap; reconcile() is written to be safe across that overlap.
 */
export const RECONCILE_WINDOW_MS = 45 * 60 * 1000;

@Injectable()
export class PayoutProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutProcessor.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly payouts: Pick<PayoutService, 'reconcile'>) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS) || RECONCILE_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(`reconcile tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconcile pass over the trailing overlapping window. */
  async tick(asOf: Date = new Date()): Promise<ReconcileWindow> {
    const window: ReconcileWindow = {
      from: new Date(asOf.getTime() - RECONCILE_WINDOW_MS),
      to: new Date(asOf.getTime()),
    };
    this.logger.log(`reconciling ${window.from.toISOString()} .. ${window.to.toISOString()}`);
    await this.payouts.reconcile(window);
    return window;
  }
}
```

5. **src/payout/payout.repository.ts**
```ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Order, OrderStatus, SettlementRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTxid } from './bank.client.js';
// ... rest stays the same
```

6. **src/payout/payout.service.ts**
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';
import {
  BANK_CLIENT,
  classifySendResult,
  deriveTxid,
  statementDatesInRange,
  toUtcDateKey,
  type BankClient,
  type Settlement,
} from './bank.client.js';
import type { OrderRepository } from './payout.repository.js';
// ... rest stays the same
```

7. **src/prisma/prisma.module.ts**
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

8. **test/payout.processor.spec.ts**
```ts
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PayoutProcessor,
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
} from '../src/payout/payout.processor.js';
import type { ReconcileWindow } from '../src/payout/payout.service.js';
// ... rest stays the same
```

9. **test/payout.service.spec.ts** - fix imports AND remove the `order` property

For the test file, I need to:
- Change `../src/payout/bank.client` → `../src/payout/bank.client.js`
- Change `../src/payout/payout.repository` → `../src/payout/payout.repository.js`
- Change `../src/payout/payout.service` → `../src/payout/payout.service.js`
- Remove `order: null as unknown as Order` from the SettlementRecord literal

Let me write out the complete test file with the fix.
```

## reply

Looking at the errors, I see **two distinct mistakes**:

1. **Missing `.js` extensions on all relative imports** — the project is ESM (`"type": "module"`), so TypeScript requires explicit `.js` extensions on relative imports. This accounts for all 18 TS2307 errors.

2. **One type error in the test** — `SettlementRecord` (the Prisma model type) does not include relation fields; the `order` property must be removed from the object literal.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  Logger.log(`supplier-payouts running on port ${port}`, 'Bootstrap');
}

void bootstrap();
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_CLIENT } from './bank.client.js';
import { OrderRepository } from './payout.repository.js';
import { PayoutService, CLOCK } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [PrismaModule],
  providers: [
    OrderRepository,
    PayoutService,
    PayoutProcessor,
    { provide: CLOCK, useValue: () => new Date() },
    // The bank adapter (the bank's SDK) is wired here. This stand-in fails
    // loudly so a miswired deploy can never pass a payment silently.
    {
      provide: BANK_CLIENT,
      useValue: {
        send: () => {
          throw new Error('bank client not wired');
        },
        getStatement: () => {
          throw new Error('bank client not wired');
        },
      },
    },
  ],
})
export class PayoutModule {}
```

### src/payout/payout.processor.ts
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PayoutService, ReconcileWindow } from './payout.service.js';

/** Reconcile cadence. */
export const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Trailing window per run. Wider than the interval, so consecutive runs
 * overlap; reconcile() is written to be safe across that overlap.
 */
export const RECONCILE_WINDOW_MS = 45 * 60 * 1000;

@Injectable()
export class PayoutProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutProcessor.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly payouts: Pick<PayoutService, 'reconcile'>) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS) || RECONCILE_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(`reconcile tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconcile pass over the trailing overlapping window. */
  async tick(asOf: Date = new Date()): Promise<ReconcileWindow> {
    const window: ReconcileWindow = {
      from: new Date(asOf.getTime() - RECONCILE_WINDOW_MS),
      to: new Date(asOf.getTime()),
    };
    this.logger.log(`reconciling ${window.from.toISOString()} .. ${window.to.toISOString()}`);
    await this.payouts.reconcile(window);
    return window;
  }
}
```

### src/payout/payout.repository.ts
```ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Order, OrderStatus, SettlementRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveTxid } from './bank.client.js';

export interface NewOrderInput {
  supplierKey: string;
  /** amount in minor units, integer */
  amountMinor: number;
  /** the date this payment applies to */
  effectiveDate: Date;
}

export interface AttemptPatch {
  status: OrderStatus;
  attempts: number;
  lastAttemptAt: Date;
  lastOutcome: string;
}

/**
 * The contract the service depends on. The repository is the only layer
 * that touches the database; keeping the seam explicit lets the service be
 * tested against an in-memory fake.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findPending(): Promise<Order[]>;
  findById(id: string): Promise<Order | null>;
  findByTxid(txid: string): Promise<Order | null>;
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]>;
  applyAttempt(id: string, patch: AttemptPatch): Promise<Order>;
  settle(id: string, settledAt: Date): Promise<Order>;
  park(id: string, at: Date, reason: string): Promise<Order>;
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord>;
}

@Injectable()
export class OrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending order. The id is generated here (not by the DB
   * default) so the derived txid can be computed in the same insert.
   */
  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    return this.prisma.order.create({
      data: {
        id,
        supplierKey: input.supplierKey,
        amountMinor: input.amountMinor,
        effectiveDate: input.effectiveDate,
        txid: deriveTxid({
          id,
          effectiveDate: input.effectiveDate,
          amountMinor: input.amountMinor,
          supplierKey: input.supplierKey,
        }),
      },
    });
  }

  findPending(): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  /**
   * Orders whose last send outcome is unknown, and the bank has had a full
   * publication cycle since the attempt (lastAttemptAt <= asOf).
   */
  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'unknown', lastAttemptAt: { lte: asOf } },
      orderBy: { lastAttemptAt: 'asc' },
    });
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    return this.prisma.order.update({ where: { id }, data: patch });
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'settled', settledAt },
    });
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status: 'parked', parkedAt: at, lastOutcome: `parked:${reason}` },
    });
  }

  /**
   * Record that a statement entry matched an order. Idempotent per txid:
   * re-running reconcile over the same (or an overlapping) window must not
   * duplicate the record.
   */
  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    return this.prisma.settlementRecord.upsert({
      where: { txid: input.txid },
      update: {},
      create: {
        orderId: input.orderId,
        txid: input.txid,
        statementDate: input.statementDate,
        settledAt: input.settledAt,
        order: { connect: { id: input.orderId } },
      },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';
import {
  BANK_CLIENT,
  classifySendResult,
  deriveTxid,
  statementDatesInRange,
  toUtcDateKey,
  type BankClient,
  type Settlement,
} from './bank.client.js';
import type { OrderRepository } from './payout.repository.js';

/** Hard cap on send attempts per order. */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * The bank's statement lags reality by up to this much. Absence from the
 * statement is only evidence after a full lag has elapsed since the send.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

/** DI token for a clock (injectable for tests). */
export const CLOCK: unique symbol = Symbol('CLOCK');
export type Clock = () => Date;

export interface ReconcileWindow {
  /** inclusive start of the statement window */
  from: Date;
  /** as-of time: every decision in this run is made as of this moment */
  to: Date;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly orders: OrderRepository,
    @Inject(BANK_CLIENT) private readonly bank: BankClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Send every pending order. First send only: the send path may record
   * that it does not know an outcome, but it may not act on that. Every
   * resend is made by reconcile(), after reconciliation proves absence.
   */
  async executePayments(): Promise<void> {
    const pending = await this.orders.findPending();
    for (const order of pending) {
      // Defensive: nothing ever moves an order back to pending, so a
      // pending order at the cap is inconsistent state. Park it rather
      // than send blindly.
      if (order.attempts >= MAX_SEND_ATTEMPTS) {
        await this.orders.park(order.id, this.clock(), 'pending_order_at_attempt_cap');
        this.logger.error(`order ${order.id} parked without being sent (at attempt cap while pending)`);
        continue;
      }
      await this.sendOrder(order);
    }
  }

  /**
   * Match statement entries to orders and advance their state.
   *
   * Safe to run repeatedly, over overlapping windows:
   *  - an order that is already settled (or terminal) is skipped before
   *    any decision is taken about it;
   *  - absence is re-proven against a freshly fetched statement on every
   *    run, and only then may a resend happen;
   *  - if a statement fetch fails, nothing is changed and the next run
   *    retries — never decide on partial evidence.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const evidenceCutoff = new Date(window.to.getTime() - PUBLISHING_LAG_MS);

    // Orders whose last send outcome is unknown, and the bank has had a
    // full publication cycle since the attempt. Only these may be proven
    // absent — and only they may be re-sent. (An accepted/duplicate
    // instruction is the bank's to publish, not ours to chase.)
    const awaitingEvidence = await this.orders.findUnknownReadyForEvidence(evidenceCutoff);

    // Statement dates to pull: the dates covered by the window, plus the
    // send date of every awaiting-evidence order — a landed send is
    // published in the statement for the date it was sent, so absence can
    // only be proven against that date.
    const dates = new Set<string>(statementDatesInRange(window.from, window.to));
    for (const order of awaitingEvidence) {
      if (order.lastAttemptAt) dates.add(toUtcDateKey(order.lastAttemptAt));
    }

    const settlements: Settlement[] = [];
    for (const date of [...dates].sort()) {
      settlements.push(...(await this.bank.getStatement(date)));
    }

    await this.matchSettlements(settlements, window.to);
    await this.handleProvenAbsence(settlements, awaitingEvidence);
  }

  /**
   * The four-way handling of one send attempt. Shared by the first send
   * (executePayments) and reconciliation-proven resends, so a resend and a
   * first send are handled identically — same derived txid, same outcomes.
   */
  private async sendOrder(order: Order): Promise<void> {
    const txid = deriveTxid(order);
    const attempts = order.attempts + 1;
    const at = this.clock();

    const result = await this.bank.send({
      txid,
      amount: order.amountMinor,
      key: order.supplierKey,
    });
    const outcome = classifySendResult(result);

    switch (outcome) {
      case 'accepted':
      case 'duplicate':
        // In flight: the bank holds the instruction; the statement is what
        // proves settlement. `duplicate` is a success, not an error — the
        // bank already had this txid (a prior send landed).
        await this.orders.applyAttempt(order.id, {
          status: 'in_flight',
          attempts,
          lastAttemptAt: at,
          lastOutcome: outcome,
        });
        this.logger.log(`order ${order.id} ${outcome} (attempt ${attempts}/${MAX_SEND_ATTEMPTS})`);
        break;
      case 'transient':
        // Outcome unknown: record that we do not know and wait. Nothing in
        // the send path acts on this — only reconciliation may.
        await this.orders.applyAttempt(order.id, {
          status: 'unknown',
          attempts,
          lastAttemptAt: at,
          lastOutcome: 'transient',
        });
        this.logger.warn(`order ${order.id} send outcome unknown (attempt ${attempts}/${MAX_SEND_ATTEMPTS}); awaiting statement evidence`);
        break;
      case 'permanent':
        // Terminal: the bank will not process this instruction (malformed,
        // blocked account, closed beneficiary). A human reviews; we never
        // auto-retry and never auto-revert.
        await this.orders.applyAttempt(order.id, {
          status: 'rejected',
          attempts,
          lastAttemptAt: at,
          lastOutcome: `permanent:${result.type === 'response' ? result.code : 'unknown'}`,
        });
        this.logger.error(`order ${order.id} permanently rejected (attempt ${attempts}/${MAX_SEND_ATTEMPTS})`);
        break;
    }
  }

  /**
   * Match statement entries to orders by txid and settle them. Idempotent:
   * an order that is already settled is skipped before any decision is
   * taken about it, so re-running over the same window changes nothing.
   */
  private async matchSettlements(settlements: Settlement[], asOf: Date): Promise<void> {
    for (const settlement of settlements) {
      const order = await this.orders.findByTxid(settlement.txid);
      if (!order) {
        this.logger.warn(`statement ${settlement.date}: entry ${settlement.txid} matches no order; ignored`);
        continue;
      }
      if (order.status === 'settled') continue; // already settled — a re-run
      if (order.status === 'rejected' || order.status === 'parked') {
        // Anomaly: a terminal order's instruction was published as
        // settled. We never auto-revert; a human must look.
        this.logger.error(`terminal order ${order.id} (${order.status}) found settled as ${settlement.txid}`);
        continue;
      }
      // pending / in_flight / unknown: the statement is the proof. (A
      // pending match means a send crashed before it was recorded; the
      // money is in, so the order is settled.)
      const settledAt = settlement.settledAt ? new Date(settlement.settledAt) : asOf;
      if (settlement.amount !== order.amountMinor) {
        this.logger.error(`order ${order.id}: statement amount ${settlement.amount} != order amount ${order.amountMinor} (minor units)`);
      }
      await this.orders.settle(order.id, settledAt);
      await this.orders.recordSettlement({
        orderId: order.id,
        txid: settlement.txid,
        statementDate: settlement.date,
        settledAt,
      });
      this.logger.log(`order ${order.id} settled via statement ${settlement.date}`);
    }
  }

  /**
   * The only path to a resend: an order whose outcome is unknown, is past
   * the publication lag, and is absent from a fully fetched statement.
   * Absence is proof the send did not land.
   */
  private async handleProvenAbsence(settlements: Settlement[], awaitingEvidence: Order[]): Promise<void> {
    const provenPresent = new Set(settlements.map((s) => s.txid));
    for (const order of awaitingEvidence) {
      if (provenPresent.has(order.txid)) continue; // it landed; matched above

      if (order.attempts >= MAX_SEND_ATTEMPTS) {
        // Five attempts made, all without proof of landing. Stop and
        // escalate: park for manual review. Never auto-revert, never
        // release, never mark failed-and-forget.
        await this.orders.park(order.id, this.clock(), 'attempts_exhausted');
        this.logger.error(`order ${order.id} parked for manual review after ${order.attempts} attempts`);
        continue;
      }

      await this.sendOrder(order); // same derived txid — the bank sees the same instruction
    }
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/payout.processor.spec.ts
```ts
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PayoutProcessor,
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
} from '../src/payout/payout.processor.js';
import type { ReconcileWindow } from '../src/payout/payout.service.js';

class FakePayoutService {
  windows: ReconcileWindow[] = [];

  async reconcile(window: ReconcileWindow): Promise<void> {
    this.windows.push({ from: new Date(window.from), to: new Date(window.to) });
  }
}

describe('PayoutProcessor', () => {
  beforeEach(() => {
    delete process.env.RECONCILE_INTERVAL_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('consecutive ticks reconcile trailing windows that overlap', async () => {
    const service = new FakePayoutService();
    const processor = new PayoutProcessor(service);

    const first = new Date('2025-03-10T12:00:00.000Z');
    await processor.tick(first);
    await processor.tick(new Date(first.getTime() + RECONCILE_INTERVAL_MS));

    const [w1, w2] = service.windows;
    expect(w1.to).toEqual(first);
    expect(w1.from).toEqual(new Date(first.getTime() - RECONCILE_WINDOW_MS));
    expect(w2.from.getTime()).toBeLessThan(w1.to.getTime()); // the overlap
    expect(w2.to.getTime() - w2.from.getTime()).toBe(RECONCILE_WINDOW_MS);
  });

  it('schedules a reconcile on the interval and stops on destroy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-10T12:00:00.000Z'));

    const service = new FakePayoutService();
    const processor = new PayoutProcessor(service);
    processor.onModuleInit();

    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(service.windows).toHaveLength(1);
    expect(service.windows[0].to).toEqual(new Date('2025-03-10T12:15:00.000Z'));

    processor.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS * 2);
    expect(service.windows).toHaveLength(1);
  });
});
```

### test/payout.service.spec.ts
```ts
import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Order, SettlementRecord } from '@prisma/client';
import {
  BankCode,
  deriveTxid,
  toUtcDateKey,
  type BankClient,
  type BankSendRequest,
  type BankSendResult,
  type Settlement,
} from '../src/payout/bank.client.js';
import type { AttemptPatch, NewOrderInput } from '../src/payout/payout.repository.js';
import {
  MAX_SEND_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
  type ReconcileWindow,
} from '../src/payout/payout.service.js';

const MIN = 60_000;
const T0 = new Date('2025-03-10T09:00:00.000Z');
const EFFECTIVE_DATE = new Date('2025-03-10T00:00:00.000Z');
// Comfortably past the 30-minute publishing lag.
const PAST_LAG = PUBLISHING_LAG_MS + 15 * MIN;

/* ------------------------------------------------------------------ */
/* fakes                                                               */
/* ------------------------------------------------------------------ */

class FakeBank implements BankClient {
  sends: BankSendRequest[] = [];
  nextResult: BankSendResult = { type: 'response', code: BankCode.Accepted, message: 'accepted' };
  statements = new Map<string, Settlement[]>();

  send(request: BankSendRequest): Promise<BankSendResult> {
    this.sends.push({ ...request });
    return Promise.resolve(this.nextResult);
  }

  getStatement(date: string): Promise<Settlement[]> {
    return Promise.resolve(this.statements.get(date) ?? []);
  }
}

class FakeOrderRepository {
  orders = new Map<string, Order>();
  settlementRecords: SettlementRecord[] = [];

  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    const order: Order = {
      id,
      supplierKey: input.supplierKey,
      amountMinor: input.amountMinor,
      effectiveDate: input.effectiveDate,
      txid: deriveTxid({
        id,
        effectiveDate: input.effectiveDate,
        amountMinor: input.amountMinor,
        supplierKey: input.supplierKey,
      }),
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      settledAt: null,
      parkedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.orders.set(id, order);
    return Promise.resolve(order);
  }

  findPending(): Promise<Order[]> {
    return Promise.resolve([...this.orders.values()].filter((o) => o.status === 'pending'));
  }

  findById(id: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(id) ?? null);
  }

  findByTxid(txid: string): Promise<Order | null> {
    return Promise.resolve([...this.orders.values()].find((o) => o.txid === txid) ?? null);
  }

  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return Promise.resolve(
      [...this.orders.values()].filter(
        (o) => o.status === 'unknown' && o.lastAttemptAt !== null && o.lastAttemptAt.getTime() <= asOf.getTime(),
      ),
    );
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, patch, { updatedAt: new Date() });
    return Promise.resolve(order);
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, { status: 'settled', settledAt, updatedAt: new Date() });
    return Promise.resolve(order);
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, {
      status: 'parked',
      parkedAt: at,
      lastOutcome: `parked:${reason}`,
      updatedAt: new Date(),
    });
    return Promise.resolve(order);
  }

  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    const existing = this.settlementRecords.find((r) => r.txid === input.txid);
    if (existing) return Promise.resolve(existing);
    const row: SettlementRecord = {
      ...input,
      id: randomUUID(),
      recordedAt: new Date(),
    };
    this.settlementRecords.push(row);
    return Promise.resolve(row);
  }

  private require(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`unknown order ${id}`);
    return order;
  }
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

let now: Date;
let repo: FakeOrderRepository;
let bank: FakeBank;
let service: PayoutService;

beforeEach(() => {
  now = new Date(T0);
  repo = new FakeOrderRepository();
  bank = new FakeBank();
  service = new PayoutService(repo, bank, () => now);
});

async function makeOrder(overrides: Partial<NewOrderInput> = {}): Promise<Order> {
  return repo.create({
    supplierKey: 'DE893705000042203314',
    amountMinor: 1_840_000,
    effectiveDate: EFFECTIVE_DATE,
    ...overrides,
  });
}

function windowAround(asOf: Date, widthMs = 45 * MIN): ReconcileWindow {
  return { from: new Date(asOf.getTime() - widthMs), to: asOf };
}

function snapshot(): unknown {
  return {
    orders: [...repo.orders.values()].map((o) => ({ ...o })),
    settlementRecords: repo.settlementRecords.map((r) => ({ ...r })),
  };
}

async function failFirstSend(): Promise<void> {
  bank.nextResult = { type: 'failure', message: 'connect timeout' };
  await service.executePayments();
}

/* ------------------------------------------------------------------ */
/* txid derivation                                                     */
/* ------------------------------------------------------------------ */

describe('deriveTxid', () => {
  const base = { id: 'order-1', effectiveDate: EFFECTIVE_DATE, amountMinor: 100, supplierKey: 'key-1' };

  it('is deterministic: the same order on the same effective date always yields the same txid', () => {
    expect(deriveTxid(base)).toBe(deriveTxid({ ...base }));
    expect(deriveTxid(base)).toBe(deriveTxid({ ...base, effectiveDate: '2025-03-10' }));
  });

  it('changes when any input attribute changes', () => {
    expect(deriveTxid({ ...base, id: 'order-2' })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, effectiveDate: '2025-03-11' })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, amountMinor: 101 })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, supplierKey: 'key-2' })).not.toBe(deriveTxid(base));
  });
});

/* ------------------------------------------------------------------ */
/* executePayments                                                     */
/* ------------------------------------------------------------------ */

describe('executePayments', () => {
  const cases: Array<{ name: string; result: BankSendResult; status: string; lastOutcome: string }> = [
    {
      name: 'accepted',
      result: { type: 'response', code: BankCode.Accepted, message: 'accepted' },
      status: 'in_flight',
      lastOutcome: 'accepted',
    },
    {
      name: 'duplicate (bank already held the instruction)',
      result: { type: 'response', code: BankCode.Duplicate, message: 'already held' },
      status: 'in_flight',
      lastOutcome: 'duplicate',
    },
    {
      name: 'transient error (outcome unknown)',
      result: { type: 'failure', message: 'connect timeout' },
      status: 'unknown',
      lastOutcome: 'transient',
    },
    {
      name: 'permanent rejection',
      result: { type: 'response', code: BankCode.RejectedBlockedAccount, message: 'blocked' },
      status: 'rejected',
      lastOutcome: `permanent:${BankCode.RejectedBlockedAccount}`,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: takes the ${c.status} path with one recorded attempt`, async () => {
      const order = await makeOrder();
      bank.nextResult = c.result;

      await service.executePayments();

      expect(order.status).toBe(c.status);
      expect(order.attempts).toBe(1);
      expect(order.lastOutcome).toBe(c.lastOutcome);
      expect(order.lastAttemptAt).toEqual(now);
      expect(bank.sends).toHaveLength(1);
      expect(bank.sends[0]).toEqual({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.supplierKey,
      });
    });
  }

  it('a permanently rejected order is terminal: reconciliation neither re-sends nor reverts it', async () => {
    const order = await makeOrder();
    bank.nextResult = { type: 'response', code: BankCode.RejectedClosedBeneficiary, message: 'closed' };
    await service.executePayments();
    expect(order.status).toBe('rejected');

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('rejected');
    expect(order.attempts).toBe(1);
    expect(order.parkedAt).toBeNull();
    expect(bank.sends).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* reconcile                                                           */
/* ------------------------------------------------------------------ */

describe('reconcile', () => {
  it('timeout-but-settled: settles the order from the statement and never re-sends it', async () => {
    const order = await makeOrder();
    await failFirstSend();
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(order.settledAt).toEqual(new Date(now.toISOString()));
    expect(order.attempts).toBe(1); // no second attempt was made
    expect(bank.sends).toHaveLength(1);
  });

  it('settles an accepted order once its entry reaches the statement', async () => {
    const order = await makeOrder();
    await service.executePayments(); // accepted by default
    expect(order.status).toBe('in_flight');

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [{ txid: order.txid, amount: order.amountMinor, date }]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(order.settledAt).toEqual(now); // no bank timestamp ⇒ as-of time
    expect(bank.sends).toHaveLength(1);
  });

  it('proven-absent: re-sends past the publication lag, with the same derived txid', async () => {
    const order = await makeOrder();
    await failFirstSend();
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    bank.nextResult = { type: 'response', code: BankCode.Accepted, message: 'accepted' };

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(bank.sends[1].txid).toBe(bank.sends[0].txid); // the same instruction, not a new payment
    expect(bank.sends[1]).toEqual({
      txid: order.txid,
      amount: order.amountMinor,
      key: order.supplierKey,
    });
  });

  it('does not re-send while the bank is still within the publication lag', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + 10 * MIN); // inside the 30-minute lag
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('unknown');
    expect(order.attempts).toBe(1);
    expect(bank.sends).toHaveLength(1);
  });

  it('treats a duplicate response on a proven-absent resend as success, not a new payment', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    bank.nextResult = { type: 'response', code: BankCode.Duplicate, message: 'already held' };

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(bank.sends[1].txid).toBe(bank.sends[0].txid);
  });

  it('parks for manual review when attempts are exhausted, and never sends a sixth time', async () => {
    const order = await makeOrder();
    await failFirstSend(); // attempt 1
    // Attempts 2..5 were made by earlier reconciles; every one left the
    // outcome unknown, as the bank never acknowledged.
    Object.assign(order, {
      status: 'unknown' as const,
      attempts: MAX_SEND_ATTEMPTS,
      lastAttemptAt: new Date(now.getTime() - PAST_LAG),
    });

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked');
    expect(order.parkedAt).toEqual(now);
    expect(order.lastOutcome).toBe('parked:attempts_exhausted');
    expect(bank.sends).toHaveLength(1); // no sixth attempt
  });

  it('retries at most five times across repeated reconciles, then parks without sending again', async () => {
    const order = await makeOrder();
    await failFirstSend(); // attempt 1

    for (let i = 0; i < 4; i += 1) {
      now = new Date(now.getTime() + PAST_LAG);
      await service.reconcile(windowAround(now));
    }
    expect(order.attempts).toBe(MAX_SEND_ATTEMPTS);
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked');
    expect(order.parkedAt).toEqual(now);
    expect(bank.sends).toHaveLength(MAX_SEND_ATTEMPTS);
  });

  it('running twice over the same window leaves identical state (settled order)', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    const window = windowAround(now);
    await service.reconcile(window);
    const afterFirst = snapshot();

    await service.reconcile(window);
    const afterSecond = snapshot();

    expect(afterSecond).toEqual(afterFirst);
    expect(order.status).toBe('settled');
    expect(repo.settlementRecords).toHaveLength(1);
  });

  it('overlapping windows after a resend take no further action', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now)); // proven absent → resend, accepted
    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    const afterFirst = snapshot();

    now = new Date(now.getTime() + 15 * MIN); // the next run, overlapping window
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(snapshot()).toEqual(afterFirst);
  });

  it('ignores statement entries that match no order, without failing the run', async () => {
    const order = await makeOrder();
    await service.executePayments(); // accepted → in_flight

    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: 'pay_000000000000000000000000000000000000000000000000000000000000', amount: 5, date },
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(repo.settlementRecords).toHaveLength(1);
    expect(repo.settlementRecords[0].orderId).toBe(order.id);
  });

  it('never touches parked orders, even if their txid later appears in the statement', async () => {
    const order = await makeOrder();
    Object.assign(order, {
      status: 'parked' as const,
      attempts: MAX_SEND_ATTEMPTS,
      lastAttemptAt: new Date(now.getTime() - PAST_LAG),
      parkedAt: new Date(now.getTime() - PAST_LAG),
      lastOutcome: 'parked:attempts_exhausted',
    });
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [{ txid: order.txid, amount: order.amountMinor, date }]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked'); // not reverted, not settled
    expect(order.settledAt).toBeNull();
    expect(repo.settlementRecords).toHaveLength(0);
    expect(bank.sends).toHaveLength(0);
  });
});
```
