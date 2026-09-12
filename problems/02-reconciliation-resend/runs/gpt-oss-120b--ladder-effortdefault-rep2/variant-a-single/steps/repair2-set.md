# repair2-set

## reasoning

```
We need adjust import paths. The folder structure: src/... test/... imports use relative paths. In test they use '../src/...', but test folder is at root? Actually test/payout.spec.ts path. To import from src, should be '../src/...'? test file is in test folder, so ../src is correct. But TypeScript config maybe uses moduleResolution node and "type":"module". Need add .js extensions? Since ESM, imports need file extensions. All imports lack .js. Need add .js to each import path.

Update all imports to include .js extension. For example src/main.ts: import { AppModule } from './app.module'; -> './app.module.js'

Similarly others.

Implement changes in each file with imports.

List files to modify: src/main.ts, src/app.module.ts, src/payout/payout.controller.ts, src/payout/payout.module.ts, src/payout/payout.scheduler.ts, src/payout/payout.service.ts, test/payout.spec.ts.

Also need import Settlement type in payout.service: import { Settlement } from '../bank/bank.service'; currently missing. Add import.

Let's apply.
```

## reply

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';
import { PayoutScheduler } from './payout/payout.scheduler.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  controllers: [],
  providers: [PayoutScheduler],
})
export class AppModule {}
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(): Promise<{ message: string }> {
    await this.payoutService.executePayments();
    return { message: 'Execution started' };
  }

  @Post('reconcile')
  async reconcile(): Promise<{ message: string }> {
    // For simplicity we reconcile the last hour
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    await this.payoutService.reconcile({ start, end: now });
    return { message: 'Reconciliation run' };
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { BankService } from '../bank/bank.service.js';

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankService],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.scheduler.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutScheduler {
  private readonly logger = new Logger(PayoutScheduler.name);

  constructor(private readonly payoutService: PayoutService) {}

  // Runs every 15 minutes
  @Cron(CronExpression.EVERY_15_MINUTES)
  async handleReconcileCron(): Promise<void> {
    this.logger.log('Running scheduled payout reconciliation');
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60 * 1000); // look back 30 minutes to cover lag
    await this.payoutService.reconcile({ start, end: now });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly bankService: BankService,
    private readonly payoutRepo: PayoutRepository,
  ) {}

  /**
   * Deterministically derives a txid from order attributes and the effective date.
   */
  private deriveTxId(orderId: string, effectiveDate: Date): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${orderId}|${effectiveDate.toISOString()}`)
      .digest('hex')
      .substring(0, 32); // 128‑bit enough for uniqueness
    return hash;
  }

  /**
   * Executes payments for all pending orders.
   */
  async executePayments(): Promise<void> {
    const pending = await this.payoutRepo.findPendingToSend();

    for (const payout of pending) {
      const txid = this.deriveTxId(payout.orderId, payout.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplierKey,
        });
      } catch (err) {
        // Network or unexpected error – treat as transient
        this.logger.warn(
          `Bank send threw an unexpected error for payout ${payout.id}: ${err}`,
        );
        result = { outcome: 'transient_error' };
      }

      await this.handleBankSendResult(payout, txid, result);
    }
  }

  private async handleBankSendResult(
    payout: any,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.sent,
          1,
        );
        break;
      case 'duplicate':
        // Bank already has the txid – treat as success
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.sent,
          0,
        );
        break;
      case 'transient_error':
        // Outcome unknown – record attempt but keep status pending so reconciliation can decide later
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.pending,
          1,
        );
        break;
      case 'permanent_rejection':
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.failed,
          1,
        );
        break;
    }
  }

  /**
   * Reconciliation job.
   * @param window.start inclusive start date (UTC)
   * @param window.end inclusive end date (UTC)
   */
  async reconcile(window: { start: Date; end: Date }): Promise<void> {
    // 1️⃣ Pull statements for each day in the window
    const dates = this.enumerateDates(window.start, window.end);
    const settlements = new Map<string, Settlement>();
    for (const d of dates) {
      const daySettlements = await this.bankService.getStatement(d);
      for (const s of daySettlements) {
        settlements.set(s.txid, s);
      }
    }

    // 2️⃣ Mark payouts that have a matching settlement as settled
    for (const [txid, settlement] of settlements.entries()) {
      const payout = await this.payoutRepo.findByTxid(txid);
      if (payout && payout.status !== PayoutStatus.settled) {
        await this.payoutRepo.markSettled(payout.id);
        this.logger.log(
          `Payout ${payout.id} settled (txid ${txid}, amount ${settlement.amount})`,
        );
      }
    }

    // 3️⃣ For payouts awaiting evidence and past the publishing lag, decide on resend or park
    const now = new Date();
    const awaiting = await this.payoutRepo.findAwaitingEvidence(
      now,
      this.PUBLISHING_LAG_MS,
    );

    for (const payout of awaiting) {
      if (payout.txid && settlements.has(payout.txid)) {
        // Already settled – already handled above
        continue;
      }

      // Not in statement → proven absent → allowed to resend
      if (payout.attempts + 1 >= this.MAX_ATTEMPTS) {
        // Exhausted attempts – park for manual review
        await this.payoutRepo.incrementAttemptsAndMaybePark(
          payout.id,
          this.MAX_ATTEMPTS,
        );
        this.logger.warn(
          `Payout ${payout.id} attempts exhausted; parked for review`,
        );
        continue;
      }

      // Resend with the same deterministic txid
      const txid = payout.txid ?? this.deriveTxId(payout.orderId, payout.effectiveDate);
      let result: BankSendResult;
      try {
        result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplierKey,
        });
      } catch (err) {
        this.logger.warn(
          `Resend threw unexpected error for payout ${payout.id}: ${err}`,
        );
        result = { outcome: 'transient_error' };
      }

      // Handle result (same logic as initial send, but we keep status 'sent' unless duplicate)
      switch (result.outcome) {
        case 'accepted':
        case 'duplicate':
          await this.payoutRepo.incrementAttemptsAndMaybePark(
            payout.id,
            this.MAX_ATTEMPTS,
          );
          // keep status as sent (already is)
          break;
        case 'transient_error':
          await this.payoutRepo.incrementAttemptsAndMaybePark(
            payout.id,
            this.MAX_ATTEMPTS,
          );
          break;
        case 'permanent_rejection':
          // Mark as failed
          await this.payoutRepo.updateAfterSend(
            payout.id,
            txid,
            PayoutStatus.failed,
            1,
          );
          break;
      }
    }
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    cur.setUTCHours(0, 0, 0, 0);
    const finish = new Date(end);
    finish.setUTCHours(0, 0, 0, 0);
    while (cur <= finish) {
      dates.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}
```

