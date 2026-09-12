# repair1-set

## reasoning

```
We need to fix import paths: likely the project uses tsconfig baseUrl? But easiest: add index.ts files? Actually path errors due to missing extensions? In Node ESM, imports need .js extension? But TypeScript compile with moduleResolution node16 expects .js? Simpler: add .ts extensions in imports. Change imports to include .ts relative? For example src/app.module.ts imports './payout/payout.module' should be './payout/payout.module.js' after compile? In tsconfig with "type":"module", need .js. So adjust all imports to add .js extension. Also class-validator import path is fine but need to install types? Probably missing dependency, but we can change to use built-in validator? However test imports failing: '../src/payout/payout.service' should be '../src/payout/payout.service.js'.

Also Logger.info exists? Nest Logger has .log, .verbose, .debug, .error, .warn. No .info. Change to .log.

Also test type errors: they use vi.fn<Promise<any>, [any]>() generic syntax maybe wrong. But errors at lines 66-67 expecting 0-1 type arguments: vi.fn generic signature expects one type argument? Actually vi.fn<T extends (...args:any)=>any>(implementation?) Not sure. Simpler: remove generic args. Change MockBankService definitions to not use generics.

Also property 'txid' does not exist on type 'never' due to repo.getById returning Payout|undefined but TypeScript infers never? In test they call afterSend?.txid, okay. The errors at lines 112,174 refer to settlement variable? Probably TypeScript can't infer settlement type because they imported Settlement incorrectly. In test, they imported { Settlement } from '../src/bank/bank.service'; but bank.service maybe not exported Settlement type. Need to export type. Let's open bank.service file (not given). Might be missing export. But we can add export type Settlement in bank.service. Since not provided, we need to create minimal file? Actually compilation fails due to missing module '../src/bank/bank.service'. There is no such folder in repo. We need to add bank service stub. But tests reference it, so we need to create src/bank/bank.service.ts with required types and class with send and getStatement. Provide minimal implementation.

Also need PrismaService file. Not present. Add src/prisma/prisma.service.ts with @Injectable and PrismaClient.

Thus create those files.

Let's implement:

src/bank/bank.service.ts:
export interface Settlement { txid:string; amount:number; settledAt:Date;}
export interface SendPayload { txid:string; amount:number; key:string;}
export interface SendResult { status:string; error?:string;}
@Injectable() class BankService { async send(payload: SendPayload): Promise<SendResult>{ return {status:'accepted'};} async getStatement(date: Date): Promise<Settlement[]> { return []; } }

Also export class.

Also need to export from index? Not needed.

Add src/prisma/prisma.service.ts: import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'; import { PrismaClient } from '@prisma/client'; @Injectable() export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy { async onModuleInit(){ await this.$connect(); } async onModuleDestroy(){ await this.$disconnect(); } }

Now adjust imports to .js extensions. Since we add new files, need .js extension in imports.

Modify all import statements in the listed files.

Let's apply patches.
```

## reply

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
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Application listening on port ${port}`);
}
bootstrap();
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post, Body } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { IsISO8601 } from 'class-validator';

class ReconcileDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(): Promise<{ message: string }> {
    await this.payoutService.executePayments();
    return { message: 'Payments execution triggered' };
  }

  @Post('reconcile')
  async reconcile(@Body() dto: ReconcileDto): Promise<{ message: string }> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    await this.payoutService.reconcile({ start, end });
    return { message: 'Reconciliation completed' };
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BankService } from '../bank/bank.service.js';
import { PayoutReconcileJob } from './payout.reconcile.job.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PrismaService,
    BankService,
    PayoutReconcileJob,
  ],
})
export class PayoutModule {}
```

