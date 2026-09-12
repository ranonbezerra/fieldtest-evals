import { Test, TestingModule } from '@nestjs/testing';
import { PayoutModule } from '../src/payout/payout.module.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { ProviderService } from '../src/provider/provider.service.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let prisma: PrismaClient;
let payoutService: PayoutService;

beforeAll(async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [PayoutModule],
  }).compile();

  payoutService = module.get<PayoutService>(PayoutService);
  const prismaService = module.get<PrismaService>(PrismaService);
  prisma = prismaService;

  // Clean DB before tests
  await prisma.outboxMessage.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.account.deleteMany();

  // Create a test account with 10000 minor units (e.g., $100.00)
  await prisma.account.create({
    data: {
      id: 'test-account',
      settled_balance: BigInt(10_000),
      reserved_balance: BigInt(0),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Payout creation concurrency', () => {
  it('only one payout is created when two concurrent requests compete for the same funds', async () => {
    const dto = {
      accountId: 'test-account',
      amount: '8000',
      destinationAddress: 'addr-1',
      idempotencyKey: 'key-conc-1',
    };

    // Run two creations in parallel
    const [p1, p2] = await Promise.allSettled([
      payoutService.createPayout(dto),
      payoutService.createPayout({ ...dto, idempotencyKey: 'key-conc-2' }),
    ]);

    // One should succeed, the other should fail with insufficient funds
    const successes = [p1, p2].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const failures = [p1, p2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason?.response?.error?.code).toBe('insufficient_funds');

    const payouts = await prisma.payout.findMany();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(BigInt(8000));
    expect(payouts[0].status).toBe('CREATED');

    const account = await prisma.account.findUnique({ where: { id: 'test-account' } });
    expect(account?.reserved_balance).toBe(BigInt(8000));
    expect(account?.settled_balance).toBe(BigInt(10_000));
  });
});

describe('Idempotency', () => {
  it('repeating the same idempotencyKey does not create a second payout', async () => {
    const dto = {
      accountId: 'test-account',
      amount: '1000',
      destinationAddress: 'addr-2',
      idempotencyKey: 'idem-key-1',
    };

    const first = await payoutService.createPayout(dto);
    const second = await payoutService.createPayout(dto);

    expect(first.id).toBe(second.id);

    const payouts = await prisma.payout.findMany({
      where: { idempotency_key: 'idem-key-1' },
    });
    expect(payouts).toHaveLength(1);
  });
});

describe('Duplicate message delivery', () => {
  it('processing the same outbox message twice results in only one transfer', async () => {
    const dto = {
      accountId: 'test-account',
      amount: '500',
      destinationAddress: 'addr-dup',
      idempotencyKey: 'dup-msg-key',
    };

    const payout = await payoutService.createPayout(dto);
    const message = await prisma.outboxMessage.findUnique({
      where: { payoutId: payout.id },
    });
    expect(message).toBeDefined();

    // Manually invoke worker processing twice
    const repo = new (await import('../src/payout/payout.repository.js')).PayoutRepository(
      new PrismaService(),
    );
    const worker = new (await import('../src/payout/payout.worker.js')).PayoutWorker(
      repo,
      new ProviderService(),
    );

    // First processing
    await (worker as any).processMessages();

    // Capture state after first run
    const afterFirst = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(afterFirst?.status).toBe('COMPLETED');

    // Second processing (should be a no‑op)
    await (worker as any).processMessages();

    const afterSecond = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(afterSecond?.status).toBe('COMPLETED');

    // Ensure only one ledger entry was created
    const ledger = await prisma.ledgerEntry.findMany({
      where: { accountId: 'test-account', description: { contains: payout.id } },
    });
    expect(ledger).toHaveLength(1);
  });
});

describe('Retry exhaustion', () => {
  it('moves payout to NEEDS_REVIEW after max attempts and keeps reservation', async () => {
    const dto = {
      accountId: 'test-account',
      amount: '400',
      destinationAddress: 'fail-addr', // triggers failures
      idempotencyKey: 'exhaust-key',
    };

    const payout = await payoutService.createPayout(dto);
    const repo = new (await import('../src/payout/payout.repository.js')).PayoutRepository(
      new PrismaService(),
    );
    const worker = new (await import('../src/payout/payout.worker.js')).PayoutWorker(
      repo,
      new ProviderService(),
    );

    // Simulate three processing attempts
    for (let i = 0; i < 4; i++) {
      await (worker as any).processMessages();
    }

    const refreshed = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(refreshed?.status).toBe('NEEDS_REVIEW');

    const account = await prisma.account.findUnique({ where: { id: 'test-account' } });
    // Reservation should still be present
    expect(account?.reserved_balance).toBe(BigInt(8000 + 1000 + 500 + 400));
  });
});
