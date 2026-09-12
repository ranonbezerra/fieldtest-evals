# solution

## reasoning

```
We need to construct a full solution with schema, modules, controller, service, repository, and tests.

We need to implement:

- Prisma schema with tables for orders (payouts) and maybe attempts, and bank statements (settlements) might be stored? Actually we might not store statements, just fetch from bank API.

Define model Payout (order) with fields: id, supplierId?, amount (int), effectiveDate (date), txid (string) derived, status (enum), attempts (int), createdAt, updatedAt.

Statuses: pending, sent, settled, failed, parked (manual review). Also maybe "awaiting_evidence" for transient.

We need repository: class PayoutRepository with methods to find pending payouts, update status, increment attempts, find by txid, etc.

Service: PayoutService with executePayments() and reconcile(window). Need to inject repository and bank client.

Bank client: need to create interface; can be a simple class with send and getStatement. We'll mock in tests.

We need to schedule reconcile job: maybe create a provider with @Injectable and method run; but not essential for tests.

Controller: maybe expose endpoints but not required for tests; but per conventions, we need controller that validates input and calls service.

But task only demands schema, service, reconcile job, tests.

We'll create module payout.module.ts that provides service, repository, and controller.

Implement txid deterministic: maybe using SHA256 of `${order.id}-${effectiveDate}`.

Implement executePayments: find payouts with status 'pending' and attempts <5, derive txid, call bank.send, handle response classification:

- accepted: update status to 'sent', record attempts increment? maybe attempts incremented anyway.

- duplicate: treat as success (same as accepted): status 'sent'.

- transient error: record attempts increment, keep status 'awaiting_evidence' (or keep pending but attempts increment). The spec: outcome unknown; we record that and wait for evidence; attempts counted? The spec says attempts cap 5, after that parked. So we should increment attempts on each attempt (including transient) and maybe keep status 'awaiting_evidence'.

- permanent rejection: set status 'failed' maybe; no further attempts.

We need to ensure resend only after reconcile proves absence past publishing lag. So reconcile will fetch statement for a date window (maybe start and end), find settlements entries (with txid). For each payout in status 'sent' or 'awaiting_evidence' (maybe 'sent' means we already sent but not settled), we check if its txid appears in statement. If appears, set status 'settled'. If not appears and the statement date is older than publishing lag (30 min) past the effective date? The window param likely provides startDate and endDate, and we assume we are reconciling over that window. We'll implement that logic: for each payout whose effectiveDate within window and status is 'awaiting_evidence' (or 'sent'), if not found in statement and current time is > effectiveDate + 30 minutes, then we can resend: increment attempts, if attempts >=5 then set status 'parked', else re-send using same txid (call bank.send again). The resend uses same txid (derived, same). Handle response again same classification; but likely after resend we treat as same as executePayments.

Need to ensure idempotent across overlapping windows: when we process a payout that is already settled, we skip. When we have already resent (maybe status updated), we ensure not to resend again incorrectly.

Implementation details:

- enum PayoutStatus { Pending, Sent, Settled, Failed, Parked, AwaitingEvidence } maybe combine Sent and AwaitingEvidence.

Simplify: statuses: PENDING, SENT, SETTLED, FAILED, PARKED.

When we send, we set status to SENT (or keep if already SENT). For transient error, we keep status SENT but attempts increment. For permanent rejection, set FAILED.

Reconcile will consider payouts with status SENT and attempts <5 (or regardless) and effectiveDate within window. For each, check statement entries via bank.getStatement(dateRange?) The spec says getStatement(date) returns settlements for that date; we might call for each day in window.

Simplify: bank.getStatement(date) returns array of settlements for that date. We'll call for each date in the window (inclusive) and aggregate.

Settlement interface: { txid: string, amount: number, date: Date }.

We need to implement repository method findSentPayoutsInWindow(start: Date, end: Date).

Implementation.

Tests: Use Vitest, mocking bank client. Need to test three scenarios:

1. Timeout but settled: send returns transient error; later reconcile finds txid in statement; after reconcile, payout status is SETTLED; no resend.

2. Proven absent: send returns transient error; reconcile runs after lag and does not find txid; service resends (same txid) and attempts increment; after resend, status remains SENT; maybe we also test that txid same.

3. Attempts exhausted: after 5 attempts (all transient errors and absent), reconcile should set status PARKED and not resend further.

We'll need to simulate time: maybe using jest fake timers or just set dates manually.

Simplify: In tests, we will directly invoke executePayments then reconcile with window covering effectiveDate.

We need to provide a mock bank client with methods send and getStatement that we can control.

We'll need to register provider in testing module.

We must respect layering: controller (not used in tests) no DB calls; service no Prisma client calls; repository touches Prisma client.

Thus repository will import PrismaClient and have methods.

Implement Prisma schema:

model Payout {
  id          String   @id @default(uuid())
  supplierKey String // maybe key for bank
  amount      Int
  effectiveDate DateTime
  txid        String? @unique
  status      PayoutStatus @default(PENDING)
  attempts    Int @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum PayoutStatus {
  PENDING
  SENT
  SETTLED
  FAILED
  PARKED
}

Make txid unique.

Now files:

- prisma/schema.prisma
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/bank/bank.service.ts (client)
- src/main.ts (maybe not needed)
- test/payout.service.spec.ts

We'll also need DTO for executePayments? Not needed.

Controller maybe have POST /payouts/execute and POST /payouts/reconcile with body window (start,end). We'll implement minimal.

Now produce code.

We'll write module imports.

Assume NestJS typical imports.

Implement BankService with stub methods; we will inject it.

Now write code.
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
  PENDING
  SENT
  SETTLED
  FAILED
  PARKED
}

model Payout {
  id            String        @id @default(uuid())
  supplierKey   String
  amount        Int
  effectiveDate DateTime
  txid          String?       @unique
  status        PayoutStatus  @default(PENDING)
  attempts      Int           @default(0)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

### src/bank/bank.service.ts
```ts
import { Injectable } from '@nestjs/common';

