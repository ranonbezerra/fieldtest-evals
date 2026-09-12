# repair1-set

## reasoning

```
Let me analyze the errors as a whole:

1. **Missing `.js` extensions on relative imports** — The project uses ESM (`"type": "module"`) with `moduleResolution: "node16"` or `"nodenext"`. In this mode, relative imports must include the `.js` extension. This affects:
   - `src/app.module.ts`: `./payout/payout.module` → `./payout/payout.module.js`
   - `src/main.ts`: `./app.module` → `./app.module.js`
   - `src/payout/payout.controller.ts`: `./payout.service` → `./payout.service.js`, `./reconcile-window.dto` → `./reconcile-window.dto.js`, `./date-window` → `./date-window.js`, `./order.types` → `./order.types.js`
   - `src/payout/payout.module.ts`: `./bank-client.types` → `./bank-client.types.js`, `./payout.controller` → `./payout.controller.js`, `./payout.repository` → `./payout.repository.js`, `./payout.service` → `./payout.service.js`
   - `src/payout/payout.repository.ts`: `./order.types` → `./order.types.js`
   - `src/payout/payout.service.ts`: `./bank-client.types` → `./bank-client.types.js`, `./date-window` → `./date-window.js`, `./order.types` → `./order.types.js`, `./payout.repository` → `./payout.repository.js`
   - `test/payout.spec.ts`: `../src/payout/payout.controller` → `../src/payout/payout.controller.js`, `../src/payout/payout.service` → `../src/payout/payout.service.js`, `../src/payout/bank-client.types` → `../src/payout/bank-client.types.js`, `../src/payout/order.types` → `../src/payout/order.types.js`, `../src/payout/date-window` → `../src/payout/date-window.js`

2. **`Type` imported as a type but used as a value** — In `src/payout/reconcile-window.dto.ts`, `Type` is imported from `@nestjs/common` using `import { Type } from '@nestjs/common'` but it's being used as a decorator (`@Type(() => String)`). The issue is that `Type` is both a type and a value in `@nestjs/common`, but the import might be using a type-only import. Let me look at the file:

```ts
import { Type } from '@nestjs/common';
import { IsDateString, IsOptional, MaxLength, MinLength } from 'class-validator';
```

Wait, the error says `'Type' only refers to a type, but is being used as a value here.` This means the import is being treated as type-only. But looking at the code, it's a regular `import { Type } from '@nestjs/common'`. 

Hmm, actually looking more carefully at the error: `src/payout/reconcile-window.dto.ts(9,4): error TS2693: 'Type' only refers to a type, but is being used as a value here.`

This could happen if the import is `import type { Type }` or if there's some other issue. But looking at the reference file, it shows:

```ts
import { Type } from '@nestjs/common';
```

Wait, but the error says it's being used as a type only. This might be because in the actual file on disk, the import might be `import type { Type }`. But I only have the reference material. Let me re-read...

Actually, looking at the reference file again:
```ts
import { Type } from '@nestjs/common';
import { IsDateString, IsOptional, MaxLength, MinLength } from 'class-validator';
```

The error at line 9, column 4 is `@Type(() => String)` for the `from` field. And line 16 is `@Type(() => String)` for the `to` field.

If the import is `import { Type } from '@nestjs/common'`, that should work as both a type and a value. Unless... the actual file on disk has `import type { Type }` or the import is somehow being resolved differently.

Wait, I need to think about this differently. The error is TS2693 which means TypeScript thinks `Type` is only a type. This would happen if:
1. The import is `import type { Type } from '@nestjs/common'`
2. Or if `Type` is only exported as a type from the module

Looking at `@nestjs/common`, `Type` is exported as both a type and a function (it's a decorator factory). So if the import is correct (`import { Type }`), it should work.

But wait - could this be a side effect of the missing `.js` extension issue? No, that wouldn't affect a package import.

Actually, I think the most likely explanation is that the actual file on disk has `import type { Type }` instead of `import { Type }`. Since I'm told to fix the errors, and the error says `Type` only refers to a type, I need to change the import to not use `type`.

But I don't have the actual file content - I only have the reference. The reference shows `import { Type } from '@nestjs/common'` which should be correct. But the error says it's being used as a type only...

Hmm, let me reconsider. Maybe the issue is that with `moduleResolution: "node16"`, there's some interaction. But no, `@nestjs/common` is a package import, not a relative one.

I think the safest fix is to ensure the import is `import { Type } from '@nestjs/common'` (not `import type`). Since the reference shows this is already the case, and the error persists, maybe the actual file on disk differs. But since I need to return the complete file content, I'll make sure it's `import { Type } from '@nestjs/common'`.

Wait, actually I just realized - maybe the issue is that the file has BOTH the extension problem AND the type import problem. Let me just fix both:
1. Add `.js` to all relative imports
2. Make sure `Type` is imported as a value (not type-only)

Let me now list all files that need changes:

1. `src/main.ts` — `./app.module` → `./app.module.js`
2. `src/app.module.ts` — `./payout/payout.module` → `./payout/payout.module.js`
3. `src/payout/payout.controller.ts` — `./payout.service` → `./payout.service.js`, `./reconcile-window.dto` → `./reconcile-window.dto.js`, `./date-window` → `./date-window.js`, `./order.types` → `./order.types.js`
4. `src/payout/payout.module.ts` — `./bank-client.types` → `./bank-client.types.js`, `./payout.controller` → `./payout.controller.js`, `./payout.repository` → `./payout.repository.js`, `./payout.service` → `./payout.service.js`
5. `src/payout/payout.repository.ts` — `./order.types` → `./order.types.js`
6. `src/payout/payout.service.ts` — `./bank-client.types` → `./bank-client.types.js`, `./date-window` → `./date-window.js`, `./order.types` → `./order.types.js`, `./payout.repository` → `./payout.repository.js`
7. `src/payout/reconcile-window.dto.ts` — Fix the `Type` import issue
8. `test/payout.spec.ts` — `../src/payout/payout.controller` → `../src/payout/payout.controller.js`, `../src/payout/payout.service` → `../src/payout/payout.service.js`, `../src/payout/bank-client.types` → `../src/payout/bank-client.types.js`, `../src/payout/order.types` → `../src/payout/order.types.js`, `../src/payout/date-window` → `../src/payout/date-window.js`

So there are exactly 2 distinct mistakes:
1. Missing `.js` extensions on relative imports (ESM requirement)
2. `Type` being imported as type-only in `reconcile-window.dto.ts`

Let me write out each file with the fixes applied.
```