### test/payout.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { BankService } from '../src/bank/bank.service.js';
import { PayoutStatus } from '@prisma/client';
import { vi } from 'vitest';

describe('PayoutService', () => {
  let service: PayoutService;
  let repo: PayoutRepository;
  let bank: BankService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayoutService, PayoutRepository, BankService],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
    repo = module.get<PayoutRepository>(PayoutRepository);
    bank = module.get<BankService>(BankService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not resend when timeout send later appears in statement (timeout-but-settled)', async () => {
    // Arrange: a payout that was sent once, bank returned transient_error, but later statement contains it
    const now = new Date();
    const payout = {
      id: 1,
      orderId: 'order-1',
      supplierKey: 'key-1',
      amount: 1000,
      effectiveDate: new Date(now.getTime() - 60 * 60 * 1000), // 1h ago
      txid: 'derived-txid-1',
      status: PayoutStatus.pending,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    vi.spyOn(repo, 'findPendingToSend').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'transient_error' });
    vi.spyOn(repo, 'updateAfterSend').mockImplementation(async (_, __, status) => ({
      ...payout,
      status,
      attempts: 1,
      txid: payout.txid,
    }));
    // Simulate statement later containing the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([
      { txid: 'derived-txid-1', amount: 1000, settledAt: new Date() },
    ]);
    vi.spyOn(repo, 'findByTxid').mockResolvedValue(payout);
    vi.spyOn(repo, 'markSettled').mockResolvedValue({
      ...payout,
      status: PayoutStatus.settled,
    });

    // Act
    await service.executePayments(); // first attempt (transient)
    await service.reconcile({ start: new Date(now.getTime() - 2 * 60 * 60 * 1000), end: now });

    // Assert
    expect(repo.updateAfterSend).toHaveBeenCalledWith(
      payout.id,
      payout.txid,
      PayoutStatus.pending,
      1,
    );
    expect(repo.markSettled).toHaveBeenCalledWith(payout.id);
  });

  it('re-sends when proven absent after publishing lag (proven-absent)', async () => {
    const now = new Date();
    const payout = {
      id: 2,
      orderId: 'order-2',
      supplierKey: 'key-2',
      amount: 2000,
      effectiveDate: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2h ago
      txid: 'derived-txid-2',
      status: PayoutStatus.sent,
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    };
    // No statement contains the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([]);
    vi.spyOn(repo, 'findAwaitingEvidence').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'accepted' });
    vi.spyOn(repo, 'incrementAttemptsAndMaybePark').mockImplementation(async (id) => ({
      ...payout,
      attempts: payout.attempts + 1,
    }));
    // Act
    await service.reconcile({ start: new Date(now.getTime() - 30 * 60 * 1000), end: now });

    // Assert
    expect(bank.send).toHaveBeenCalledWith({
      txid: payout.txid,
      amount: payout.amount,
      key: payout.supplierKey,
    });
    expect(repo.incrementAttemptsAndMaybePark).toHaveBeenCalledWith(payout.id, 5);
  });

  it('parks payout after attempts exhausted (attempt-exhaustion)', async () => {
    const now = new Date();
    const payout = {
      id: 3,
      orderId: 'order-3',
      supplierKey: 'key-3',
      amount: 3000,
      effectiveDate: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      txid: 'derived-txid-3',
      status: PayoutStatus.sent,
      attempts: 4, // one attempt left before hitting max 5
      createdAt: now,
      updatedAt: now,
    };
    // No statement contains the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([]);
    vi.spyOn(repo, 'findAwaitingEvidence').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'transient_error' });
    vi.spyOn(repo, 'incrementAttemptsAndMaybePark').mockImplementation(async (id, max) => {
      // Simulate reaching max attempts -> parked
      return {
        ...payout,
        attempts: payout.attempts + 1,
        status: PayoutStatus.parked,
      };
    });

    await service.reconcile({ start: new Date(now.getTime() - 30 * 60 * 1000), end: now });

    expect(repo.incrementAttemptsAndMaybePark).toHaveBeenCalledWith(payout.id, 5);
  });
});
```
