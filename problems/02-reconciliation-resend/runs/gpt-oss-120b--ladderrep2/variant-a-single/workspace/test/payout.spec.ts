import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { BankService } from '../src/bank/bank.service.js';
import { PayoutStatus } from '@prisma/client';
import { vi } from 'vitest';

describe('PayoutService', () => {
  let service: PayoutService;
  let repo: PayoutRepository;
  let bank: BankService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayoutService, PayoutRepository, BankService],
    }).compile();

    service = module.get<PayoutService>(PayoutService);
    repo = module.get<PayoutRepository>(PayoutRepository);
    bank = module.get<BankService>(BankService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not resend when timeout send later appears in statement (timeout-but-settled)', async () => {
    // Arrange: a payout that was sent once, bank returned transient_error, but later statement contains it
    const now = new Date();
    const payout = {
      id: 1,
      orderId: 'order-1',
      supplierKey: 'key-1',
      amount: 1000,
      effectiveDate: new Date(now.getTime() - 60 * 60 * 1000), // 1h ago
      txid: 'derived-txid-1',
      status: PayoutStatus.pending,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    vi.spyOn(repo, 'findPendingToSend').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'transient_error' });
    vi.spyOn(repo, 'updateAfterSend').mockImplementation(async (_, __, status) => ({
      ...payout,
      status,
      attempts: 1,
      txid: payout.txid,
    }));
    // Simulate statement later containing the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([
      { txid: 'derived-txid-1', amount: 1000, settledAt: new Date() },
    ]);
    vi.spyOn(repo, 'findByTxid').mockResolvedValue(payout);
    vi.spyOn(repo, 'markSettled').mockResolvedValue({
      ...payout,
      status: PayoutStatus.settled,
    });

    // Act
    await service.executePayments(); // first attempt (transient)
    await service.reconcile({ start: new Date(now.getTime() - 2 * 60 * 60 * 1000), end: now });

    // Assert
    expect(repo.updateAfterSend).toHaveBeenCalledWith(
      payout.id,
      payout.txid,
      PayoutStatus.pending,
      1,
    );
    expect(repo.markSettled).toHaveBeenCalledWith(payout.id);
  });

  it('re-sends when proven absent after publishing lag (proven-absent)', async () => {
    const now = new Date();
    const payout = {
      id: 2,
      orderId: 'order-2',
      supplierKey: 'key-2',
      amount: 2000,
      effectiveDate: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2h ago
      txid: 'derived-txid-2',
      status: PayoutStatus.sent,
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    };
    // No statement contains the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([]);
    vi.spyOn(repo, 'findAwaitingEvidence').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'accepted' });
    vi.spyOn(repo, 'incrementAttemptsAndMaybePark').mockImplementation(async (id) => ({
      ...payout,
      attempts: payout.attempts + 1,
    }));
    // Act
    await service.reconcile({ start: new Date(now.getTime() - 30 * 60 * 1000), end: now });

    // Assert
    expect(bank.send).toHaveBeenCalledWith({
      txid: payout.txid,
      amount: payout.amount,
      key: payout.supplierKey,
    });
    expect(repo.incrementAttemptsAndMaybePark).toHaveBeenCalledWith(payout.id, 5);
  });

  it('parks payout after attempts exhausted (attempt-exhaustion)', async () => {
    const now = new Date();
    const payout = {
      id: 3,
      orderId: 'order-3',
      supplierKey: 'key-3',
      amount: 3000,
      effectiveDate: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      txid: 'derived-txid-3',
      status: PayoutStatus.sent,
      attempts: 4, // one attempt left before hitting max 5
      createdAt: now,
      updatedAt: now,
    };
    // No statement contains the txid
    vi.spyOn(bank, 'getStatement').mockResolvedValue([]);
    vi.spyOn(repo, 'findAwaitingEvidence').mockResolvedValue([payout]);
    vi.spyOn(bank, 'send').mockResolvedValue({ outcome: 'transient_error' });
    vi.spyOn(repo, 'incrementAttemptsAndMaybePark').mockImplementation(async (id, max) => {
      // Simulate reaching max attempts -> parked
      return {
        ...payout,
        attempts: payout.attempts + 1,
        status: PayoutStatus.parked,
      };
    });

    await service.reconcile({ start: new Date(now.getTime() - 30 * 60 * 1000), end: now });

    expect(repo.incrementAttemptsAndMaybePark).toHaveBeenCalledWith(payout.id, 5);
  });
});