export type BankSendResult = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

export interface Settlement {
  txid: string;
  amount: number;
  date: Date;
}

@Injectable()
export class BankService {
  // In production this would call the real bank API.
  // Here the methods are deliberately simple so they can be mocked in tests.

  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    // ASSUMPTION: Real implementation omitted; tests will mock.
    throw new Error('BankService.send not implemented');
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    // ASSUMPTION: Real implementation omitted; tests will mock.
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

  async findPending(limit = 100): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.PENDING,
        attempts: { lt: 5 },
      },
      take: limit,
    });
  }

  async findSentInWindow(
    start: Date,
    end: Date,
  ): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.SENT,
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

  async updateStatus(id: string, status: PayoutStatus): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status },
    });
  }

  async incrementAttempts(id: string): Promise<number> {
    const updated = await this.prisma.payout.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
    return updated.attempts;
  }

  async setTxId(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }

  async parkForReview(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PARKED },
    });
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { BankService, BankSendResult } from '../bank/bank.service';
import { PayoutRepository } from './payout.repository';
import { PayoutStatus } from '@prisma/client';
import * as crypto from 'crypto';

export interface ReconcileWindow {
  start: Date;
  end: Date;
}

/**
 * Core business logic for payouts.
 * - No direct Prisma client usage (repository only).
 * - No raw SQL.
 */