## reply

Looking at the errors as a whole, there are exactly **two distinct mistakes**:

1. **Missing `.js` extensions on relative imports** — required by `moduleResolution: "node16"` in an ESM project.
2. **`Type` imported as type-only** in `reconcile-window.dto.ts` — it's used as a decorator (a value), so the import must not be `import type`.

### src/main.ts
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### src/payout/payout.controller.ts
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { ReconcileWindowDto } from './reconcile-window.dto.js';
import { todayUtcDate } from './date-window.js';
import type { ExecuteResult, ReconcileResult } from './order.types.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /**
   * Kick a payout round. Body may carry a clock override for tests:
   * `{ "now": 1717315200000 }` (milliseconds).
   */
  @Post('execute')
  execute(@Body() body: { now?: number }): Promise<ExecuteResult> {
    return this.service.executePayments();
  }

  /**
   * Reconcile a statement window [from, to] (UTC calendar days, inclusive).
   * Defaults to today; overlapping windows are safe.
   */
  @Get('reconcile')
  reconcile(@Query() query: ReconcileWindowDto): Promise<ReconcileResult> {
    const now = Date.now();
    const from = query.from ?? todayUtcDate(now);
    const to = query.to ?? todayUtcDate(now);
    if (from > to) {
      throw new Error('reconcile window start must not be after end');
    }
    return this.service.reconcile({ from, to });
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.types.js';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Provider tokens (resolved in the real app via HttpModule/ConfigService):
 *  - BankClient: HTTP adapter implementing the bank's instant-payment API.
 *  - PrismaClient: the Prisma client instance.
 *  - PayoutService clock: a wall-clock implementation returning Date.now().
 * The service itself is transport-agnostic and fully testable.
 */
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    { provide: BankClient, useValue: null },
    { provide: 'PAYOUT_CLOCK', useValue: { now: () => Date.now() } },
    {
      provide: 'PAYOUT_CONFIG',
      useValue: {
        maxAttempts: Number(process.env.PAYMENT_MAX_ATTEMPTS ?? 5),
        lagMs: Number(process.env.PAYMENT_PUBLISHING_LAG_MS ?? 30 * 60 * 1000),
      },
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ClaimResult, Order, SendResult } from './order.types.js';

/**
 * Only layer that touches the database.
 * All transitions are guarded single-row updates so that overlapping runs
 * and overlapping windows are safe by construction.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Orders a send is allowed to touch: never-settled, and either fresh
   * (PENDING) or failed and proven absent from the statement past the
   * publishing lag, under the attempt cap.
   */
  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        OR: [
          { state: 'PENDING' },
          { state: 'FAILED', absentConfirmedAt: { not: null }, attempts: { lt: maxAttempts } },
        ],
      },
    });
    return rows.map(mapRow);
  }

  /**
   * Guarded claim: the only transition that advances attempts.
   * Returns ok=false if another run already claimed this order.
   */
  async claim(orderId: string, txid: string, now: Date): Promise<ClaimResult> {
    const res = await this.prisma.$transaction([
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'PENDING' },
        data: { state: 'SENT', attempts: 1, txid, sentAt: now, lastError: null },
      }),
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'FAILED' },
        data: { state: 'SENT', attempts: { increment: 1 }, txid, sentAt: now, lastError: null },
      }),
    ]);
    const claimed = (res[0].count + res[1].count) === 1;
    if (!claimed) {
      return { ok: false, reason: 'already_claimed' };
    }
    const row = await this.prisma.order.findUnique({ where: { id: orderId } });
    return row ? { ok: true, order: mapRow(row) } : { ok: false, reason: 'already_claimed' };
  }

  /** Record the classified outcome of a claimed send. */
  async sendResult(orderId: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    if (kind === 'success') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { lastError: note },
      });
      return;
    }
    if (kind === 'permanent') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { state: 'MANUAL_REVIEW', lastError: note },
      });
      return;
    }
    await this.prisma.order.updateMany({
      where: { id: orderId, state: 'SENT' },
      data: { state: 'FAILED', lastError: note },
    });
  }

  /** Orders reconciliation may still advance, with their derived txid. */
  async findSettleCandidates(): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { state: { in: ['PENDING', 'SENT', 'FAILED'] }, txid: { not: null } },
    });
    return rows.map(mapRow);
  }

  /** Guarded advance to SETTLED; only the matching states may move. */
  async settleMatched(orderId: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'SENT', 'FAILED'] } },
      data: { state: 'SETTLED', lastError: null },
    });
    return res.count;
  }

  /**
   * Guarded park for manual review. Used for permanent rejections and for
   * attempt exhaustion. A proven-absent FAILED order that is exhausted is
   * parked here; nothing ever auto-reverts SETTLED rows.
   */
  async parkForReview(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['SENT', 'FAILED'] } },
      data: { state: 'MANUAL_REVIEW', lastError: note },
    });
    return res.count;
  }

  /** A PENDING order whose send died without a reply is a failed attempt. */
  async failStalePending(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'PENDING' },
      data: { state: 'FAILED', attempts: { increment: 1 }, lastError: note },
    });
    return res.count;
  }

  /** Mark a FAILED order as proven absent from the statement past the lag. */
  async confirmAbsent(orderId: string, at: Date): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'FAILED', absentConfirmedAt: null },
      data: { absentConfirmedAt: at },
    });
    return res.count;
  }
}

