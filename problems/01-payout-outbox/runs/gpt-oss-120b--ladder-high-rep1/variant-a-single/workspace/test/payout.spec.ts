import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { ProviderService } from '../src/provider/provider.service';
import { PrismaService } from '../src/prisma.service';
import { CreatePayoutDto } from '../src/payout/dto/create-payout.dto';
import { PayoutProcessor } from '../src/payout/payout.processor';
import { PrismaClient, PayoutStatus } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Payout Service Integration', () => {
  let module: TestingModule;
  let payoutService: PayoutService;
  let payoutProcessor: PayoutProcessor;
  let prisma: PrismaClient;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PayoutService,
        PayoutRepository,
        ProviderService,
        PayoutProcessor,
        PrismaService,
      ],
    }).compile();

    payoutService = module.get(PayoutService);
    payoutProcessor = module.get(PayoutProcessor);
    const prismaService = module.get(PrismaService);
    prisma = prismaService as unknown as PrismaClient;

    // Clean DB tables (in a real test environment you would run migrations and truncate)
    await prisma.message.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.account.deleteMany();

    // Create a test account with sufficient settled balance (e.g., 1000 units)
    await prisma.account.create({
      data: {
        id: 'test-account',
        settled_balance: 1000n,
        reserved_balance: 0n,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should be idempotent on idempotencyKey', async () => {
    const dto: CreatePayoutDto = {
      accountId: 'test-account',
      amount: 500n,
      destinationAddress: '0xabc',
      idempotencyKey: 'unique-key-123',
    };
    const first = await payoutService.createPayout(dto);
    const second = await payoutService.createPayout(dto);
    expect(first.id).toBe(second.id);
  });

  it('should prevent overdraw on concurrent requests', async () => {
    const dto1: CreatePayoutDto = {
      accountId: 'test-account',
      amount: 600n,
      destinationAddress: '0xdef',
      idempotencyKey: 'concurrent-1',
    };
    const dto2: CreatePayoutDto = {
      accountId: 'test-account',
      amount: 600n,
      destinationAddress: '0xghi',
      idempotencyKey: 'concurrent-2',
    };

    const [res1, res2] = await Promise.allSettled([
      payoutService.createPayout(dto1),
      payoutService.createPayout(dto2),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const rejection = failures[0] as PromiseRejectedResult;
    const err = rejection.reason as HttpException;
    const resp = err.getResponse?.() ?? err;
    expect((resp as any).error?.code).toBe('insufficient_funds');
  });

  it('should handle duplicate message delivery safely', async () => {
    const provider = module.get(ProviderService);
    const transferSpy = vi.spyOn(provider, 'transfer').mockResolvedValue({ txHash: '0x123' });

    const dto: CreatePayoutDto = {
      accountId: 'test-account',
      amount: 200n,
      destinationAddress: '0xdup',
      idempotencyKey: 'dup-key',
    };
    const payout = await payoutService.createPayout(dto);

    // Process messages twice
    await payoutProcessor.processPendingMessages();
    await payoutProcessor.processPendingMessages();

    // Provider called only once
    expect(transferSpy).toHaveBeenCalledTimes(1);

    const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updated?.status).toBe(PayoutStatus.COMPLETED);
  });

  it('should mark payout as needs_review after retry exhaustion', async () => {
    const provider = module.get(ProviderService);
    vi.spyOn(provider, 'transfer').mockImplementation(() => {
      throw new Error('Transient error');
    });

    const dto: CreatePayoutDto = {
      accountId: 'test-account',
      amount: 100n,
      destinationAddress: '0xfail',
      idempotencyKey: 'fail-key',
    };
    const payout = await payoutService.createPayout(dto);

    // Process more times than MAX_ATTEMPTS (3)
    for (let i = 0; i < 4; i++) {
      await payoutProcessor.processPendingMessages();
    }

    const final = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(final?.status).toBe(PayoutStatus.NEEDS_REVIEW);

    // Reservation should still be held
    const account = await prisma.account.findUnique({ where: { id: 'test-account' } });
    expect(account?.reserved_balance).toBeGreaterThanOrEqual(100n);
  });
});
