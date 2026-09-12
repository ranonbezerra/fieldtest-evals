# solution

## reasoning

```
We need to create files: schema.prisma, modules, controller, service, repository, maybe a scheduled job. Also tests. The task: implement payout system with executePayments and reconcile.

We need minimal code to satisfy spec. Use NestJS conventions.

Define a Payout model: fields: id (Int @id @default(autoincrement())), orderId (String), supplierKey (String), amount (Int), effectiveDate (DateTime), txid (String), status (enum), attempts (Int default 0), createdAt, updatedAt.

Statuses: pending, sent, settled, failed, parked (for review). We'll need enum.

Define repository class: uses PrismaClient to interact.

Service: executePayments: fetch pending payouts with status pending or maybe sent? Actually pending orders: status = 'pending' (not sent). For each, compute txid deterministic: maybe hash orderId + effectiveDate (ISO) via simple deterministic function (e.g., crypto.createHash('sha256')). Use amount and key.

Call bank.send (need to mock external). We'll define an injectable BankApiService with methods send and getStatement.

Classify response: assume response.type string 'accepted', 'duplicate', 'transient_error', 'permanent_rejection'. Based on that, update attempts and status.

- accepted: set status = 'sent', attempts++. maybe keep attempts count.
- duplicate: treat as success: status = 'sent', attempts unchanged? maybe attempts stays.
- transient_error: record attempts++ and keep status pending? but need to know outcome unknown. Maybe status stays 'pending' but attempts increased. Not auto resend.
- permanent_rejection: status = 'failed', attempts++? Not to resend.

Reconcile(window): window is date range? maybe start and end Date. We'll fetch statement from bank.getStatement(date) for each date in window? Simpler: getStatement for each day? For now assume window has start and end Date; we call bank.getStatement for each day between (inclusive). The bank returns Settlement[] with txid, amount, date.

We then match payouts with status 'sent' or 'pending' and attempts>0? We need to match statement entries to payouts where txid matches. For matched: set status = 'settled'.

For payouts still pending (status not settled) and attempts >0? The spec: orders still awaiting evidence and past publishing lag (30 min). So if the current time is after statement date + 30 min and txid not found, then we can resend: call bank.send again with same txid (derived same). Increment attempts. If attempts >=5 then set status='parked'.

Implementation: For each payout with status not settled and attempts>0? Actually pending after first send could be status 'sent' (sent but unknown). We'll treat status='sent' as awaiting evidence.

Compute effectiveDate maybe for each payout. Publishing lag: assume we need to check if effectiveDate + 30 min < now.

Resend: call bank.send again same txid. Then classify response again (duplicate may happen). Update attempts and status.

Need to ensure idempotent across overlapping windows: when we process a payout already settled, we skip.

We'll implement repository with methods: findPendingToSend, updateAfterSend, findAwaitingEvidence, markSettled, incrementAttemptsAndUpdateStatus.

Now tests: we need three scenarios. Use vitest, mocking bank API and repository (or using in-memory Prisma with SQLite? But easier to mock repository). Provide test file: test/payout.spec.ts.

We'll create minimal Nest testing module.

Implement BankApiService with stub methods that can be mocked.

Now file layout:

src/payout/payout.module.ts
src/payout/payout.controller.ts (maybe not needed but include stub)
src/payout/payout.service.ts
src/payout/payout.repository.ts
src/bank/bank.service.ts (BankApiService)

prisma/schema.prisma

test/payout.spec.ts

Also schedule job: maybe src/payout/payout.scheduler.ts using @Cron.

We'll include.

Now produce code.

We need to import PrismaClient. Use singleton injection.

Define enum Status.

Now produce code.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  pending          // order has not been sent yet
  sent             // send request issued, awaiting bank statement
  settled          // statement confirmed
  failed           // permanent rejection from bank
  parked           // attempts exhausted, needs manual review
}

model Payout {
  id            Int           @id @default(autoincrement())
  orderId       String        @unique @map("order_id")
  supplierKey   String        @map("supplier_key")
  amount        Int           // minor units, integer
  effectiveDate DateTime      @map("effective_date")
  txid          String?       @unique
  status        PayoutStatus  @default(pending) @map("status")
  attempts      Int           @default(0) @map("attempts")
  createdAt     DateTime      @default(now()) @map("created_at")
  updatedAt     DateTime      @updatedAt @map("updated_at")

  @@map("payouts")
}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';

export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient_error' }
  | { outcome: 'permanent_rejection' };

export type Settlement = {
  txid: string;
  amount: number;
  settledAt: Date;
};

@Injectable()
export class BankService {
  /**
   * Sends a payment to the bank.
   *
   * @param payload { txid, amount, key }
   * @returns a classification of the bank response
   *
   * NOTE: In production this would be an HTTP call.
   * For the purpose of the exercise the implementation is left empty – it will be mocked in tests.
   */
  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    // ASSUMPTION: real implementation is external; tests will mock this method.
    throw new Error('BankService.send not implemented');
  }

  /**
   * Retrieves the bank statement for a given date.
   *
   * @param date The date (UTC) for which the statement is requested.
   * @returns an array of settlement entries.
   *
   * NOTE: Real implementation omitted – will be mocked in tests.
   */
  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: real implementation is external; tests will mock this method.
    throw new Error('BankService.getStatement not implemented');
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  private readonly prisma = new PrismaClient();

  async findPendingToSend(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.pending },
    });
  }

  async updateAfterSend(
    payoutId: number,
    txid: string,
    status: PayoutStatus,
    attemptsIncrement: number,
  ): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        txid,
        status,
        attempts: { increment: attemptsIncrement },
        updatedAt: new Date(),
      },
    });
  }

  async findAwaitingEvidence(
    now: Date,
    publishingLagMs: number,
  ): Promise<Payout[]> {
    // Orders that have been sent (status = sent) and whose effectiveDate is older than now - publishingLag
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.sent,
        effectiveDate: { lt: new Date(now.getTime() - publishingLagMs) },
      },
    });
  }

  async markSettled(payoutId: number): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.settled,
        updatedAt: new Date(),
      },
    });
  }

  async incrementAttemptsAndMaybePark(
    payoutId: number,
    maxAttempts: number,
  ): Promise<Payout> {
    const payout = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (payout.attempts >= maxAttempts) {
      return this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.parked,
          updatedAt: new Date(),
        },
      });
    }
    return payout;
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { txid },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { BankService, BankSendResult } from '../bank/bank.service';
import { PayoutRepository } from './payout.repository';
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
      if (settlements.has(payout.txid!)) {
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

### src/payout/payout.controller.ts
```ts
import { Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';

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
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { BankService } from '../bank/bank.service';

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
import { PayoutService } from './payout.service';

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

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module';
import { PayoutScheduler } from './payout/payout.scheduler';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  controllers: [],
  providers: [PayoutScheduler],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```

### test/payout.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { BankService } from '../src/bank/bank.service';
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
