import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 10_000,
    effective_date: new Date('2025-01-15T00:00:00.000Z'),
    txid: 'txid-1',
    status: 'pending' as string,
    attempt_count: 0,
    last_attempt_at: null as Date | null,
    settled_at: null as Date | null,
    ...overrides,
  };
}

function makeMockBank() {
  return {
    send: vi.fn<Promise<BankSendResponse>>(),
    getStatement: vi.fn<Promise<Settlement[]>>(),
  };
}

function makeMockRepo() {
  return {
    findPending: vi.fn(),
    findByTxid: vi.fn(),
    findInDoubtByEffectiveDate: vi.fn(),
    markSent: vi.fn(),
    markInDoubt: vi.fn(),
    markRejected: vi.fn(),
    markSettled: vi.fn(),
    markPendingForResend: vi.fn(),
    markParked: vi.fn(),
    incrementAttempt: vi.fn(),
    upsertSettlement: vi.fn(),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000,
  batchSize: 100,
  maxAttempts: 5,
};

// Stateful repository mock that mutates the order in place.
function makeStatefulRepo(order: Record<string, any>) {
  return {
    findPending: vi.fn(async (_limit: number) =>
      order.status === 'pending' ? [{ ...order }] : [],
    ),
    findByTxid: vi.fn(async (txid: string) =>
      order.txid === txid ? { ...order } : null,
    ),
    findInDoubtByEffectiveDate: vi.fn(async (date: Date) => {
      const d = new Date(date);
      const od = new Date(order.effective_date);
      if (
        order.status === 'in_doubt' &&
        d.getUTCFullYear() === od.getUTCFullYear() &&
        d.getUTCMonth() === od.getUTCMonth() &&
        d.getUTCDate() === od.getUTCDate()
      ) {
        return [{ ...order }];
      }
      return [];
    }),
    markSent: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) {
        order.status = 'sent';
        order.last_attempt_at = lastAttemptAt;
      }
    }),
    markInDoubt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) {
        order.status = 'in_doubt';
        order.last_attempt_at = lastAttemptAt;
      }
    }),
    markRejected: vi.fn(async (id: string) => {
      if (id === order.id) {
        order.status = 'rejected';
      }
    }),
    markSettled: vi.fn(async (id: string, settledAt: Date) => {
      if (id === order.id && (order.status === 'sent' || order.status === 'in_doubt')) {
        order.status = 'settled';
        order.settled_at = settledAt;
      }
    }),
    markPendingForResend: vi.fn(async (id: string) => {
      if (id === order.id && order.status === 'in_doubt') {
        order.status = 'pending';
      }
    }),
    markParked: vi.fn(async (id: string) => {
      if (id === order.id && order.status === 'pending') {
        order.status = 'parked_manual_review';
      }
    }),
    incrementAttempt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id && order.status === 'pending') {
        order.attempt_count += 1;
        order.last_attempt_at = lastAttemptAt;
        return order.attempt_count;
      }
      return 0;
    }),
    upsertSettlement: vi.fn(async () => {}),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let bank: ReturnType<typeof makeMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-16T01:00:00.000Z'));
    repo = makeMockRepo();
    bank = makeMockBank();
    service = new PaymentService(repo as any, bank as any, DEFAULT_OPTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── executePayments: response classification ──────────────────────────────

  describe('executePayments — response classification', () => {
    it('accepted response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
      expect(bank.send).toHaveBeenCalledWith(
        expect.objectContaining({ txid: order.txid, amount_minor_units: order.amount_minor_units }),
      );
    });

    it('duplicate response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'duplicate' });

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('transient error response transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'transient_error' });

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('timeout (rejected promise) transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockRejectedValue(new Error('Request timed out'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
    });

    it('permanent rejection transitions pending → rejected', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'permanent_rejection' });

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('attempt_count >= max parks the order without calling bank', async () => {
      const order = makeOrder({ attempt_count: 5 });
      repo.findPending.mockResolvedValue([order]);

      await service.executePayments();

      expect(repo.markParked).toHaveBeenCalledWith(order.id);
      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.incrementAttempt).not.toHaveBeenCalled();
    });

    it('concurrent increment (returns 0) skips the order', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(0);

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });
  });

  // ── reconcile: settlement matching ────────────────────────────────────────

  describe('reconcile — settlement matching', () => {
    it('found-in-statement transitions sent → settled', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(result.settled).toBe(1);
    });

    it('found-in-statement transitions in_doubt → settled (timeout-but-settled, no resend)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T20:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      // Even though the order is in_doubt, it was found in the statement,
      // so it must be settled, NOT marked pending for resend.
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
    });

    it('rejected orders are untouched by reconciliation', async () => {
      const order = makeOrder({ status: 'rejected' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
    });
  });

  // ── reconcile: proven-absent logic ────────────────────────────────────────

  describe('reconcile — proven-absent logic', () => {
    it('proven-absent transitions in_doubt → pending (same txid preserved)', async () => {
      // Statement is complete: now (2025-01-16T01:00) > endOfDay(2025-01-15) + 30 min
      // endOfDay = 2025-01-16T00:00, +30 min = 2025-01-16T00:30, now=01:00 ✓
      const order = makeOrder({ status: 'in_doubt' });

      // Statement does NOT contain the order's txid
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
      // The order's txid is unchanged (still txid-1 in the order object)
      expect(order.txid).toBe('txid-1');
    });

    it('statement not yet complete leaves in_doubt unchanged', async () => {
      // Set time BEFORE the publishing lag expires.
      // endOfDay(2025-01-15) = 2025-01-16T00:00, +30 min = 2025-01-16T00:30
      // Set now to 2025-01-15T12:00 — well before the threshold.
      vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

      const order = makeOrder({ status: 'in_doubt' });

      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('overlapping windows are idempotent', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockImplementation(async (txid: string) => {
        // First call: order is in_doubt, second call (after settle): settled
        return { ...order };
      });
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const window = {
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      };

      const first = await service.reconcile(window);
      expect(first.settled).toBe(1);

      // Reset mocks to simulate a second run where the order is already settled
      repo.findByTxid.mockResolvedValue({ ...order, status: 'settled' });

      const second = await service.reconcile(window);
      expect(second.settled).toBe(0);
      expect(repo.markSettled).toHaveBeenCalledTimes(1); // only from the first run
    });
  });

  // ── deriveTxid ────────────────────────────────────────────────────────────

  describe('deriveTxid', () => {
    it('is deterministic for the same input', () => {
      const date = new Date('2025-01-15T00:00:00.000Z');
      const a = service.deriveTxid('order-abc', date);
      const b = service.deriveTxid('order-abc', date);
      expect(a).toBe(b);
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(0);
    });

    it('yields different txids for different orders or dates', () => {
      const date = new Date('2025-01-15T00:00:00.000Z');
      const otherDate = new Date('2025-01-16T00:00:00.000Z');

      const a = service.deriveTxid('order-1', date);
      const b = service.deriveTxid('order-2', date);
      const c = service.deriveTxid('order-1', otherDate);

      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
    });
  });

  // ── Full lifecycle ────────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('timeout → reconcile proves absent → resend accepted → settle', async () => {
      const order = makeOrder();
      const statefulRepo = makeStatefulRepo(order);
      statefulBank: {
        // Re-create service with stateful repo
        const bank2 = makeMockBank();
        const service2 = new PaymentService(statefulRepo as any, bank2 as any, DEFAULT_OPTS);

        // Phase 1: execute → timeout → in_doubt
        bank2.send.mockRejectedValueOnce(new Error('timeout'));
        await service2.executePayments();
        expect(order.status).toBe('in_doubt');

        // Phase 2: reconcile → proven absent → pending
        // now = 2025-01-16T01:00, statement for 2025-01-15 is complete
        bank2.getStatement.mockResolvedValueOnce([]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('pending');

        // Phase 3: execute again → accepted → sent
        bank2.send.mockResolvedValueOnce({ status: 'accepted' });
        await service2.executePayments();
        expect(order.status).toBe('sent');

        // Phase 4: reconcile → found in statement → settled
        bank2.getStatement.mockResolvedValueOnce([
          {
            txid: order.txid,
            amount_minor_units: order.amount_minor_units,
            settled_at: new Date('2025-01-15T22:00:00.000Z'),
          },
        ]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('settled');
        expect(order.settled_at).toEqual(new Date('2025-01-15T22:00:00.000Z'));
      }
    });

    it('5 timeouts → parked_manual_review (never auto-reverts)', async () => {
      const order = makeOrder();
      const statefulRepo = makeStatefulRepo(order);
      const bank2 = makeMockBank();
      const service2 = new PaymentService(statefulRepo as any, bank2 as any, DEFAULT_OPTS);

      // 5 rounds: execute (timeout) + reconcile (proven absent)
      for (let i = 0; i < 5; i++) {
        bank2.send.mockRejectedValueOnce(new Error('timeout'));
        await service2.executePayments();
        expect(order.status).toBe('in_doubt');

        bank2.getStatement.mockResolvedValueOnce([]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('pending');
      }

      // After 5 attempts, attempt_count === 5 === maxAttempts
      expect(order.attempt_count).toBe(5);

      // 6th execute: should park, not send
      await service2.executePayments();
      expect(order.status).toBe('parked_manual_review');
      // bank.send was called exactly 5 times (once per attempt), not on the 6th
      expect(bank2.send).toHaveBeenCalledTimes(5);

      // A subsequent reconcile must not revert the parked order
      bank2.getStatement.mockResolvedValueOnce([]);
      await service2.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });
      expect(order.status).toBe('parked_manual_review');
    });
  });
});
