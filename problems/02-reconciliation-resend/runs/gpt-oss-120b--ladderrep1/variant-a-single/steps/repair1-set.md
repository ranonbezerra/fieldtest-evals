# repair1-set

## reasoning

```
We need fix import paths. Likely folder structure: src/payout/... and test referring to ../src/... but tsconfig base? Since tests at root test folder, need correct relative paths. Use absolute path with src prefix? In tsconfig maybe rootDir src. Simpler: adjust imports to correct relative paths.

src/main.ts imports './payout/payout.module' but file is src/payout/payout.module.ts, relative to src/main.ts is './payout/payout.module' correct. error maybe because .ts extension missing? TypeScript resolves .ts fine. Might be because package type module requires .js extension? Actually Node ESM needs extension. In tsconfig with moduleResolution node16? Might need .js. So change imports to include .js extension. Apply to all internal imports.

Thus change imports like './payout/payout.module' to './payout/payout.module.js' etc. Also class-validator and class-transformer missing types; need to install but we can import from 'class-validator' still works if types present. Probably missing because not installed; but we can avoid using them? In controller they import IsDateString, IsObject but not used. Could remove imports. Simpler: remove those imports.

Also test imports need .js extensions and use vi from vitest global; need import { vi } from 'vitest'.

Add import { vi, describe, it, expect, beforeEach } from 'vitest' already they have import but using vi namespace; they used "import { expect, vi, describe, it, beforeEach } from 'vitest';" that's fine. Errors say cannot find namespace vi because they used vi as namespace not imported? Actually they imported vi variable, not namespace. In code they use (bankMock.send as vi.Mock). That's correct type. Might need import type Mock from vitest. Actually vi.Mock is a type under vitest namespace. Importing vi gives the mock functions, but not the namespace type. Should import { vi, Mock }? Better to import * as vi from 'vitest'? Simpler: change casts to (bankMock.send as any). Avoid vi.Mock.

Modify test file accordingly: replace (bankMock.send as vi.Mock) with (bankMock.send as any). Also remove vi.Mock elsewhere.

Also need to fix missing Settlement type in service: import from bank service. Add import { Settlement } from '../bank/bank.service'.

Now adjust imports with .js extension? For ESM, need .js. Apply to all internal imports.

Let's produce changed files: src/payout/payout.controller.ts, src/payout/payout.module.ts, src/payout/payout.service.ts, test/payout.service.spec.ts, src/main.ts.
```

## reply

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

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

### src/payout/payout.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PayoutService, ReconcileWindow } from './payout.service.js';
import { IsDateString } from 'class-validator';

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
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { BankService } from '../bank/bank.service.js';

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankService],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### src/payout/payout.service.ts
```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { PayoutRepository } from './payout.repository.js';
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

### test/payout.service.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService, ReconcileWindow } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { BankService, BankSendResult, Settlement } from '../src/bank/bank.service.js';
import { PrismaClient, PayoutStatus } from '@prisma/client';
import { expect, describe, it, beforeEach, vi } from 'vitest';

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
    (bankMock.send as any).mockResolvedValueOnce('transient_error');

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
    (bankMock.getStatement as any).mockResolvedValue([settlement]);

    const window: ReconcileWindow = { start: now, end: now };
    await service.reconcile(window);

    dbPayout = await prisma.payout.findUnique({ where: { id: 'p1' } });
    expect(dbPayout?.status).toBe(PayoutStatus.SETTLED);
    // No additional send should have been called
    expect((bankMock.send as any).mock.calls.length).toBe(1);
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
    (bankMock.send as any).mockResolvedValueOnce('transient_error');

    await service.executePayments();

    // No settlement in statement
    (bankMock.getStatement as any).mockResolvedValue([]);

    const window: ReconcileWindow = {
      start: effective,
      end: effective,
    };
    await service.reconcile(window);

    // After reconcile we expect a resend (second send)
    expect((bankMock.send as any).mock.calls.length).toBe(2);
    const firstCall = (bankMock.send as any).mock.calls[0][0];
    const secondCall = (bankMock.send as any).mock.calls[1][0];
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
    (bankMock.send as any).mockResolvedValueOnce('transient_error');
    await service.executePayments(); // will attempt the 5th send

    // No settlement present
    (bankMock.getStatement as any).mockResolvedValue([]);

    const window: ReconcileWindow = {
      start: effective,
      end: effective,
    };
    await service.reconcile(window);

    // No further send after parking
    expect((bankMock.send as any).mock.calls.length).toBe(1);

    const dbPayout = await prisma.payout.findUnique({ where: { id: 'p3' } });
    expect(dbPayout?.status).toBe(PayoutStatus.PARKED);
    expect(dbPayout?.attempts).toBe(5);
  });
});
```