@Injectable()
export class PayoutService {
  private static readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly repository: PayoutRepository,
    private readonly bank: BankService,
  ) {}

  /**
   * Derive a deterministic transaction id from stable order attributes.
   */
  private deriveTxId(payoutId: string, effectiveDate: Date): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${payoutId}|${effectiveDate.toISOString()}`);
    return hash.digest('hex').substring(0, 32); // 32‑char hex string
  }

  /**
   * Sends all pending payouts respecting attempt limits.
   */
  async executePayments(): Promise<void> {
    const pending = await this.repository.findPending();

    for (const payout of pending) {
      const txid = this.deriveTxId(payout.id, payout.effectiveDate);
      // Store the derived txid once (idempotent)
      if (!payout.txid) {
        await this.repository.setTxId(payout.id, txid);
      }

      const result = await this.bank.send({
        txid,
        amount: payout.amount,
        key: payout.supplierKey,
      });

      await this.handleBankSendResult(payout.id, result);
    }
  }

  private async handleBankSendResult(
    payoutId: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result) {
      case 'accepted':
      case 'duplicate':
        // Successful – mark as SENT (if not already) and keep attempts as‑is.
        await this.repository.updateStatus(payoutId, PayoutStatus.SENT);
        break;
      case 'transient_error':
        // Outcome unknown – record attempt and keep status SENT for later reconciliation.
        await this.repository.incrementAttempts(payoutId);
        await this.repository.updateStatus(payoutId, PayoutStatus.SENT);
        break;
      case 'permanent_rejection':
        await this.repository.updateStatus(payoutId, PayoutStatus.FAILED);
        break;
      default:
        // Defensive programming – should never happen.
        throw new BadRequestException('Unknown bank send result');
    }
  }

  /**
   * Reconciliation job. Should be safe to run repeatedly over overlapping windows.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const { start, end } = window;

    // Gather statement entries for each day in the window.
    const statementMap = new Map<string, Settlement>(); // txid => settlement

    const dayMs = 24 * 60 * 60 * 1000;
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + dayMs)
    ) {
      // eslint-disable-next-line no-await-in-loop
      const settlements = await this.bank.getStatement(d);
      for (const s of settlements) {
        statementMap.set(s.txid, s);
      }
    }

    // Process payouts that are in SENT state within the window.
    const payouts = await this.repository.findSentInWindow(start, end);

    for (const payout of payouts) {
      // If already settled, skip (idempotent).
      if (payout.status === PayoutStatus.SETTLED) {
        continue;
      }

      const txid = payout.txid;
      if (!txid) {
        // Should never happen – txid is derived before sending.
        continue;
      }

      const settlement = statementMap.get(txid);
      if (settlement) {
        // Matching settlement found – mark as settled.
        await this.repository.updateStatus(payout.id, PayoutStatus.SETTLED);
        continue;
      }

      // No settlement found – check if we are past publishing lag.
      const now = new Date();
      const lagThreshold = new Date(
        payout.effectiveDate.getTime() + PayoutService.PUBLISHING_LAG_MS,
      );

      if (now < lagThreshold) {
        // Still within lag window – do nothing, wait for next run.
        continue;
      }

      // Proven absent – attempt a resend if attempts < 5.
      const attempts = await this.repository.incrementAttempts(payout.id);
      if (attempts >= 5) {
        await this.repository.parkForReview(payout.id);
        continue;
      }

      // Resend using the same deterministic txid.
      const result = await this.bank.send({
        txid,
        amount: payout.amount,
        key: payout.supplierKey,
      });

      await this.handleBankSendResult(payout.id, result);
    }
  }
}
```

### src/payout/payout.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PayoutService, ReconcileWindow } from './payout.service';
import { IsDateString, IsObject } from 'class-validator';
import { plainToInstance } from 'class-transformer';

class ExecutePaymentsDto {}

class ReconcileDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  @HttpCode(HttpStatus.ACCEPTED)
  async executePayments(@Body() _dto: ExecutePaymentsDto): Promise<void> {
    await this.payoutService.executePayments();
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Body() dto: ReconcileDto): Promise<void> {
    const window: ReconcileWindow = {
      start: new Date(dto.start),
      end: new Date(dto.end),
    };
    await this.payoutService.reconcile(window);
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
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankService],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PayoutModule],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### test/payout.service.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService, ReconcileWindow } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { BankService, BankSendResult, Settlement } from '../src/bank/bank.service';
import { PrismaClient, PayoutStatus } from '@prisma/client';
import { expect, vi, describe, it, beforeEach } from 'vitest';

