import { Test, TestingModule } from '@nestjs/testing';
import { PayoutModule } from '../src/payout/payout.module.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PrismaService } from '../src/prisma.service.js';
import { CryptoProviderService } from '../src/provider/crypto-provider.js';
import { PayoutWorkerService } from '../src/payout/payout.worker.js';
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

type MockProvider = {
  transfer: vi.Mock;
};

describe('Payout flow', () => {
  let moduleRef: TestingModule;
  let payoutService: PayoutService;
  let payoutRepository: PayoutRepository;
  let payoutWorker: PayoutWorkerService;
  let prisma: PrismaService;
  let mockProvider: MockProvider;

  beforeAll(async () => {
    mockProvider = {
      transfer: vi.fn(),
    };

    moduleRef = await Test.createTestingModule({
      imports: [PayoutModule],
    })
      .overrideProvider(CryptoProviderService)
      .useValue(mockProvider)
      .compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutRepository = moduleRef.get<PayoutRepository>(PayoutRepository);
    payoutWorker = moduleRef.get<PayoutWorkerService>(PayoutWorkerService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Clean tables
    await prisma.message.deleteMany({});
    await prisma.payout.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.account.deleteMany({});

    // Create a fresh account with 1000 units settled balance
    await prisma.account.create({
      data: {
        settled_balance: 1000n,
        reserved_balance: 0n,
        version: 0,
      },
    });
    mockProvider.transfer.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('concurrent creation with insufficient funds creates only one payout', async () => {
    const account = await prisma.account.findFirst({});
    if (!account) throw new Error('Account not created');

    const amount = 800n;
    const dto1 = {
      accountId: account.id,
      amount,
      destinationAddress: 'addr1',
      idempotencyKey: 'key1',
    };
    const dto2 = {
      accountId: account.id,
      amount,
      destinationAddress: 'addr2',
      idempotencyKey: 'key2',
    };

    const [res1, res2] = await Promise.allSettled([
      payoutService.createPayout(dto1 as any),
      payoutService.createPayout(dto2 as any),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const payout = (fulfilled[0] as any).value;
    expect(payout.amount).toBe(amount);

    const refreshedAccount = await prisma.account.findUnique({ where: { id: account.id } });
    expect(refreshedAccount?.reserved_balance).toBe(amount);

    const payouts = await prisma.payout.findMany({ where: { account_id: account.id } });
    expect(payouts).toHaveLength(1);
  });

  it('duplicate idempotencyKey returns same payout without extra reservation', async () => {
    const account = await prisma.account.findFirst({});
    if (!account) throw new Error('Account not created');

    const amount = 500n;
    const idempotencyKey = 'dup-key';
    const dto = {
      accountId: account.id,
      amount,
      destinationAddress: 'addr',
      idempotencyKey,
    };

    const first = await payoutService.createPayout(dto as any);
    const beforeReserved = (await prisma.account.findUnique({ where: { id: account.id } }))?.reserved_balance;

    const second = await payoutService.createPayout(dto as any);
    expect(second.id).toBe(first.id);

    const afterReserved = (await prisma.account.findUnique({ where: { id: account.id } }))?.reserved_balance;
    expect(afterReserved).toEqual(beforeReserved);

    const payouts = await prisma.payout.findMany({ where: { account_id: account.id, idempotency_key: idempotencyKey } });
    expect(payouts).toHaveLength(1);
  });

  it('duplicate message delivery processes transfer only once', async () => {
    const account = await prisma.account.findFirst({});
    if (!account) throw new Error('Account not created');

    const amount = 300n;
    const dto = {
      accountId: account.id,
      amount,
      destinationAddress: 'addr',
      idempotencyKey: 'dup-msg',
    };

    const payout = await payoutService.createPayout(dto as any);
    const message = await prisma.message.findUnique({ where: { payout_id: payout.id } });
    expect(message).toBeTruthy();

    mockProvider.transfer.mockResolvedValue({ txHash: '0xabc' });

    // First processing
    await payoutWorker.processMessages();
    // Second processing (should be a no‑op)
    await payoutWorker.processMessages();

    expect(mockProvider.transfer).toHaveBeenCalledTimes(1);
    const updatedMessage = await prisma.message.findUnique({ where: { id: message!.id } });
    expect(updatedMessage?.status).toBe('DONE');
  });

  it('exhausts retries and moves payout to needs_review, reservation stays', async () => {
    const account = await prisma.account.findFirst({});
    if (!account) throw new Error('Account not created');

    const amount = 400n;
    const dto = {
      accountId: account.id,
      amount,
      destinationAddress: 'addr',
      idempotencyKey: 'retry',
    };

    const payout = await payoutService.createPayout(dto as any);
    const message = await prisma.message.findUnique({ where: { payout_id: payout.id } });
    if (!message) throw new Error('Message not created');

    mockProvider.transfer.mockRejectedValue(new Error('Transient error'));

    const maxAttempts = message.max_attempts;
    for (let i = 0; i < maxAttempts; i++) {
      await payoutWorker.processMessages();
    }

    const updatedPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
    const updatedMessage = await prisma.message.findUnique({ where: { id: message.id } });
    const updatedAccount = await prisma.account.findUnique({ where: { id: account.id } });

    expect(updatedPayout?.status).toBe('NEEDS_REVIEW');
    expect(updatedMessage?.status).toBe('FAILED');
    expect(updatedAccount?.reserved_balance).toBe(amount); // reservation unchanged
  });
});
