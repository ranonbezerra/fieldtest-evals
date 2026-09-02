import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

const PAST_DATE = '2024-01-01';
const PAST_DATE_D = new Date('2024-01-01T00:00:00Z');

function order(over: Record<string, any> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'acct-1',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: PAST_DATE_D,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function mockRepo() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  };
}

function mockBank() {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function makeService(repo = mockRepo(), bank = mockBank()): PayoutsService {
  return new PayoutsService(repo as unknown as PayoutsRepository, bank as unknown as BankClient);
}

describe('executePayments', () => {
  it('accepted: transitions PENDING to IN_FLIGHT, stores txid, increments attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    expect(result.rejected).toBe(0);

    const [, from, to, patch] = repo.transition.mock.calls[0];
    expect(repo.transition.mock.calls[0][0]).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
    expect(patch.txid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('duplicate: transitions PENDING to IN_FLIGHT, increments attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'duplicate', originalAcceptedAt: new Date() });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    const [, from, to, patch] = repo.transition.mock.calls[0];
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
  });

  it('transient error: no transition, order remains PENDING with attempts unchanged', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'transient', reason: 'upstream timeout' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('permanent rejection: transitions PENDING to REJECTED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'permanent_rejection', code: 'BAD_KEY', reason: 'invalid key' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(1);
    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('REJECTED');
  });

  it('bank network error on send: treated as timeout, transitions to IN_FLIGHT with incremented attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockRejectedValue(new Error('ECONNRESET'));
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    const [id, from, to, patch] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
    expect(patch.txid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('reuses existing txid on resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    const existingTxid = 'a'.repeat(32);
    repo.findPending.mockResolvedValue([order({ txid: existingTxid, attempts: 1 })]);

    const service = makeService(repo, bank);
    await service.executePayments(PAST_DATE_D);

    expect(bank.send).toHaveBeenCalledWith(
      expect.objectContaining({ txid: existingTxid, amountCents: 5000, bankKey: 'acct-1' }),
    );
  });
});

describe('reconcile', () => {
  it('timeout-but-settled: IN_FLIGHT order found in statement is settled, no resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'b'.repeat(32);
    // Match phase: order is IN_FLIGHT and present in statement → settled
    // Absence phase: no remaining IN_FLIGHT orders
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid })])
      .mockResolvedValueOnce([]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(1);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('SETTLED');
  });

  it('proven-absent with attempts remaining: returns to PENDING, same txid retained', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'c'.repeat(32);
    // Match phase: not in statement
    // Absence phase: still IN_FLIGHT, past lag, attempts < 5 → PENDING
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(1);
    expect(result.parked).toBe(0);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('PENDING');
  });

  it('attempt exhaustion: IN_FLIGHT with attempts=5 past lag becomes PARKED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'd'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 5 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 5 })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(1);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('PARKED');
  });

  it('not-yet-past-lag: IN_FLIGHT order is left untouched', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    // Use today's date — past-lag threshold is tomorrow 00:30 UTC, so we are within lag
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayD = new Date(`${todayStr}T00:00:00Z`);
    const txid = 'e'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, effectiveDate: todayD })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, effectiveDate: todayD })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(todayStr);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('idempotency: second reconcile for same date yields zero counts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'f'.repeat(32);
    // Run 1 match: finds order, settles it
    // Run 1 absence: empty (order now SETTLED)
    // Run 2 match: empty (no IN_FLIGHT)
    // Run 2 absence: empty
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const first = await service.reconcile(PAST_DATE);
    const second = await service.reconcile(PAST_DATE);

    expect(first.settled).toBe(1);
    expect(second.settled).toBe(0);
    expect(second.provenAbsent).toBe(0);
    expect(second.parked).toBe(0);
  });

  it('amount mismatch: order is NOT settled and NOT treated as absent', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'g'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, amountCents: 5000 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, amountCents: 5000 })]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 6000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    // Order must not be moved to PENDING or PARKED either
    expect(repo.transition).not.toHaveBeenCalled();
  });
});

describe('deriveTxid', () => {
  it('is deterministic: same inputs produce the same 32-char hex string', () => {
    const service = makeService();
    // ASSUMPTION: deriveTxid is private; accessing via type assertion to unit-test the derivation contract.
    const derive = (service as unknown as { deriveTxid: (id: string, d: Date) => string }).deriveTxid;
    const a = derive('ord-1', PAST_DATE_D);
    const b = derive('ord-1', PAST_DATE_D);

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs for different order IDs', () => {
    const service = makeService();
    const derive = (service as unknown as { deriveTxid: (id: string, d: Date) => string }).deriveTxid;
    const a = derive('ord-1', PAST_DATE_D);
    const b = derive('ord-2', PAST_DATE_D);

    expect(a).not.toBe(b);
  });
});
