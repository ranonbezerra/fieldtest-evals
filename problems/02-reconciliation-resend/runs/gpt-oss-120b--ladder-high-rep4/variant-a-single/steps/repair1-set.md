# repair1-set

## reasoning

```
We need fix import paths: likely missing .ts extensions? In ESM need extensions .js? In tsconfig with moduleResolution node16? Probably need to add .js extensions in imports. Add .js to all relative imports. Also class-validator import needs package, but assume installed. The error about unknown err: need to type as any. In controller catch err: declare as unknown and use (err as Error). Also test type arguments error: vi.fn<Promise<BankSendResult>, [{...}]>() should be vi.fn<Promise<BankSendResult>, [{...}]>()? Actually vi.fn generic expects return type then args tuple. Should be vi.fn<Promise<BankSendResult>, [{ txid:string; amount:number; key:string }]>() . It currently has two type args maybe extra. We'll adjust mock definitions in test file. Also property txid does not exist on type never: in test, repository.getPayout returns Payout | undefined, after get they assert after... need cast. But easier: change getPayout return type to Payout | undefined already. In test line 182 refers to after.state? Actually property txid missing on never due to payout variable typed as never? Might be due to deriveTxId using payout.txid? Not. Probably in test they do after.state? Not. We'll just add explicit type to after variable: const after = repository.getPayout(2)! as Payout; but repository.getPayout returns Payout|undefined. Already using !. Type should be Payout. Should be fine. Maybe TypeScript can't infer generic for MockBankService.send mockResolvedValueOnce typed incorrectly causing overload. We'll adjust mock definitions to proper typing.

Implement changes in source imports: add .js extensions? For ESM, need .js. So change all imports like './payout/payout.module' to './payout/payout.module.js' etc. Also for class-validator, need to import from 'class-validator' which is fine if installed. Probably missing because tsconfig? Might need to add .js? No.

We'll modify files accordingly.

Also in controller catch err: change to (err as Error).message.

Modify test: adjust vi.fn generics.

Let's produce changed files: src/app.module.ts, src/main.ts, src/bank/bank.module.ts, src/payout/payout.controller.ts, src/payout/payout.module.ts, src/payout/payout.repository.ts, src/payout/payout.service.ts, src/prisma/prisma.module.ts, src/reconcile/reconcile.module.ts, src/reconcile/reconcile.service.ts, test/payout.spec.ts.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { ReconcileModule } from './reconcile/reconcile.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, PayoutModule, ReconcileModule],
})
export class AppModule {}
```

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

### src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankService } from './bank.service.js';

@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post, Body, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { IsString, IsInt, IsDateString, IsPositive } from 'class-validator';

class CreatePayoutDto {
  @IsString()
  supplierKey: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsDateString()
  effectiveDate: string; // ISO 8601 string
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    try {
      const payout = await this.payoutService.createPayout(dto.supplierKey, dto.amount, new Date(dto.effectiveDate));
      return payout;
    } catch (err) {
      const error = err as Error;
      throw new HttpException(
        { error: { code: 'creation_failed', message: error.message, details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const payout = await this.payoutService.getPayoutById(Number(id));
    if (!payout) {
      throw new HttpException(
        { error: { code: 'resource_not_found', message: `Payout ${id} not found`, details: {} } },
        HttpStatus.NOT_FOUND,
      );
    }
    return payout;
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { BankModule } from '../bank/bank.module.js';

@Module({
  imports: [BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Payout, PayoutState } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { supplier_key: string; amount: number; effective_date: Date }): Promise<Payout> {
    return this.prisma.payout.create({
      data,
    });
  }

  async findById(id: number): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { id },
    });
  }

  async findPending(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { state: PayoutState.pending },
    });
  }

