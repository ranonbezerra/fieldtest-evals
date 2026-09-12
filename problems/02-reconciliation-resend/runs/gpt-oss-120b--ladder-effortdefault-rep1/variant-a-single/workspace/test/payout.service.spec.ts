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
