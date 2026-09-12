import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { BankService } from '../src/bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { Settlement } from '../src/bank/bank.service.js';

/**
 * In‑memory mock of the payout repository.
 */
class MockPayoutRepository {
  private payouts = new Map<number, Payout>();

  constructor(initial: Payout[] = []) {
    for (const p of initial) {
      this.payouts.set(p.id, { ...p });
    }
  }

  async findPendingPayouts(): Promise<Payout[]> {
    return [...this.payouts.values()].filter(p => p.status === PayoutStatus.PENDING);
  }

  async findSentPendingPayoutsWithinWindow(start: Date, end: Date): Promise<Payout[]> {
    return [...this.payouts.values()].filter(p => {
      return (
        p.status === PayoutStatus.SENT_PENDING &&
        p.effectiveDate >= start &&
        p.effectiveDate <= end
      );
    });
  }

  async findByTxId(txid: string): Promise<Payout | null> {
    for (const p of this.payouts.values()) {
      if (p.txid === txid) return p;
    }
    return null;
  }

  async updatePayout(id: number, data: Partial<Payout>): Promise<Payout> {
    const existing = this.payouts.get(id);
    if (!existing) throw new Error(`Payout ${id} not found`);
    const updated = { ...existing, ...data };
    this.payouts.set(id, updated);
    return updated;
  }

  async setTxId(id: number, txid: string): Promise<Payout> {
    const existing = this.payouts.get(id);
    if (!existing) throw new Error(`Payout ${id} not found`);
    const updated = { ...existing, txid };
    this.payouts.set(id, updated);
    return updated;
  }

  // Helper for tests
  getById(id: number): Payout | undefined {
    return this.payouts.get(id);
  }
}

/**
 * Mock of the external bank service.
 */
class MockBankService implements Partial<BankService> {
  send = vi.fn();
  getStatement = vi.fn<Promise<Settlement[]>, [Date]>();
}

describe('PayoutService', () => {
  let bankService: MockBankService;
  let repo: MockPayoutRepository;
  let service: PayoutService;
  const now = new Date('2023-01-01T10:00:00Z');

  beforeEach(() => {
    bankService = new MockBankService();
    repo = new MockPayoutRepository();
    // @ts-ignore – we only need the methods used by the service.
    service = new PayoutService(repo as any, bankService as any);
  });

  it('timeout-but-settled: does not resend when settlement appears', async () => {
    const payout: Payout = {
      id: 1,
      supplierId: 42,
      amount: 1000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-1',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // First send – simulate transient error (timeout).
    bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });

    await service.executePayments();

    const afterSend = repo.getById(1);
    expect(afterSend).toBeDefined();
    expect(afterSend?.status).toBe(PayoutStatus.SENT_PENDING);
    expect(afterSend?.attemptCount).toBe(1);
    expect(afterSend?.txid).toBeDefined();
    const storedTxId = afterSend?.txid as string;
    expect(bankService.send).toHaveBeenCalledTimes(1);
    expect(bankService.send.mock.calls[0][0].txid).toBe(storedTxId);

    // Bank statement now contains the settlement.
    const settlement: Settlement = {
      txid: storedTxId,
      amount: payout.amount,
      settledAt: new Date('2023-01-01T10:05:00Z'),
    };
    bankService.getStatement.mockResolvedValueOnce([settlement]);

    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    await service.reconcile({ start, end });

    const afterReconcile = repo.getById(1);
    expect(afterReconcile?.status).toBe(PayoutStatus.SETTLED);
    expect(bankService.send).toHaveBeenCalledTimes(1); // no resend
    expect(bankService.getStatement).toHaveBeenCalledTimes(1);
  });

  it('proven-absent: resends when settlement absent after lag', async () => {
    const payout: Payout = {
      id: 2,
      supplierId: 99,
      amount: 2000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-2',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // First send – transient error.
    bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });

    await service.executePayments();

    const afterFirst = repo.getById(2);
    expect(afterFirst?.status).toBe(PayoutStatus.SENT_PENDING);
    expect(afterFirst?.attemptCount).toBe(1);
    const txid = afterFirst?.txid as string;

    // Statement empty for the first reconciliation.
    bankService.getStatement.mockResolvedValueOnce([]);

    // Simulate that the publishing lag has passed.
    const oldAttempt = new Date(now.getTime() - 31 * 60 * 1000);
    await repo.updatePayout(2, { lastAttemptAt: oldAttempt });

    // Resend will be accepted.
    bankService.send.mockResolvedValueOnce({ status: 'accepted' });

    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    await service.reconcile({ start, end });

    expect(bankService.send).toHaveBeenCalledTimes(2);
    expect(bankService.send.mock.calls[1][0].txid).toBe(txid);
    const afterReconcile = repo.getById(2);
    expect(afterReconcile?.attemptCount).toBe(2);
    expect(afterReconcile?.status).toBe(PayoutStatus.SENT_PENDING);
  });

  it('attempt exhaustion: parks payout after max attempts', async () => {
    // Payout already attempted 5 times without settlement.
    const payout: Payout = {
      id: 3,
      supplierId: 123,
      amount: 5000,
      effectiveDate: now,
      txid: '',
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      lastAttemptAt: null,
      key: 'bank-key-3',
      createdAt: now,
      updatedAt: now,
    };
    repo = new MockPayoutRepository([payout]);
    service = new PayoutService(repo as any, bankService as any);

    // Simulate 5 transient failures via executePayments + manual attempt counting.
    for (let i = 0; i < 5; i++) {
      bankService.send.mockResolvedValueOnce({ status: 'transient_error', error: 'timeout' });
      await service.executePayments();
      const oldAttempt = new Date(now.getTime() - (31 + i) * 60 * 1000);
      await repo.updatePayout(3, { lastAttemptAt: oldAttempt });
    }

    const afterAttempts = repo.getById(3);
    expect(afterAttempts?.attemptCount).toBe(5);
    expect(afterAttempts?.status).toBe(PayoutStatus.SENT_PENDING);
    const txid = afterAttempts?.txid as string;

    // No settlement appears.
    bankService.getStatement.mockResolvedValueOnce([]);

    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await service.reconcile({ start, end });

    const afterReconcile = repo.getById(3);
    expect(afterReconcile?.status).toBe(PayoutStatus.PARKED);
    // No additional send should have been made during reconcile.
    expect(bankService.send).toHaveBeenCalledTimes(5);
    // Ensure the stored txid never changed.
    expect(afterReconcile?.txid).toBe(txid);
  });
});