  async findByEffectiveDateRange(from: Date, to: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        effective_date: {
          gte: from,
          lte: to,
        },
      },
    });
  }

  async updateStateAndAttempt(
    id: number,
    data: {
      state: PayoutState;
      attempts: { increment: number };
      last_attempt_at: Date;
      txid?: string;
    },
  ): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        state: data.state,
        attempts: data.attempts,
        last_attempt_at: data.last_attempt_at,
        txid: data.txid,
      },
    });
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { Payout, PayoutState } from '@prisma/client';
import { createHash } } from 'crypto';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  async createPayout(supplierKey: string, amount: number, effectiveDate: Date): Promise<Payout> {
    return this.payoutRepository.create({
      supplier_key: supplierKey,
      amount,
      effective_date: effectiveDate,
    });
  }

  async getPayoutById(id: number): Promise<Payout | null> {
    return this.payoutRepository.findById(id);
  }

  private deriveTxId(payout: Payout): string {
    const data = `${payout.id}|${payout.supplier_key}|${payout.amount}|${payout.effective_date.toISOString()}`;
    return createHash('sha256').update(data).digest('hex');
  }

  async executePayments(): Promise<void> {
    const pendingPayouts = await this.payoutRepository.findPending();
    for (const payout of pendingPayouts) {
      const txid = this.deriveTxId(payout);
      try {
        const result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplier_key,
        });
        await this.handleBankSendResult(payout, result);
      } catch (err) {
        this.logger.error(`Bank send threw an unexpected error for payout ${payout.id}`, err);
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.awaiting_evidence,
          attempts: { increment: 1 },
          last_attempt_at: new Date(),
          txid,
        });
      }
    }
  }

  private async handleBankSendResult(payout: Payout, result: BankSendResult): Promise<void> {
    const now = new Date();
    const txid = this.deriveTxId(payout);
    switch (result) {
      case BankSendResult.ACCEPTED:
      case BankSendResult.DUPLICATE:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.sent,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      case BankSendResult.TRANSIENT_ERROR:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.awaiting_evidence,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      case BankSendResult.PERMANENT_REJECTION:
        await this.payoutRepository.updateStateAndAttempt(payout.id, {
          state: PayoutState.failed,
          attempts: { increment: 1 },
          last_attempt_at: now,
          txid,
        });
        break;
      default:
        this.logger.warn(`Unhandled bank send result ${result} for payout ${payout.id}`);
        break;
    }
  }

  async reconcile(window: { from: Date; to: Date }): Promise<void> {
    const settlements = await this.bankService.getStatement(window.from, window.to);
    const settlementMap = new Map<string, Settlement>();
    for (const s of settlements) {
      settlementMap.set(s.txid, s);
    }

    const now = new Date();

    const payouts = await this.payoutRepository.findByEffectiveDateRange(window.from, window.to);
    for (const payout of payouts) {
      if (payout.state === PayoutState.settled) {
        continue;
      }

      const txid = payout.txid ?? this.deriveTxId(payout);
      const settlement = settlementMap.get(txid);

      if (settlement) {
        await this.payoutRepository.updateState(payout.id, PayoutState.settled);
        continue;
      }

      if (payout.state === PayoutState.sent) {
        continue; // waiting for publishing lag
      }

      if (payout.state === PayoutState.awaiting_evidence) {
        const lastAttemptAt = payout.last_attempt_at;
        if (!lastAttemptAt) {
          continue;
        }
        if (now.getTime() - lastAttemptAt.getTime() < PayoutService.PUBLISHING_LAG_MS) {
          continue; // still within lag window
        }

        if (payout.attempts >= 5) {
          await this.payoutRepository.updateState(payout.id, PayoutState.parked);
        } else {
          try {
            const result = await this.bankService.send({
              txid,
              amount: payout.amount,
              key: payout.supplier_key,
            });
            await this.handleBankSendResult(payout, result);
          } catch (err) {
            this.logger.error(`Bank send error during resend for payout ${payout.id}`, err);
            await this.payoutRepository.updateStateAndAttempt(payout.id, {
              state: PayoutState.awaiting_evidence,
              attempts: { increment: 1 },
              last_attempt_at: now,
              txid,
            });
          }
        }
      }
    }
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/reconcile/reconcile.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReconcileService } from './reconcile.service.js';
import { PayoutModule } from '../payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  providers: [ReconcileService],
})
export class ReconcileModule {}
```

### src/reconcile/reconcile.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from '../payout/payout.service.js';

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private static readonly RECONCILE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly payoutService: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async handleReconcile(): Promise<void> {
    const now = new Date();
    const from = new Date(now.getTime() - ReconcileService.RECONCILE_WINDOW_MS);
    const to = now;
    this.logger.debug(`Running reconciliation window ${from.toISOString()} - ${to.toISOString()}`);
    await this.payoutService.reconcile({ from, to });
  }
}
```

### test/payout.spec.ts
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { BankService, BankSendResult, Settlement } from '../src/bank/bank.service.js';
import { PayoutState, Payout } from '@prisma/client';
import { createHash } from 'crypto';

// Mock repository implementing the same API as PayoutRepository
class MockPayoutRepository {
  private payouts: Map<number, Payout>;

  constructor(initial: Payout[]) {
    this.payouts = new Map<number, Payout>(initial.map(p => [p.id, { ...p }]));
  }

