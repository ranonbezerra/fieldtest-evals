# solution

## reasoning

```
We need to create full solution: schema, modules, controller, service, repository, maybe job (reconcile scheduled). Also tests.

We need to follow conventions: layers.

We need to implement executePayments, reconcile, resend logic.

Assume bank client is external. We'll create an injectable BankService with send and getStatement.

Define models: Order (or Payout). Use table Payout with columns: id, order_id? Actually we need orders pending. Let's define payout model:

- id: Int @id @default(autoincrement())
- supplierId: Int
- amount: Int // minor units
- effectiveDate: DateTime // date for payment
- state: String // enum maybe: 'pending', 'sent', 'settled', 'failed', 'manual_review'
- txid: String? // deterministic txid
- sendAttempts: Int @default(0)
- createdAt, updatedAt timestamps
- key: String // maybe bank key
- etc.

Also need StatementEntry model? Not stored, just fetched from bank.

We'll have repository for payouts: find pending, update state, increment attempts, set txid, etc.

Service: executePayments: find payouts with state 'pending' and effectiveDate <= now? It says pending orders via bank.send. deterministic txid derived from order + effective date. We'll compute txid = `payout-${id}-${effectiveDate.toISOString().split('T')[0]}` maybe.

Call bank.send({txid, amount, key}) returns response with status. Need to classify: accepted, duplicate, transient error, permanent rejection.

We need to define response interface and classification.

On accepted: set state to 'sent' and store txid, increment attempts (maybe set to 1). On duplicate: treat as already sent, state to 'sent' maybe. On transient error: leave pending, maybe increase attempts? The resend logic: only after reconcile confirms absent from statement, we can resend. So for transient errors we may keep attempts but allow resend after reconciliation.

On permanent rejection: set state to 'failed' and no further attempts.

Reconcile(window): window is maybe { from: Date, to: Date }. We need to get statement entries for each date within window. Bank.getStatement(date) returns Settlement[] each includes txid. We'll fetch for each day in window (maybe date range) and collate txids.

Then for each payout with state not settled (maybe 'sent' or 'pending' etc) that has txid in statement, set state to 'settled'.

Also need to handle resend logic: If a payout had attempts <5, send failed/timed out (i.e., still not settled) and we have confirmed it's absent from statement beyond publishing lag. Publishing lag approx 30 min; but window param may be e.g., last 30 minutes? We'll assume window covers that lag. So after reconcile, for payouts whose state not settled and attempts <5 and not in statement, we can retry sending (i.e., call bank.send again). Need to cap at 5 attempts; after that set state to 'manual_review'.

Implementation: reconcile will first fetch statements for dates in window (bank.getStatement). Determine set of txids present.

Fetch payouts where state in ('sent','pending') and effectiveDate <= now (maybe). For each payout:

- if txid && txid in statementSet: set state = 'settled'
- else if attempts >=5: set state='manual_review'
- else if attempts <5 and (state === 'pending' or previous send attempt failed) and (txid not in statementSet): we can resend. But need to ensure we don't resend if already attempted within current window? Simpler: after reconciliation, for payouts not settled and attempts <5, we call send again via bank.send and update attempts and state accordingly (using same classification logic). This satisfies "may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag."

Thus reconcile may call a private method to attempt resend.

Implement repository methods: findPendingPayments(), findByTxids(txids), updateState(id, state), incrementAttempts(id), setTxid(id, txid), etc.

Implement controller with endpoints:

- POST /payouts/execute -> calls service.executePayments()
- POST /payouts/reconcile -> body { from: string, to: string } passes to service.reconcile(window)

Tests: We need tests for scenarios:

1. timeout-but-settled (no resend): Simulate a payout that send returns transient error (timeout), but later statement includes txid. After reconcile, state becomes settled, no resend.

2. proven-absent (resend, same txid): Simulate payout send fails (timeout), statement does not contain txid after lag, reconcile should trigger resend, with same txid. Ensure send is called again.

3. attempt exhaustion: after 5 attempts without settlement, state becomes manual_review.

We need to mock BankService and Prisma client.

Create test file test/payout.spec.ts.

Now implement files:

- prisma/schema.prisma
- src/main.ts (maybe minimal)
- src/app.module.ts
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/bank/bank.service.ts (to abstract bank API)

Also maybe DTOs.

Will implement simple.

Now write content.

Assume NestJS imports.

Let's craft code.
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

enum PayoutState {
  pending
  sent
  settled
  failed
  manual_review
}

model Payout {
  id           Int          @id @default(autoincrement())
  supplierId  Int
  amount       Int          // minor units
  effectiveDate DateTime    @map("effective_date")
  state        PayoutState  @default(pending)
  txid         String?      @unique
  sendAttempts Int          @default(0) @map("send_attempts")
  key          String
  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt @map("updated_at")

  @@map("payouts")
}
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

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule, PayoutModule],
})
export class AppModule {}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        const client = new PrismaClient();
        client.$connect();
        return client;
      },
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule {}
```

