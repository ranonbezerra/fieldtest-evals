import { Test, TestingModule } from '@nestjs/testing';
import { PayoutModule } from '../src/payout/payout.module';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutWorker } from '../src/payout/payout.worker';
import { PrismaService } from '../src/prisma.service';
import { TransferProvider, TransferResult } from '../src/provider/transfer.provider';
import { Payout, Account } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';

class MockTransferProvider extends TransferProvider {
  public calls = 0;
  private behavior: 'success' | 'failure';

  constructor(behavior: 'success' | 'failure' = 'success') {
    super();
    this.behavior = behavior;
  }

  async transfer(to: string, amount: bigint): Promise<TransferResult> {
    this.calls++;
    if (this.behavior === 'success') {
      return { txHash: '0xdeadbeef' };
    }
    throw new Error('Transient error');
  }

  setBehavior(b: 'success' | 'failure') {
    this.behavior = b;
  }
}

describe('Payout Service & Worker', () => {
  let moduleRef: TestingModule;
  let payoutService: PayoutService;
  let payoutWorker: PayoutWorker;
  let prisma: PrismaService;
  let mockProvider: MockTransferProvider;

  const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    mockProvider = new MockTransferProvider('success');

    moduleRef = await Test.createTestingModule({
      imports: [PayoutModule],
    })
      .overrideProvider(TransferProvider)
      .useValue(mockProvider)
      .compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutWorker = moduleRef.get<PayoutWorker>(PayoutWorker);
    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Clean DB and create a test account.
    await prisma.outboxMessage.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.account.deleteMany();

    await prisma.account.create({
      data: {
        id: ACCOUNT_ID,
        settledBalance: 1000n,
        reservedBalance: 0n,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Reset state before each test.
    await prisma.outboxMessage.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.account.update({
      where: { id: ACCOUNT_ID },
      data: {
        settledBalance: 1000n,
        reservedBalance: 0n,
      },
    });
    mockProvider.calls = 0;
    mockProvider.setBehavior('success');
  });

  it('prevents overdraw on concurrent requests', async () => {
    const dto1 = {
      accountId: ACCOUNT_ID,
      amount: '800',
      destinationAddress: 'addr-1',
      idempotencyKey: 'key-1',
    };
    const dto2 = {
      accountId: ACCOUNT_ID,
      amount: '800',
      destinationAddress: 'addr-2',
      idempotencyKey: 'key-2',
    };

    const [res1, res2] = await Promise.allSettled([
      payoutService.createPayout(dto1),
      payoutService.createPayout(dto2),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    expect(account?.reservedBalance).toBe(800n);
  });

  it('is idempotent for the same idempotencyKey', async () => {
    const dto = {
      accountId: ACCOUNT_ID,
      amount: '500',
      destinationAddress: 'addr-dup',
      idempotencyKey: 'dup-key',
    };

    const first = await payoutService.createPayout(dto);
    const second = await payoutService.createPayout(dto);

    expect(second.id).toBe(first.id);

    const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    expect(account?.reservedBalance).toBe(500n);
  });

  it('processes a message exactly once despite duplicate delivery', async () => {
    const dto = {
      accountId: ACCOUNT_ID,
      amount: '400',
      destinationAddress: 'addr-msg',
      idempotencyKey: 'msg-key',
    };

    const payout = await payoutService.createPayout(dto);
    // First processing
    await payoutWorker.processMessages();
    // Duplicate delivery (process again)
    await payoutWorker.processMessages();

    expect(mockProvider.calls).toBe(1);

    const updatedPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updatedPayout?.status).toBe('SENT');

    const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    expect(account?.settledBalance).toBe(600n); // 1000 - 400
    expect(account?.reservedBalance).toBe(0n);
  });

  it('marks payout as NEEDS_REVIEW after retry exhaustion and keeps reservation', async () => {
    mockProvider.setBehavior('failure');

    const dto = {
      accountId: ACCOUNT_ID,
      amount: '300',
      destinationAddress: 'addr-retry',
      idempotencyKey: 'retry-key',
    };

    const payout = await payoutService.createPayout(dto);

    // Process up to (maxAttempts + 1) times to ensure exhaustion.
    for (let i = 0; i < 4; i++) {
      await payoutWorker.processMessages();
    }

    const updatedPayout = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(updatedPayout?.status).toBe('NEEDS_REVIEW');

    const account = await prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    // Reservation stays, settled balance unchanged.
    expect(account?.reservedBalance).toBe(300n);
    expect(account?.settledBalance).toBe(1000n);
  });
});