### src/payout/payout.reconcile.job.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutReconcileJob {
  private readonly logger = new Logger(PayoutReconcileJob.name);
  private readonly intervalMs = 15 * 60 * 1000; // 15 minutes
  private readonly publishingLagMs = 30 * 60 * 1000; // 30 minutes

  constructor(private readonly payoutService: PayoutService) {}

  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    const now = new Date();
    // Overlapping window: start a bit earlier to guarantee coverage.
    const start = new Date(now.getTime() - this.publishingLagMs - this.intervalMs);
    const end = now;
    this.logger.debug(`Running reconcile for window ${start.toISOString()} – ${end.toISOString()}`);
    await this.payoutService.reconcile({ start, end });
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingPayouts(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
    });
  }

  async findSentPendingPayoutsWithinWindow(start: Date, end: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.SENT_PENDING,
        effectiveDate: {
          gte: start,
          lte: end,
        },
      },
    });
  }

  async findByTxId(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { txid },
    });
  }

  async updatePayout(id: number, data: Partial<Payout>): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data,
    });
  }

  async setTxId(id: number, txid: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { BankService, Settlement } from '../bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

interface ReconcileWindow {
  start: Date;
  end: Date;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly publishingLagMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  /**
   * Derive a deterministic txid from stable payout attributes.
   */
  private deriveTxId(payout: Payout): string {
    const data = `${payout.id}-${payout.supplierId}-${payout.amount}-${payout.effectiveDate.toISOString()}`;
    return createHash('sha256').update(data).digest('hex');
  }

  private async handleBankSend(payout: Payout, txid: string): Promise<void> {
    const payload = {
      txid,
      amount: payout.amount,
      key: payout.key,
    };

    let result;
    try {
      result = await this.bankService.send(payload);
    } catch (err) {
      this.logger.error(`Bank send error for payout ${payout.id}: ${err}`);
      await this.recordTransientFailure(payout);
      return;
    }

    switch (result.status) {
      case 'accepted':
      case 'duplicate':
        await this.recordSendSuccess(payout);
        break;
      case 'transient_error':
        await this.recordTransientFailure(payout);
        break;
      case 'permanent_rejection':
        await this.recordPermanentRejection(payout);
        break;
      default:
        this.logger.warn(`Unexpected bank send result for payout ${payout.id}: ${JSON.stringify(result)}`);
        await this.recordTransientFailure(payout);
        break;
    }
  }

  private async recordSendSuccess(payout: Payout): Promise<void> {
    const now = new Date();
    const attemptCount = (payout.attemptCount ?? 0) + 1;
    await this.payoutRepository.updatePayout(payout.id, {
      status: PayoutStatus.SENT_PENDING,
      attemptCount,
      lastAttemptAt: now,
    });
  }

  private async recordTransientFailure(payout: Payout): Promise<void> {
    const now = new Date();
    const attemptCount = (payout.attemptCount ?? 0) + 1;
    const data: Partial<Payout> = {
      status: PayoutStatus.SENT_PENDING,
      attemptCount,
      lastAttemptAt: now,
    };
    if (attemptCount >= 5) {
      data.status = PayoutStatus.PARKED;
    }
    await this.payoutRepository.updatePayout(payout.id, data);
  }

  private async recordPermanentRejection(payout: Payout): Promise<void> {
    await this.payoutRepository.updatePayout(payout.id, {
      status: PayoutStatus.PARKED,
    });
  }

  /**
   * Sends all pending payouts.
   * Only payouts with status PENDING are considered.
   */
  async executePayments(): Promise<void> {
    const pending = await this.payoutRepository.findPendingPayouts();
    for (const payout of pending) {
      const txid = this.deriveTxId(payout);
      if (!payout.txid || payout.txid !== txid) {
        await this.payoutRepository.setTxId(payout.id, txid);
      }
      await this.handleBankSend(payout, txid);
    }
  }

  /**
   * Reconciles payouts against the bank statement for the given window.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const { start, end } = window;
    // Retrieve statement entries for the start date (assumed to cover the window).
    const statement = await this.bankService.getStatement(start);
    const settlementMap = new Map<string, Settlement>();
    for (const settlement of statement) {
      settlementMap.set(settlement.txid, settlement);
    }

    const payouts = await this.payoutRepository.findSentPendingPayoutsWithinWindow(start, end);
    const now = new Date();

    for (const payout of payouts) {
      // Skip if already settled (should not be present, but defensive).
      if (payout.status === PayoutStatus.SETTLED) {
        continue;
      }

      const txid = payout.txid || this.deriveTxId(payout);
      const settlement = settlementMap.get(txid);

      if (settlement) {
        await this.payoutRepository.updatePayout(payout.id, { status: PayoutStatus.SETTLED });
        this.logger.log(`Payout ${payout.id} settled (txid ${txid})`);
        continue;
      }

      // No settlement found – check if publishing lag has passed.
      if (!payout.lastAttemptAt) {
        // No attempt timestamp; nothing to reconcile.
        continue;
      }

      const ageMs = now.getTime() - payout.lastAttemptAt.getTime();
      if (ageMs < this.publishingLagMs) {
        // Still within lag window; wait for next run.
        continue;
      }

      // If attempts exhausted, park for manual review.
      if ((payout.attemptCount ?? 0) >= 5) {
        await this.payoutRepository.updatePayout(payout.id, { status: PayoutStatus.PARKED });
        continue;
      }

      // Resend with the same deterministic txid.
      await this.handleBankSend(payout, txid);
    }
  }
}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';

export interface Settlement {
  txid: string;
  amount: number;
  settledAt: Date;
}

export interface SendPayload {
  txid: string;
  amount: number;
  key: string;
}

export interface SendResult {
  status: 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';
  error?: string;
}

@Injectable()
export class BankService {
  async send(payload: SendPayload): Promise<SendResult> {
    // Placeholder implementation – in real usage this would call the external bank API.
    return { status: 'accepted' };
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // Placeholder implementation – returns an empty statement.
    return [];
  }
}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### test/payout.spec.ts
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { BankService } from '../src/bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { Settlement } from '../src/bank/bank.service.js';

/**
 * In‑memory mock of the payout repository.
 */
class MockPayoutRepository {
  private payouts = new Map<number, Payout>();

  constructor(initial: Payout[] = []) {
    for (const p of initial) {
      this.payouts.set(p.id, { ...p });
    }
  }

  async findPendingPayouts(): Promise<Payout[]> {
    return [...this.payouts.values()].filter(p => p.status === PayoutStatus.PENDING);
  }

  async findSentPendingPayoutsWithinWindow(start: Date, end: Date): Promise<Payout[]> {
    return [...this.payouts.values()].filter(p => {
      return (
        p.status === PayoutStatus.SENT_PENDING &&
        p.effectiveDate >= start &&
        p.effectiveDate <= end
      );
    });
  }

  async findByTxId(txid: string): Promise<Payout | null> {
    for (const p of this.payouts.values()) {
      if (p.txid === txid) return p;
    }
    return null;
  }

  async updatePayout(id: number, data: Partial<Payout>): Promise<Payout> {
    const existing = this.payouts.get(id);
    if (!existing) throw new Error(`Payout ${id} not found`);
    const updated = { ...existing, ...data };
    this.payouts.set(id, updated);
    return updated;
  }

  async setTxId(id: number, txid: string): Promise<Payout> {
    const existing = this.payouts.get(id);
    if (!existing) throw new Error(`Payout ${id} not found`);
    const updated = { ...existing, txid };
    this.payouts.set(id, updated);
    return updated;
  }

  // Helper for tests
  getById(id: number): Payout | undefined {
    return this.payouts.get(id);
  }
}

/**
 * Mock of the external bank service.
 */
class MockBankService implements Partial<BankService> {
  send = vi.fn();
  getStatement = vi.fn<Promise<Settlement[]>, [Date]>();
}

describe('PayoutService', () => {
  let bankService: MockBankService;
  let repo: MockPayoutRepository;
  let service: PayoutService;
  const now = new Date('2023-01-01T10:00:00Z');

  beforeEach(() => {
    bankService = new MockBankService();
    repo = new MockPayoutRepository();
    // @ts-ignore – we only need the methods used by the service.
    service = new PayoutService(repo as any, bankService as any);
  });

  it('timeout-but-settled: does not resend when settlement appears', async () => {
    const payout: Payout = {
      id: 1,
      supplierId: 42,
      amount: 1000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-1',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // First send – simulate transient error (timeout).
    bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });

    await service.executePayments();

    const afterSend = repo.getById(1);
    expect(afterSend).toBeDefined();
    expect(afterSend?.status).toBe(PayoutStatus.SENT_PENDING);
    expect(afterSend?.attemptCount).toBe(1);
    expect(afterSend?.txid).toBeDefined();
    const storedTxId = afterSend?.txid as string;
    expect(bankService.send).toHaveBeenCalledTimes(1);
    expect(bankService.send.mock.calls[0][0].txid).toBe(storedTxId);

    // Bank statement now contains the settlement.
    const settlement: Settlement = {
      txid: storedTxId,
      amount: payout.amount,
      settledAt: new Date('2023-01-01T10:05:00Z'),
    };
    bankService.getStatement.mockResolvedValueOnce([settlement]);

    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    await service.reconcile({ start, end });

    const afterReconcile = repo.getById(1);
    expect(afterReconcile?.status).toBe(PayoutStatus.SETTLED);
    expect(bankService.send).toHaveBeenCalledTimes(1); // no resend
    expect(bankService.getStatement).toHaveBeenCalledTimes(1);
  });

  it('proven-absent: resends when settlement absent after lag', async () => {
    const payout: Payout = {
      id: 2,
      supplierId: 99,
      amount: 2000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-2',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // First send – transient error.
    bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });

    await service.executePayments();

    const afterFirst = repo.getById(2);
    expect(afterFirst?.status).toBe(PayoutStatus.SENT_PENDING);
    expect(afterFirst?.attemptCount).toBe(1);
    const txid = afterFirst?.txid as string;

    // Statement empty for the first reconciliation.
    bankService.getStatement.mockResolvedValueOnce([]);

    // Simulate that the publishing lag has passed.
    const oldAttempt = new Date(now.getTime() - 31 * 60 * 1000);
    await repo.updatePayout(2, { lastAttemptAt: oldAttempt });

    // Resend will be accepted.
    bankService.send.mockResolvedValueOnce({ status: 'accepted' });

    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    await service.reconcile({ start, end });

    expect(bankService.send).toHaveBeenCalledTimes(2);
    expect(bankService.send.mock.calls[1][0].txid).toBe(txid);
    const afterReconcile = repo.getById(2);
    expect(afterReconcile?.attemptCount).toBe(2);
    expect(afterReconcile?.status).toBe(PayoutStatus.SENT_PENDING);
  });

  it('attempt exhaustion: parks payout after max attempts', async () => {
    // Payout already attempted 5 times without settlement.
    const payout: Payout = {
      id: 3,
      supplierId: 123,
      amount: 5000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-3',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // Simulate 5 transient failures via executePayments + manual attempt counting.
    for (let i = 0; i < 5; i++) {
      bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });
      await service.executePayments();
      const oldAttempt = new Date(now.getTime() - (31 + i) * 60 * 1000);
      await repo.updatePayout(3, { lastAttemptAt: oldAttempt });
    }

    const afterAttempts = repo.getById(3);
    expect(afterAttempts?.attemptCount).toBe(5);
    expect(afterAttempts?.status).toBe(PayoutStatus.SENT_PENDING);
    const txid = afterAttempts?.txid as string;

    // No settlement appears.
    bankService.getStatement.mockResolvedValueOnce([]);

    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await service.reconcile({ start, end });

    const afterReconcile = repo.getById(3);
    expect(afterReconcile?.status).toBe(PayoutStatus.PARKED);
    // No additional send should have been made during reconcile.
    expect(bankService.send).toHaveBeenCalledTimes(5);
    // Ensure the stored txid never changed.
    expect(afterReconcile?.txid).toBe(txid);
  });
});
```
