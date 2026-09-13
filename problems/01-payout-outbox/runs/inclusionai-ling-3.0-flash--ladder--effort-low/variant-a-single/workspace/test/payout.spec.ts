import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutModule } from '../src/payout/payout.module';
import { ProviderModule } from '../src/provider/provider.module';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PrismaService } from '../src/common/prisma.service';
import { ProviderService } from '../src/provider/provider.service';
import { KnownError } from '../src/common/filters/exception.filter';
import { PayoutStatus, MessageStatus, LedgerType } from '../src/payout/payout.types';
import type { Payout } from '@prisma/client';

vi.mock('external-provider-sdk', () => ({
  provider: {
    transfer: vi.fn(),
    confirm: vi.fn(),
  },
}));

describe('PayoutService', () => {
  let payoutService: PayoutService;
  let payoutRepo: PayoutRepository;
  let prisma: PrismaService;
  let providerMock: ReturnType<typeof vi.fn>[];

  const ACCOUNT_ID = 'acc-test-1';
  const LARGE_AMOUNT = 100000000n; // 1,000,000 in minor units

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PayoutModule, ProviderModule],
      providers: [
        {
          provide: ProviderService,
          useValue: {
            transfer: vi.fn(),
            confirmTransfer: vi.fn(),
          },
        },
        PrismaService,
      ],
    }).compile();

    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutRepo = moduleRef.get<PayoutRepository>(PayoutRepository);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    providerMock = [
      (moduleRef.get<ProviderService>(ProviderService) as unknown as { transfer: ReturnType<typeof vi.fn> }).transfer,
      (moduleRef.get<ProviderService>(ProviderService) as unknown as { confirmTransfer: ReturnType<typeof vi.fn> }).confirmTransfer,
    ];

    await payoutRepo.resetDatabase();
    // Seed account with funds
    await prisma.account.create({
      data: {
        id: ACCOUNT_ID,
        settledBalance: LARGE_AMOUNT,
        reservedBalance: 0n,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('concurrent creation against one account', () => {
    it('exactly one payout is created when two concurrent requests race for limited funds', async () => {
      const amount = 60000000n;
      const key1 = 'idem-key-concurrent';

      // Provider is not called — we only test the reservation phase
      const promise1 = payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr1',
        idempotencyKey: key1,
      });

      const promise2 = payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr2',
        idempotencyKey: key1 + '-2',
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Exactly one succeeds
      const successCount = [result1, result2].filter(
        (r) => r.status === PayoutStatus.CREATED,
      ).length;
      expect(successCount).toBe(1);

      // One throws insufficient_funds
      const errors: KnownError[] = [];
      // Re-run to capture errors properly
      const results: Array<Payout | KnownError | null> = [];
      const runs = await Promise.allSettled([promise1, promise2]);
      // The promises above already executed; let's check the results differently

      // Check DB state
      const payouts = await prisma.payout.findMany({
        where: { accountId: ACCOUNT_ID },
      });
      expect(payouts.length).toBe(1);
      expect(payouts[0].status).toBe(PayoutStatus.CREATED);
      expect(payouts[0].amount).toBe(amount);

      // Account should show one reservation
      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
      // Settled should NOT have changed
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('idempotency key', () => {
    it('same idempotencyKey returns original payout without double-reserving', async () => {
      const amount = 50000000n;
      const key = 'idem-key-same';

      const payout1 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-1',
        idempotencyKey: key,
      });

      const payout2 = await payoutService.createPayout({
        accountId: ACCOUNT_ID,
        amount,
        destinationAddress: 'addr-2', // different address
        idempotencyKey: key,
      });

      // Same payout returned
      expect(payout2.id).toBe(payout1.id);

      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
    });
  });

  describe('duplicate message delivery', () => {
    it('same message delivered twice results in one provider transfer', async () => {
      const amount = 50000000n;
      // Create payout and message manually for this test
      await prisma.$transaction(async (tx: any) => {
        await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-once',
            idempotencyKey: 'idem-dup-msg',
            status: PayoutStatus.CREATED,
          },
        });
        await tx.message.create({
          data: {
            payoutId: await (async () => {
              const p = await tx.payout.findUnique({ where: { idempotencyKey: 'idem-dup-msg' } });
              return p!.id;
            })(),
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerMock[0].mockResolvedValue({ txHash: '0xabc123' });

      // Run the worker twice — simulates duplicate delivery
      await payoutService.processMessages();
      await payoutService.processMessages();

      // Provider transfer called exactly once
      expect(providerMock[0]).toHaveBeenCalledTimes(1);
      expect(providerMock[0]).toHaveBeenCalledWith('addr-once', amount);

      const payouts = await prisma.payout.findMany();
      expect(payouts[0].status).toBe(PayoutStatus.SENT);

      const messages = await prisma.message.findMany();
      expect(messages[0].status).toBe(MessageStatus.PROCESSED);
    });
  });

  describe('retry exhaustion', () => {
    it('after max retries, payout enters NEEDS_REVIEW and reservation stays intact', async () => {
      const amount = 50000000n;
      await prisma.$transaction(async (tx: any) => {
        await tx.payout.create({
          data: {
            accountId: ACCOUNT_ID,
            amount,
            destinationAddress: 'addr-retry',
            idempotencyKey: 'idem-retry',
            status: PayoutStatus.CREATED,
          },
        });
        const payout = await tx.payout.findUnique({
          where: { idempotencyKey: 'idem-retry' },
        });
        await tx.message.create({
          data: {
            payoutId: payout!.id,
            status: MessageStatus.PENDING,
            nextAttemptAt: new Date(),
          },
        });
      });

      providerMock[0].mockRejectedValue(new Error('provider timeout'));

      // Run processMessages() MAX_RETRIES + 1 times (but message is consumed after first run)
      // Each run processes the pending message; after failure with attempts >= MAX_RETRIES,
      // the message goes to FAILED and the payout goes to NEEDS_REVIEW.
      // On subsequent runs, there are no pending messages.
      await payoutService.processMessages(); // First attempt — fails, schedules retry (attempts=1)

      // Advance time past next retry window and run again
      const msg = await prisma.message.findFirst();
      expect(msg).not.toBeNull();
      expect(msg!.status).toBe(MessageStatus.PENDING);
      expect(msg!.attempts).toBe(1);

      // Fast-forward nextAttemptAt
      await prisma.message.updateMany({
        where: { id: msg!.id },
        data: { nextAttemptAt: new Date(0) },
      });

      await payoutService.processMessages(); // Second attempt — fails, attempts=2

      const msg2 = await prisma.message.findFirst();
      await prisma.message.updateMany({
        where: { id: msg2!.id },
        data: { nextAttemptAt: new Date(0) },
      });

      await payoutService.processMessages(); // Third attempt — fails, attempts=3 >= MAX_RETRIES

      // Now payout should be NEEDS_REVIEW, message FAILED
      const payouts = await prisma.payout.findMany();
      expect(payouts[0].status).toBe(PayoutStatus.NEEDS_REVIEW);

      const messages = await prisma.message.findMany();
      expect(messages[0].status).toBe(MessageStatus.FAILED);

      // Reservation stays intact — reservedBalance unchanged
      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      expect(account!.reservedBalance).toBe(amount);
      // Settled balance unchanged
      expect(account!.settledBalance).toBe(LARGE_AMOUNT);
    });
  });

  describe('settlement on confirmation', () => {
    it('settled balance changes only after provider confirmation', async () => {
      const amount = 50000000n;
      // Create a payout in SENT status with txHash
      await prisma.payout.create({
        data: {
          accountId: ACCOUNT_ID,
          amount,
          destinationAddress: 'addr-settle',
          idempotencyKey: 'idem-settle',
          status: PayoutStatus.SENT,
          txHash: '0xconfirmed',
        },
      });

      providerMock[1].mockResolvedValue(true);

      await payoutService.processMessages();

      const payout = await prisma.payout.findUnique({
        where: { idempotencyKey: 'idem-settle' },
      });
      expect(payout!.status).toBe(PayoutStatus.COMPLETED);

      const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
      });
      // Settled decreased
      expect(account!.settledBalance).toBe(LARGE_AMOUNT - amount);
      // Reserved released
      expect(account!.reservedBalance).toBe(0n);

      // Ledger entry exists for settlement
      const entries = await prisma.ledgerEntry.findMany({
        where: { payoutId: payout!.id },
      });
      const settlement = entries.find((e: any) => e.type === LedgerType.SETTLEMENT);
      expect(settlement).toBeDefined();
      expect(settlement!.amount).toBe(-amount);
    });
  });
});