### src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankService } from './bank.service';

@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';

export type BankSendPayload = {
  txid: string;
  amount: number; // minor units
  key: string;
};

export enum BankSendResult {
  ACCEPTED = 'accepted',
  DUPLICATE = 'duplicate',
  TRANSIENT_ERROR = 'transient_error',
  PERMANENT_REJECTION = 'permanent_rejection',
}

/**
 * Simulated external bank client.
 * In production this would perform HTTP calls.
 */
@Injectable()
export class BankService {
  /**
   * Sends a payment to the bank.
   * Returns one of the BankSendResult values.
   */
  async send(payload: BankSendPayload): Promise<BankSendResult> {
    // Placeholder implementation – real implementation will call the bank API.
    // For unit tests this method will be mocked.
    return BankSendResult.ACCEPTED;
  }

  /**
   * Retrieves the settlement statement for a given date (UTC, date only).
   * Returns an array of settlements, each containing the txid that the bank
   * has settled.
   */
  async getStatement(date: Date): Promise<{ txid: string }[]> {
    // Placeholder – mocked in tests.
    return [];
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { PayoutRepository } from './payout.repository';
import { BankModule } from '../bank/bank.module';

@Module({
  imports: [BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.controller.ts
```ts
import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { ExecutePaymentsDto } from './dto/execute-payments.dto';
import { ReconcileDto } from './dto/reconcile.dto';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(@Body() _dto: ExecutePaymentsDto) {
    try {
      await this.payoutService.executePayments();
    } catch (err) {
      throw new HttpException(
        { error: { code: 'execution_failed', message: (err as Error).message, details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { success: true };
  }

  @Post('reconcile')
  async reconcile(@Body() dto: ReconcileDto) {
    try {
      await this.payoutService.reconcile(dto.from, dto.to);
    } catch (err) {
      throw new HttpException(
        { error: { code: 'reconciliation_failed', message: (err as Error).message, details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { success: true };
  }
}
```

### src/payout/dto/execute-payments.dto.ts
```ts
// Empty DTO – kept for future extensibility and validation pipeline
export class ExecutePaymentsDto {}
```

### src/payout/dto/reconcile.dto.ts
```ts
import { IsISO8601 } from 'class-validator';

export class ReconcileDto {
  @IsISO8601()
  from: string; // ISO date string (e.g., "2024-09-01")

  @IsISO8601()
  to: string;   // ISO date string
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutState } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPendingPayments(): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: { state: PayoutState.pending },
    });
  }

  async findPaymentsNeedingResend(maxAttempts: number): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: {
        state: { in: [PayoutState.pending, PayoutState.sent] },
        sendAttempts: { lt: maxAttempts },
        txid: { not: null },
      },
    });
  }

  async findByTxids(txids: string[]): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: { txid: { in: txids } },
    });
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state },
    });
  }

  async incrementAttempts(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { sendAttempts: { increment: 1 } },
    });
  }

  async setTxid(id: number, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }

  async markManualReview(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state: PayoutState.manual_review },
    });
  }

  async markSettled(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state: PayoutState.settled },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { BankService, BankSendResult } from '../bank/bank.service';
import { PayoutState } from '@prisma/client';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  /**
   * Sends all pending payouts to the bank.
   * The txid is deterministic based on payout id and effective date.
   */
  async executePayments(): Promise<void> {
    const pending = await this.repository.findPendingPayments();

    for (const payout of pending) {
      const txid = this.computeTxId(payout.id, payout.effectiveDate);
      await this.repository.setTxid(payout.id, txid);
      await this.handleSendResult(payout.id, txid, payout.amount, payout.key);
    }
  }

  /**
   * Reconcile payouts for a given date window.
   * The window is inclusive of the `from` and `to` dates (UTC dates).
   */
  async reconcile(fromIso: string, toIso: string): Promise<void> {
    const from = new Date(fromIso);
    const to = new Date(toIso);

    // 1. Pull statements for each day in the window
    const statementTxids = new Set<string>();
    for (
      let d = new Date(from);
      d <= to;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const day = new Date(d);
      const settlements = await this.bankService.getStatement(day);
      for (const s of settlements) {
        statementTxids.add(s.txid);
      }
    }

    // 2. Mark settled payouts
    const payoutsWithTx = await this.repository.findByTxids(Array.from(statementTxids));
    for (const payout of payoutsWithTx) {
      if (payout.state !== PayoutState.settled) {
        await this.repository.markSettled(payout.id);
        this.logger.log(`Payout ${payout.id} settled.`);
      }
    }

    // 3. Handle resends for payouts not yet settled
    const candidates = await this.repository.findPaymentsNeedingResend(PayoutService.MAX_ATTEMPTS);
    for (const payout of candidates) {
      const alreadySettled = payout.txid && statementTxids.has(payout.txid);
      if (alreadySettled) {
        // already settled in step 2 – nothing else to do
        continue;
      }

      if (payout.sendAttempts >= PayoutService.MAX_ATTEMPTS) {
        await this.repository.markManualReview(payout.id);
        this.logger.warn(`Payout ${payout.id} reached max attempts, moved to manual review.`);
        continue;
      }

      // Resend – use the same deterministic txid
      const txid = payout.txid ?? this.computeTxId(payout.id, payout.effectiveDate);
      if (!payout.txid) {
        await this.repository.setTxid(payout.id, txid);
      }
      await this.handleSendResult(payout.id, txid, payout.amount, payout.key);
    }
  }

  /**
   * Helper to compute deterministic txid.
   */
  private computeTxId(id: number, effectiveDate: Date): string {
    const datePart = effectiveDate.toISOString().split('T')[0]; // YYYY-MM-DD
    return `payout-${id}-${datePart}`;
  }

  /**
   * Sends a single payout and updates state/attempt counters based on bank response.
   */
  private async handleSendResult(
    payoutId: number,
    txid: string,
    amount: number,
    key: string,
  ): Promise<void> {
    const result = await this.bankService.send({ txid, amount, key });

    switch (result) {
      case BankSendResult.ACCEPTED:
        await this.repository.updateState(payoutId, PayoutState.sent);
        await this.repository.incrementAttempts(payoutId);
        this.logger.log(`Payout ${payoutId} accepted by bank.`);
        break;
      case BankSendResult.DUPLICATE:
        // Treat duplicate as already sent
        await this.repository.updateState(payoutId, PayoutState.sent);
        this.logger.log(`Payout ${payoutId} duplicate – marked as sent.`);
        break;
      case BankSendResult.TRANSIENT_ERROR:
        // Do not change state, just increment attempts (allow future resend)
        await this.repository.incrementAttempts(payoutId);
        this.logger.warn(`Payout ${payoutId} transient error – will retry after reconciliation.`);
        break;
      case BankSendResult.PERMANENT_REJECTION:
        await this.repository.updateState(payoutId, PayoutState.failed);
        await this.repository.incrementAttempts(payoutId);
        this.logger.error(`Payout ${payoutId} permanently rejected.`);
        break;
      default:
        // ASSUMPTION: Unexpected enum value – treat as transient
        await this.repository.incrementAttempts(payoutId);
        this.logger.warn(`Payout ${payoutId} unknown bank result – treated as transient.`);
        break;
    }
  }
}
```

### test/payout.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { BankService, BankSendResult } from '../src/bank/bank.service';
import { PrismaClient, PayoutState } from '@prisma/client';
import { jest } from '@jest/globals';

describe('PayoutService Integration Tests', () => {
  let service: PayoutService;
  let repository: PayoutRepository;
  let bankService: BankService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Use an in‑memory SQLite for tests (Prisma supports it) – but as we cannot
    // spin up a DB here, we will mock the repository methods directly.
    // The repository will be mocked; we only need to verify service behaviour.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutService,
        {
          provide: PayoutRepository,
          useValue: {
            findPendingPayments: jest.fn(),
            findPaymentsNeedingResend: jest.fn(),
            findByTxids: jest.fn(),
            updateState: jest.fn(),
            incrementAttempts: jest.fn(),
            setTxid: jest.fn(),
            markManualReview: jest.fn(),
            markSettled: jest.fn(),
          },
        },
        {
          provide: BankService,
          useValue: {
            send: jest.fn(),
            getStatement: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
    repository = module.get<PayoutRepository>(PayoutRepository);
    bankService = module.get<BankService>(BankService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Scenario 1: timeout-but-settled (no resend)
   * - executePayments sends and gets a transient error.
   * - reconcile later finds the txid in statement, marks as settled.
   * - No additional resend attempt occurs.
   */
  it('should handle timeout then settlement without resend', async () => {
    const payout = {
      id: 1,
      amount: 1000,
      key: 'bank-key',
      effectiveDate: new Date('2024-09-01T00:00:00Z'),
      txid: null,
      state: PayoutState.pending,
      sendAttempts: 0,
    };

    (repository.findPendingPayments as jest.Mock).mockResolvedValue([payout]);
    (bankService.send as jest.Mock).mockResolvedValue(BankSendResult.TRANSIENT_ERROR);
    (repository.findPaymentsNeedingResend as jest.Mock).mockResolvedValue([]);
    (repository.findByTxids as jest.Mock).mockResolvedValue([payout]);

    // Execute payments – should record txid and attempt, state becomes sent
    await service.executePayments();

    const expectedTxid = `payout-${payout.id}-2024-09-01`;
    expect(repository.setTxid).toHaveBeenCalledWith(payout.id, expectedTxid);
    expect(bankService.send).toHaveBeenCalledWith({ txid: expectedTxid, amount: payout.amount, key: payout.key });
    expect(repository.updateState).toHaveBeenCalledWith(payout.id, PayoutState.sent);
    expect(repository.incrementAttempts).toHaveBeenCalledWith(payout.id);

    // Reconcile – statement includes txid, payout should be marked settled
    (bankService.getStatement as jest.Mock).mockResolvedValue([{ txid: expectedTxid }]);
    await service.reconcile('2024-09-01', '2024-09-01');

    expect(repository.markSettled).toHaveBeenCalledWith(payout.id);
    // No resend should happen
    expect(bankService.send).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario 2: proven-absent (resend, same txid)
   * - executePayments gets transient error.
   * - reconcile finds txid absent, triggers resend.
   * - resend gets accepted.
   */
  it('should resend payment when absent from statement', async () => {
    const payout = {
      id: 2,
      amount: 2000,
      key: 'bank-key',
      effectiveDate: new Date('2024-09-02T00:00:00Z'),
      txid: null,
      state: PayoutState.pending,
      sendAttempts: 0,
    };

    (repository.findPendingPayments as jest.Mock).mockResolvedValue([payout]);
    (bankService.send as jest.Mock).mockResolvedValueOnce(BankSendResult.TRANSIENT_ERROR) // first send
      .mockResolvedValueOnce(BankSendResult.ACCEPTED); // resend

    // After first send, repository state will be updated – we mock those calls
    await service.executePayments();

    const txid = `payout-${payout.id}-2024-09-02`;
    expect(repository.setTxid).toHaveBeenCalledWith(payout.id, txid);
    expect(bankService.send).toHaveBeenNthCalledWith(1, { txid, amount: payout.amount, key: payout.key });
    expect(repository.updateState).toHaveBeenCalledWith(payout.id, PayoutState.sent);
    expect(repository.incrementAttempts).toHaveBeenCalledTimes(1);

    // Reconcile – statement empty for that date
    (bankService.getStatement as jest.Mock).mockResolvedValue([]);
    (repository.findPaymentsNeedingResend as jest.Mock).mockResolvedValue([{
      ...payout,
      txid,
      state: PayoutState.sent,
      sendAttempts: 1,
    }]);

    await service.reconcile('2024-09-02', '2024-09-02');

    // Resend should be invoked
    expect(bankService.send).toHaveBeenNthCalledWith(2, { txid, amount: payout.amount, key: payout.key });
    // State should be set to sent again (duplicate handling)
    expect(repository.updateState).toHaveBeenCalledWith(payout.id, PayoutState.sent);
    expect(repository.incrementAttempts).toHaveBeenCalledTimes(2);
  });

  /**
   * Scenario 3: attempt exhaustion
   * - After 5 attempts without settlement, payout moves to manual_review.
   */
  it('should move payout to manual_review after max attempts', async () => {
    const payout = {
      id: 3,
      amount: 3000,
      key: 'bank-key',
      effectiveDate: new Date('2024-09-03T00:00:00Z'),
      txid: `payout-3-2024-09-03`,
      state: PayoutState.sent,
      sendAttempts: 5,
    };

    // No pending payments to send
    (repository.findPendingPayments as jest.Mock).mockResolvedValue([]);
    // Reconcile will find it as candidate for resend
    (repository.findPaymentsNeedingResend as jest.Mock).mockResolvedValue([payout]);
    (bankService.getStatement as jest.Mock).mockResolvedValue([]); // txid absent

    await service.reconcile('2024-09-03', '2024-09-03');

    // Should be marked for manual review and no further send attempt
    expect(repository.markManualReview).toHaveBeenCalledWith(payout.id);
    expect(bankService.send).not.toHaveBeenCalled();
  });
});
```