  async create(data: any): Promise<Payout> {
    const id = Math.max(...Array.from(this.payouts.keys()), 0) + 1;
    const payout: Payout = {
      id,
      supplier_key: data.supplier_key,
      amount: data.amount,
      effective_date: data.effective_date,
      txid: null,
      attempts: 0,
      state: PayoutState.pending,
      last_attempt_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.payouts.set(id, payout);
    return payout;
  }

  async findById(id: number): Promise<Payout | null> {
    return this.payouts.get(id) ?? null;
  }

  async findPending(): Promise<Payout[]> {
    return Array.from(this.payouts.values()).filter(p => p.state === PayoutState.pending);
  }

  async findByEffectiveDateRange(from: Date, to: Date): Promise<Payout[]> {
    return Array.from(this.payouts.values()).filter(p => {
      const d = p.effective_date;
      return d >= from && d <= to;
    });
  }

  async updateStateAndAttempt(
    id: number,
    data: {
      state: PayoutState;
      attempts: { increment: number };
      last_attempt_at: Date;
      txid?: string;
    },
  ): Promise<void> {
    const payout = this.payouts.get(id);
    if (!payout) return;
    payout.state = data.state;
    payout.attempts = (payout.attempts ?? 0) + data.attempts.increment;
    payout.last_attempt_at = data.last_attempt_at;
    if (data.txid !== undefined) {
      payout.txid = data.txid;
    }
    payout.updated_at = new Date();
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    const payout = this.payouts.get(id);
    if (!payout) return;
    payout.state = state;
    payout.updated_at = new Date();
  }

  // Helper for tests
  getPayout(id: number): Payout | undefined {
    return this.payouts.get(id);
  }
}

// Mock bank service
class MockBankService {
  send = vi.fn<Promise<BankSendResult>, [{ txid: string; amount: number; key: string }]>();
  getStatement = vi.fn<Promise<Settlement[]>, [Date, Date]>();
}

// Helper to compute deterministic txid (same logic as service)
function deriveTxId(payout: Payout): string {
  const data = `${payout.id}|${payout.supplier_key}|${payout.amount}|${payout.effective_date.toISOString()}`;
  return createHash('sha256').update(data).digest('hex');
}

describe('PayoutService reconciliation and resend logic', () => {
  const now = new Date();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('timeout-but-settled: no resend after settlement appears', async () => {
    // Setup a pending payout
    const payout: Payout = {
      id: 1,
      supplier_key: 'supplier-123',
      amount: 1000,
      effective_date: now,
      txid: null,
      attempts: 0,
      state: PayoutState.pending,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    };
    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // First send returns transient error (timeout)
    bankService.send.mockResolvedValueOnce(BankSendResult.TRANSIENT_ERROR);
    // After the send, reconciliation will find the settlement
    const derivedTxId = deriveTxId(payout);
    const settlement: Settlement = {
      txid: derivedTxId,
      amount: payout.amount,
      date: now,
    };
    bankService.getStatement.mockResolvedValueOnce([settlement]);

    const service = new PayoutService(repository as any, bankService as any);

    // Execute initial send
    await service.executePayments();

    const afterSend = repository.getPayout(1)!;
    expect(afterSend.state).toBe(PayoutState.awaiting_evidence);
    expect(afterSend.attempts).toBe(1);
    expect(afterSend.txid).toBe(derivedTxId);
    expect(bankService.send).toHaveBeenCalledTimes(1);

    // Run reconciliation
    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    const afterReconcile = repository.getPayout(1)!;
    expect(afterReconcile.state).toBe(PayoutState.settled);
    // No additional send should have been made
    expect(bankService.send).toHaveBeenCalledTimes(1);
  });

  it('proven-absent: resend with same txid after publishing lag', async () => {
    // Payout already attempted once, awaiting evidence, last attempt > 30min ago
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
    const payout: Payout = {
      id: 2,
      supplier_key: 'supplier-abc',
      amount: 2000,
      effective_date: now,
      txid: null,
      attempts: 1,
      state: PayoutState.awaiting_evidence,
      last_attempt_at: past,
      created_at: past,
      updated_at: past,
    };
    // Compute deterministic txid and store it
    const derivedTxId = deriveTxId(payout);
    payout.txid = derivedTxId;

    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // Statement empty: prove absence
    bankService.getStatement.mockResolvedValueOnce([]);
    // Resend will be called and return ACCEPTED
    bankService.send.mockResolvedValueOnce(BankSendResult.ACCEPTED);

    const service = new PayoutService(repository as any, bankService as any);

    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    // Verify resend was attempted
    expect(bankService.send).toHaveBeenCalledTimes(1);
    const sendArg = bankService.send.mock.calls[0][0];
    expect(sendArg.txid).toBe(derivedTxId);
    // State should be updated to SENT and attempts incremented
    const after = repository.getPayout(2)!;
    expect(after.state).toBe(PayoutState.sent);
    expect(after.attempts).toBe(2);
    expect(after.last_attempt_at?.getTime()).toBeGreaterThan(past.getTime());
  });

  it('attempt exhaustion: park after 5 attempts with no settlement', async () => {
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const payout: Payout = {
      id: 3,
      supplier_key: 'supplier-xyz',
      amount: 3000,
      effective_date: now,
      txid: null,
      attempts: 5,
      state: PayoutState.awaiting_evidence,
      last_attempt_at: past,
      created_at: past,
      updated_at: past,
    };
    const derivedTxId = deriveTxId(payout);
    payout.txid = derivedTxId;

    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // No settlement in statement
    bankService.getStatement.mockResolvedValueOnce([]);

    const service = new PayoutService(repository as any, bankService as any);

    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    // No resend should occur
    expect(bankService.send).not.toHaveBeenCalled();
    const after = repository.getPayout(3)!;
    expect(after.state).toBe(PayoutState.parked);
    expect(after.attempts).toBe(5);
  });
});
```