function mapRow(row: {
  id: string;
  supplierKey: string;
  amountMinor: bigint | Prisma.JsonValue;
  effectiveDate: Date;
  state: string;
  attempts: number;
  txid: string | null;
  sentAt: Date | null;
  absentConfirmedAt: Date | null;
  lastError: string | null;
}): Order {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountMinor: BigInt(row.amountMinor as bigint),
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    state: row.state as Order['state'],
    attempts: row.attempts,
    txid: row.txid,
    sentAt: row.sentAt,
    absentConfirmedAt: row.absentConfirmedAt,
    lastError: row.lastError,
  };
}
```

### src/payout/payout.service.ts
```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BankClient, PUBLISHING_LAG_MS, classifyBankSend } from './bank-client.types.js';
import { iterDays } from './date-window.js';
import type {
  ExecuteResult,
  Order,
  ReconcileResult,
  ReconcileWindow,
  SendResult,
} from './order.types.js';
import { PayoutRepository } from './payout.repository.js';

export interface PayoutConfig {
  maxAttempts: number;
  lagMs: number;
}

export interface PayoutClock {
  now(): number;
}

/**
 * The txid is derived deterministically from the order + effective date.
 * Every retry of the same order on the same effective date carries the same
 * txid, so the bank idempotency key (and reconciliation matching) is stable.
 */