// Helper to create a payout in the in‑memory Prisma DB (using SQLite in‑memory for tests)
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./test.db?mode=memory&cache=shared',
    },
  },
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await prisma.$executeRawUnsafe(`
    CREATE TYPE "PayoutStatus" AS ENUM ('PENDING','SENT','SETTLED','FAILED','PARKED');
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Payout" (
      "id" TEXT PRIMARY KEY,
      "supplierKey" TEXT NOT NULL,
      "amount" INTEGER NOT NULL,
      "effectiveDate" TIMESTAMP NOT NULL,
      "txid" TEXT UNIQUE,
      "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
});

describe('PayoutService', () => {
  let service: PayoutService;
  let repository: PayoutRepository;
  let bankMock: BankService;

  const now = new Date();

  beforeEach(async () => {
    bankMock = {
      send: vi.fn(),
      getStatement: vi.fn(),
    } as unknown as BankService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutService,
        {
          provide: PayoutRepository,
          useFactory: () => new PayoutRepository(),
        },
        { provide: BankService, useValue: bankMock },
      ],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
    repository = module.get<PayoutRepository>(PayoutRepository);
  });

  it('timeout-but-settled: no resend after settlement appears', async () => {
    // Arrange: create a payout
    const payout = await prisma.payout.create({
      data: {
        id: 'p1',
        supplierKey: 'key1',
        amount: 1000,
        effectiveDate: now,
      },
    });

    // executePayments → transient error
    (bankMock.send as vi.Mock).mockResolvedValueOnce('transient_error');

    await service.executePayments();

    // Verify attempts incremented
    let dbPayout = await prisma.payout.findUnique({ where: { id: 'p1' } });
    expect(dbPayout?.attempts).toBe(1);
    expect(dbPayout?.status).toBe(PayoutStatus.SENT);
    const derivedTxId = dbPayout?.txid!;
    // Reconcile finds the settlement
    const settlement: Settlement = {
      txid: derivedTxId,
      amount: 1000,
      date: now,
    };
    (bankMock.getStatement as vi.Mock).mockResolvedValue([settlement]);

    const window: ReconcileWindow = { start: now, end: now };
    await service.reconcile(window);

    dbPayout = await prisma.payout.findUnique({ where: { id: 'p1' } });
    expect(dbPayout?.status).toBe(PayoutStatus.SETTLED);
    // No additional send should have been called
    expect(bankMock.send).toHaveBeenCalledTimes(1);
  });

  it('proven-absent: resend with same txid after lag', async () => {
    const effective = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const payout = await prisma.payout.create({
      data: {
        id: 'p2',
        supplierKey: 'key2',
        amount: 2000,
        effectiveDate: effective,
      },
    });

    // First attempt – transient error
    (bankMock.send as vi.Mock).mockResolvedValueOnce('transient_error');

    await service.executePayments();

    // No settlement in statement
    (bankMock.getStatement as vi.Mock).mockResolvedValue([]);

    const window: ReconcileWindow = {
      start: effective,
      end: effective,
    };
    await service.reconcile(window);

    // After reconcile we expect a resend (second send)
    expect(bankMock.send).toHaveBeenCalledTimes(2);
    const firstCall = (bankMock.send as vi.Mock).mock.calls[0][0];
    const secondCall = (bankMock.send as vi.Mock).mock.calls[1][0];
    expect(firstCall.txid).toBe(secondCall.txid); // same deterministic txid

    const dbPayout = await prisma.payout.findUnique({ where: { id: 'p2' } });
    expect(dbPayout?.attempts).toBe(2);
    expect(dbPayout?.status).toBe(PayoutStatus.SENT);
  });

  it('attempt exhaustion: park after five failed attempts', async () => {
    const effective = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const payout = await prisma.payout.create({
      data: {
        id: 'p3',
        supplierKey: 'key3',
        amount: 3000,
        effectiveDate: effective,
        attempts: 4, // already attempted 4 times
      },
    });

    // Fifth attempt – transient error
    (bankMock.send as vi.Mock).mockResolvedValueOnce('transient_error');
    await service.executePayments(); // will attempt the 5th send

    // No settlement present
    (bankMock.getStatement as vi.Mock).mockResolvedValue([]);

    const window: ReconcileWindow = {
      start: effective,
      end: effective,
    };
    await service.reconcile(window);

    // No further send after parking
    expect(bankMock.send).toHaveBeenCalledTimes(1);

    const dbPayout = await prisma.payout.findUnique({ where: { id: 'p3' } });
    expect(dbPayout?.status).toBe(PayoutStatus.PARKED);
    expect(dbPayout?.attempts).toBe(5);
  });
});
```
