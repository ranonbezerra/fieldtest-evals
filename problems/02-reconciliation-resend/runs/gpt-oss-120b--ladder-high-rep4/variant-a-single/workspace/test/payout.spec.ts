import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { BankService, BankSendResult, Settlement } from '../src/bank/bank.service.js';
import { PayoutState, Payout } from '@prisma/client';
import { createHash } from 'crypto';

// Mock repository implementing the same API as PayoutRepository
class MockPayoutRepository {
  private payouts: Map<number, Payout>;

  constructor(initial: Payout[]) {
    this.payouts = new Map<number, Payout>(initial.map(p => [p.id, { ...p }]));
  }

  async create(data: any): Promise<Payout> {
    const id = Math.max(...Array.from(this.payouts.keys()), 0) + 1;
    const payout: Payout = {
      id,
      supplier_key: data.supplier_key,
      amount: data.amount,
      effective_date: data.effective_date,
      txid: null,
      attempts: 0,
      state: PayoutState.pending,
      last_attempt_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.payouts.set(id, payout);
    return payout;
  }

  async findById(id: number): Promise<Payout | null> {
    return this.payouts.get(id) ?? null;
  }

  async findPending(): Promise<Payout[]> {
    return Array.from(this.payouts.values()).filter(p => p.state === PayoutState.pending);
  }

  async findByEffectiveDateRange(from: Date, to: Date): Promise<Payout[]> {
    return Array.from(this.payouts.values()).filter(p => {
      const d = p.effective_date;
      return d >= from && d <= to;
    });
  }

  async updateStateAndAttempt(
    id: number,
    data: {
      state: PayoutState;
      attempts: { increment: number };
      last_attempt_at: Date;
      txid?: string;
    },
  ): Promise<void> {
    const payout = this.payouts.get(id);
    if (!payout) return;
    payout.state = data.state;
    payout.attempts = (payout.attempts ?? 0) + data.attempts.increment;
    payout.last_attempt_at = data.last_attempt_at;
    if (data.txid !== undefined) {
      payout.txid = data.txid;
    }
    payout.updated_at = new Date();
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    const payout = this.payouts.get(id);
    if (!payout) return;
    payout.state = state;
    payout.updated_at = new Date();
  }

  // Helper for tests
  getPayout(id: number): Payout | undefined {
    return this.payouts.get(id);
  }
}

// Mock bank service
class MockBankService {
  send = vi.fn<Promise<BankSendResult>, [{ txid: string; amount: number; key: string }]>();
  getStatement = vi.fn<Promise<Settlement[]>, [Date, Date]>();
}

// Helper to compute deterministic txid (same logic as service)
function deriveTxId(payout: Payout): string {
  const data = `${payout.id}|${payout.supplier_key}|${payout.amount}|${payout.effective_date.toISOString()}`;
  return createHash('sha256').update(data).digest('hex');
}

describe('PayoutService reconciliation and resend logic', () => {
  const now = new Date();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('timeout-but-settled: no resend after settlement appears', async () => {
    // Setup a pending payout
    const payout: Payout = {
      id: 1,
      supplier_key: 'supplier-123',
      amount: 1000,
      effective_date: now,
      txid: null,
      attempts: 0,
      state: PayoutState.pending,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    };
    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // First send returns transient error (timeout)
    bankService.send.mockResolvedValueOnce(BankSendResult.TRANSIENT_ERROR);
    // After the send, reconciliation will find the settlement
    const derivedTxId = deriveTxId(payout);
    const settlement: Settlement = {
      txid: derivedTxId,
      amount: payout.amount,
      date: now,
    };
    bankService.getStatement.mockResolvedValueOnce([settlement]);

    const service = new PayoutService(repository as any, bankService as any);

    // Execute initial send
    await service.executePayments();

    const afterSend = repository.getPayout(1)!;
    expect(afterSend.state).toBe(PayoutState.awaiting_evidence);
    expect(afterSend.attempts).toBe(1);
    expect(afterSend.txid).toBe(derivedTxId);
    expect(bankService.send).toHaveBeenCalledTimes(1);

    // Run reconciliation
    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    const afterReconcile = repository.getPayout(1)!;
    expect(afterReconcile.state).toBe(PayoutState.settled);
    // No additional send should have been made
    expect(bankService.send).toHaveBeenCalledTimes(1);
  });

  it('proven-absent: resend with same txid after publishing lag', async () => {
    // Payout already attempted once, awaiting evidence, last attempt > 30min ago
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
    const payout: Payout = {
      id: 2,
      supplier_key: 'supplier-abc',
      amount: 2000,
      effective_date: now,
      txid: null,
      attempts: 1,
      state: PayoutState.awaiting_evidence,
      last_attempt_at: past,
      created_at: past,
      updated_at: past,
    };
    // Compute deterministic txid and store it
    const derivedTxId = deriveTxId(payout);
    payout.txid = derivedTxId;

    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // Statement empty: prove absence
    bankService.getStatement.mockResolvedValueOnce([]);
    // Resend will be called and return ACCEPTED
    bankService.send.mockResolvedValueOnce(BankSendResult.ACCEPTED);

    const service = new PayoutService(repository as any, bankService as any);

    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    // Verify resend was attempted
    expect(bankService.send).toHaveBeenCalledTimes(1);
    const sendArg = bankService.send.mock.calls[0][0];
    expect(sendArg.txid).toBe(derivedTxId);
    // State should be updated to SENT and attempts incremented
    const after = repository.getPayout(2)!;
    expect(after.state).toBe(PayoutState.sent);
    expect(after.attempts).toBe(2);
    expect(after.last_attempt_at?.getTime()).toBeGreaterThan(past.getTime());
  });

  it('attempt exhaustion: park after 5 attempts with no settlement', async () => {
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const payout: Payout = {
      id: 3,
      supplier_key: 'supplier-xyz',
      amount: 3000,
      effective_date: now,
      txid: null,
      attempts: 5,
      state: PayoutState.awaiting_evidence,
      last_attempt_at: past,
      created_at: past,
      updated_at: past,
    };
    const derivedTxId = deriveTxId(payout);
    payout.txid = derivedTxId;

    const repository = new MockPayoutRepository([payout]);
    const bankService = new MockBankService();
    // No settlement in statement
    bankService.getStatement.mockResolvedValueOnce([]);

    const service = new PayoutService(repository as any, bankService as any);

    const window = { from: new Date(now.getTime() - 60 * 60 * 1000), to: new Date(now.getTime() + 60 * 60 * 1000) };
    await service.reconcile(window);

    // No resend should occur
    expect(bankService.send).not.toHaveBeenCalled();
    const after = repository.getPayout(3)!;
    expect(after.state).toBe(PayoutState.parked);
    expect(after.attempts).toBe(5);
  });
});