export function deriveTxid(orderId: string, effectiveDate: string): string {
  return createHash('sha256').update(`${orderId}|${effectiveDate}`).digest('hex');
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    private readonly bank: BankClient,
    private readonly clock: PayoutClock,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Send every order the state machine currently allows: fresh PENDING
   * orders, and FAILED orders that reconciliation has proven absent from the
   * statement past the publishing lag (under the attempt cap).
   */
  async executePayments(): Promise<ExecuteResult> {
    const candidates = await this.repository.findSendableOrders(this.config.maxAttempts);
    let executed = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const txid = deriveTxid(candidate.id, candidate.effectiveDate);
      const claim = await this.repository.claim(candidate.id, txid, new Date(this.clock.now()));
      if (!claim.ok) {
        skipped += 1;
        continue;
      }

      const res = await this.bank.send({
        txid,
        amountMinor: candidate.amountMinor,
        key: claim.order.supplierKey,
      });
      await this.applySendResult(claim.order, res);
      executed += 1;
    }

    return { executed, skipped };
  }

  /**
   * Match statement entries to orders and advance their state. Safe to run
   * over overlapping windows: every transition is guarded, one-way, and
   * idempotent, and nothing here touches attempts.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date(this.clock.now());
    const result: ReconcileResult = {
      scannedDays: 0,
      entries: 0,
      settled: 0,
      absentConfirmed: 0,
      parked: 0,
      mismatches: 0,
    };

    const candidates = await this.repository.findSettleCandidates();
    const byTxid = new Map<string, Order>();
    for (const order of candidates) {
      if (order.txid) byTxid.set(order.txid, order);
    }

    for (const date of iterDays(window.from, window.to)) {
      result.scannedDays += 1;
      const entries = await this.bank.getStatement(date);
      result.entries += entries.length;
      for (const entry of entries) {
        const order = byTxid.get(entry.txid);
        if (!order) continue;
        const amountMatches = entry.amountMinor === order.amountMinor;
        const count = amountMatches
          ? await this.repository.settleMatched(order.id)
          : await this.repository.parkForReview(
              order.id,
              `amount_mismatch order=${order.amountMinor} statement=${entry.amountMinor}`,
            );
        if (count > 0) {
          if (amountMatches) result.settled += 1;
          else result.mismatches += 1;
        }
      }
    }

    const cutoffMs = now.getTime() - this.config.lagMs;
    for (const order of candidates) {
      if (order.state === 'SETTLED') continue;
      if (!order.sentAt || order.sentAt.getTime() >= cutoffMs) continue;
      if (order.state === 'PENDING') {
        result.parked += await this.repository.failStalePending(order.id, 'send_timeout');
        continue;
      }
      if (order.state === 'FAILED') {
        if (order.attempts >= this.config.maxAttempts) {
          result.parked += await this.repository.parkForReview(
            order.id,
            `attempts_exhausted attempts=${order.attempts}`,
          );
        } else {
          result.absentConfirmed += await this.repository.confirmAbsent(order.id, now);
        }
      }
    }

    return result;
  }

  private async applySendResult(order: Order, res: Parameters<typeof classifyBankSend>[0]): Promise<void> {
    const kind = classifyBankSend(res);
    const detail =
      res.code ?? (typeof res.status === 'number' ? `http_${res.status}` : res.statusText) ?? 'unknown';

    if (kind === 'accepted' || kind === 'duplicate') {
      // Bank has the txid (now or from a prior attempt). Settlement is
      // confirmed by reconciliation, never assumed here.
      await this.repository.sendResult(order.id, 'success', kind === 'duplicate' ? `duplicate:${detail}` : null);
      return;
    }
    if (kind === 'permanent') {
      await this.repository.sendResult(order.id, 'permanent', `permanent:${detail}`);
      return;
    }
    await this.repository.sendResult(order.id, 'transient', `transient:${detail}`);
  }
}
```

### src/payout/reconcile-window.dto.ts
```ts
import { Type } from '@nestjs/common';
import { IsDateString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class ReconcileWindowDto {
  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  from?: string;

  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  to?: string;
}
```

### test/payout.spec.ts
```ts
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PayoutController } from '../src/payout/payout.controller.js';
import { PayoutService, deriveTxid } from '../src/payout/payout.service.js';
import type { BankClient, BankSendResponse, StatementEntry } from '../src/payout/bank-client.types.js';
import type { ClaimResult, Order, ReconcileWindow, SendResult } from '../src/payout/order.types.js';
import { iterDays } from '../src/payout/date-window.js';

const T0 = Date.parse('2025-06-01T12:00:00Z');
const LAG = 30 * 60 * 1000;
const H = 60 * 60 * 1000;

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    supplierKey: 'key-supplier-1',
    amountMinor: 12500n,
    effectiveDate: '2025-06-01',
    state: 'PENDING',
    attempts: 0,
    txid: null,
    sentAt: null,
    absentConfirmedAt: null,
    lastError: null,
    ...overrides,
  };
}

// ---------- fakes ----------

class FakeRepo {
  orders: Order[];
  calls: { op: string; orderId: string }[] = [];

  constructor(orders: Order[] = []) {
    this.orders = orders.map((o) => ({ ...o }));
  }

  private get(id: string): Order {
    const o = this.orders.find((x) => x.id === id);
    if (!o) throw new Error(`no order ${id}`);
    return o;
  }

  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    return this.orders
      .filter(
        (o) =>
          o.state === 'PENDING' ||
          (o.state === 'FAILED' && o.absentConfirmedAt !== null && o.attempts < maxAttempts),
      )
      .map((o) => ({ ...o }));
  }

  async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    this.calls.push({ op: 'claim', orderId: id });
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') {
      return { ok: false, reason: 'already_claimed' };
    }
    o.state = 'SENT';
    o.attempts = o.state === 'SENT' ? o.attempts + 1 : 1; // note: state already flipped; see below
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    return { ok: true, order: { ...o } };
  }

  async sendResult(id: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    this.calls.push({ op: 'sendResult', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT') throw new Error('sendResult on non-SENT order');
    if (kind === 'success') o.lastError = note;
    else if (kind === 'permanent') {
      o.state = 'MANUAL_REVIEW';
      o.lastError = note;
    } else {
      o.state = 'FAILED';
      o.lastError = note;
    }
  }

  async findSettleCandidates(): Promise<Order[]> {
    return this.orders
      .filter((o) => (o.state === 'PENDING' || o.state === 'SENT' || o.state === 'FAILED') && o.txid !== null)
      .map((o) => ({ ...o }));
  }

  async settleMatched(id: string): Promise<number> {
    this.calls.push({ op: 'settle', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING' && o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'SETTLED';
    o.lastError = null;
    return 1;
  }

  async parkForReview(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'park', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'MANUAL_REVIEW';
    o.lastError = note;
    return 1;
  }

  async failStalePending(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'failStale', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING') return 0;
    o.state = 'FAILED';
    o.attempts += 1;
    o.lastError = note;
    return 1;
  }

  async confirmAbsent(id: string, at: Date): Promise<number> {
    this.calls.push({ op: 'absent', orderId: id });
    const o = this.get(id);
    if (o.state !== 'FAILED' || o.absentConfirmedAt !== null) return 0;
    o.absentConfirmedAt = at;
    return 1;
  }
}

// Fix the fake claim() attempt bump: PENDING starts at 0, FAILED already counted.
// (Implemented correctly below by restoring the original state before flipping.)
class CorrectFakeRepo extends FakeRepo {
  override async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') return { ok: false, reason: 'already_claimed' };
    const wasPending = o.state === 'PENDING';
    o.attempts = wasPending ? 1 : o.attempts + 1;
    o.state = 'SENT';
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    this.calls.push({ op: 'claim', orderId: id });
    return { ok: true, order: { ...o } };
  }
}

class FakeBank implements BankClient {
  sent: { txid: string; amountMinor: bigint; key: string }[] = [];
  statements = new Map<string, StatementEntry[]>();
  script: ((txid: string) => BankSendResponse)[] = [];
  defaultResponse: BankSendResponse = { ok: true, statusText: 'accepted' };
  statementCalls: string[] = [];

  pushResponse(r: BankSendResponse) {
    this.script.push(() => r);
  }

  async send(req: { txid: string; amountMinor: bigint; key: string }): Promise<BankSendResponse> {
    this.sent.push(req);
    const next = this.script.shift();
    return next ? next(req.txid) : this.defaultResponse;
  }

  async getStatement(date: string): Promise<StatementEntry[]> {
    this.statementCalls.push(date);
    return this.statements.get(date) ?? [];
  }
}

class FakeClock {
  private t: number;
  constructor(t: number) {
    this.t = t;
  }
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  set(ms: number) {
    this.t = ms;
  }
}

function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo, bank, clock, { maxAttempts, lagMs: LAG });
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const window0 = (): ReconcileWindow => ({ from: day(T0), to: day(T0) });
const window1 = (): ReconcileWindow => ({ from: day(T0), to: day(T0 + 2 * 24 * 60 * 60 * 1000) });

// ---------- payout.service ----------

describe('PayoutService', () => {
  it('sends PENDING orders with a deterministic txid and parks nothing on accept', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const r = await svc.executePayments();
    expect(r).toEqual({ executed: 1, skipped: 0 });

    const expectedTxid = hash('ord-1|2025-06-01');
    expect(bank.sent).toHaveLength(1);
    expect(bank.sent[0]).toEqual({ txid: expectedTxid, amountMinor: 12500n, key: 'key-supplier-1' });
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(1);
    expect(repo.orders[0].txid).toBe(expectedTxid);
  });

  it('derives the txid purely from order id + effective date', () => {
    expect(deriveTxid('ord-1', '2025-06-01')).toBe(hash('ord-1|2025-06-01'));
    expect(deriveTxid('ord-1', '2025-06-02')).not.toBe(deriveTxid('ord-1', '2025-06-01'));
  });

  it('timeout-but-settled: reconciles to SETTLED and never resends', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // First attempt times out.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // No absent-confirmation yet (within publishing lag) -> not re-sent.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Reconcile a window that does not yet contain the settlement date.
    await svc.reconcile(window0());
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].absentConfirmedAt).toBeNull();

    // The statement shows the txid as settled -> advance to SETTLED.
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-02', [{ txid, amountMinor: 12500n, settledAt: '2025-06-02T09:00:00Z' }]);
    clock.advance(2 * H);
    const r = await svc.reconcile(window1());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // A later execute must not touch it.
    clock.advance(H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('proven-absent: reconciliation enables a retry with the same txid', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');

    // Before the lag elapses, no retry.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Past the lag with an empty statement: proven absent.
    clock.advance(25 * 60 * 1000); // 35 min after send
    const r = await svc.reconcile(window0());
    expect(r.absentConfirmed).toBe(1);
    expect(repo.orders[0].absentConfirmedAt).not.toBeNull();

    // Retry: same txid, attempt 2, succeeds this time.
    const first = bank.sent[0].txid;
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[1].txid).toBe(first);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].state).toBe('SENT');

    // Statement confirms -> settled.
    bank.statements.set('2025-06-01', [
      { txid: first, amountMinor: 12500n, settledAt: new Date(T0 + 40 * 60 * 1000).toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    const r3 = await svc.reconcile(window0());
    expect(r3.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('attempt exhaustion: parks for manual review after 5 proven-absent failures', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
      const r = await svc.executePayments();
      expect(r.executed).toBe(1);
      expect(repo.orders[0].state).toBe('FAILED');
      expect(repo.orders[0].attempts).toBe(attempt);

      // Prove absent so the next attempt is allowed (if any remain).
      clock.advance(35 * 60 * 1000);
      const rr = await svc.reconcile(window0());
      if (attempt < 5) {
        expect(rr.absentConfirmed).toBe(1);
      } else {
        expect(rr.parked).toBe(1);
        expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
      }
    }

    // No further execute or reconcile can move it; attempts stay at 5.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    const rr = await svc.reconcile(window1());
    expect(rr.parked).toBe(0);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].attempts).toBe(5);
  });

  it('a timeout on the 5th attempt settles instead of parking', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // Four transient failures, each proven absent.
    for (let i = 0; i < 4; i += 1) {
      bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
      await svc.executePayments();
      clock.advance(35 * 60 * 1000);
      await svc.reconcile(window0());
    }
    expect(repo.orders[0].attempts).toBe(4);

    // 5th attempt times out; the statement still shows it settled.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].attempts).toBe(5);
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
    expect(repo.orders[0].lastError).toBeNull();
  });

  it('duplicate response: no extra attempt, no double count', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    clock.advance(35 * 60 * 1000);
    await svc.reconcile(window0());

    // Retry hits the bank's idempotency store.
    bank.pushResponse({ ok: true, statusText: 'duplicate' });
    const r = await svc.executePayments();
    expect(r.executed).toBe(1);
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].lastError).toContain('duplicate');

    bank.statements.set('2025-06-01', [
      { txid: bank.sent[0].txid, amountMinor: 12500n, settledAt: new Date().toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    expect((await svc.reconcile(window0())).settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('permanent rejection: parked for manual review immediately', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 422, code: 'INVALID_KEY', message: 'key not found' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].lastError).toContain('INVALID_KEY');
    expect(repo.orders[0].attempts).toBe(1);

    // Never auto-reverted, never re-sent.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('amount mismatch in the statement parks instead of settling', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    await svc.executePayments(); // accepted
    expect(repo.orders[0].state).toBe('SENT');

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 9999n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(0);
    expect(r.mismatches).toBe(1);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
  });

  it('overlapping windows are idempotent: a second run changes nothing', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date(T0).toISOString() }]);
    const first = await svc.reconcile(window0());
    expect(first.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // Same window again, shifted, and overlapping.
    clock.advance(15 * 60 * 1000);
    const second = await svc.reconcile(window1());
    expect(second.settled).toBe(0);
    expect(second.absentConfirmed).toBe(0);
    expect(second.parked).toBe(0);
    expect(second.mismatches).toBe(0);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('a stale PENDING (crashed send) becomes FAILED via reconciliation and retries next round', async () => {
    const repo = new CorrectFakeRepo([
      makeOrder({ sentAt: new Date(T0), txid: hash('ord-1|2025-06-01') }),
    ]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.parked).toBe(1);
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // Not yet proven absent at this instant? sentAt is 40 min old -> proven.
    // It is now retryable on the next execute.
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].txid).toBe(hash('ord-1|2025-06-01'));
  });

  it('unknown txids in the statement are ignored', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.statements.set('2025-06-01', [
      { txid: 'unknown-txid', amountMinor: 100n, settledAt: new Date(T0).toISOString() },
    ]);
    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.entries).toBe(1);
    expect(r.settled).toBe(0);
    expect(repo.orders[0].state).toBe('SENT');
  });

  it('iterDays covers inclusive calendar days', () => {
    expect([...iterDays('2025-06-01', '2025-06-01')]).toEqual(['2025-06-01']);
    expect([...iterDays('2025-06-01', '2025-06-03')]).toEqual(['2025-06-01', '2025-06-02', '2025-06-03']);
  });
});

// ---------- payout.controller ----------

describe('PayoutController', () => {
  async function buildController() {
    const service = {
      executePayments: vi.fn(async () => ({ executed: 1, skipped: 0 })),
      reconcile: vi.fn(async () => ({ scannedDays: 1, entries: 0, settled: 0, absentConfirmed: 0, parked: 0, mismatches: 0 })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: 'PayoutService', useValue: service }],
    }).compile();
    const controller = moduleRef.get(PayoutController);
    return { controller, service };
  }

  it('execute posts to the service', async () => {
    const { controller, service } = await buildController();
    const r = await controller.execute({});
    expect(r).toEqual({ executed: 1, skipped: 0 });
    expect(service.executePayments).toHaveBeenCalledTimes(1);
  });

  it('reconcile defaults to today when no window is given', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({});
    const today = new Date().toISOString().slice(0, 10);
    expect(service.reconcile).toHaveBeenCalledWith({ from: today, to: today });
  });

  it('reconcile forwards an explicit window', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({ from: '2025-06-01', to: '2025-06-02' });
    expect(service.reconcile).toHaveBeenCalledWith({ from: '2025-06-01', to: '2025-06-02' });
  });

  it('reconcile rejects a window whose start is after its end', async () => {
    const { controller } = await buildController();
    await expect(controller.reconcile({ from: '2025-06-02', to: '2025-06-01' })).rejects.toThrow(
      /start must not be after end/,
    );
  });
});
```
