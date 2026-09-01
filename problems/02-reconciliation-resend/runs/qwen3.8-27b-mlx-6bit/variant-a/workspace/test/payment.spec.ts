import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService, ReconcileWindow } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';
import type { OrderRecord } from '../src/payment/payment.repository';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 100,
    effective_date: new Date('2025-01-15'),
    txid: 'txid-1',
    status: 'pending',
    attempt_count: 0,
    last_attempt_at: null,
    settled_at: null,
    ...overrides,
  };
}

function makeRepoMock() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    findInDoubtByEffectiveDate: vi.fn().mockResolvedValue([]),
    markSent: vi.fn().mockResolvedValue(undefined),
    markInDoubt: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    markSettled: vi.fn().mockResolvedValue(undefined),
    markPendingForResend: vi.fn().mockResolvedValue(undefined),
    markParked: vi.fn().mockResolvedValue(undefined),
    incrementAttempt: vi.fn().mockResolvedValue(1),
    upsertSettlement: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBankMock() {
  return {
    send: vi.fn(),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000,
  batchSize: 100,
  maxAttempts: 5,
};

// A date far enough in the past that its statement is always complete.
const PAST_DATE = new Date('2025-01-15');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
  let repo: ReturnType<typeof makeRepoMock>;
  let bank: ReturnType<typeof makeBankMock>;
  let service: PaymentService;

  beforeEach(() => {
    repo = makeRepoMock();
    bank = makeBankMock();
    // ASSUMPTION: PaymentService and BankClient modules will exist per the plan manifest.
    service = new PaymentService(repo as any, bank as BankClient, DEFAULT_OPTS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── executePayments ──────────────────────────────────────────────────────

  describe('executePayments', () => {
    it('accepted response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'accepted' } satisfies BankSendResponse);

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        key: order.supplier_key,
      });
      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('duplicate response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'duplicate' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('transient error response transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'transient_error' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('timeout (rejected promise) transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('permanent rejection response transitions pending → rejected', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'permanent_rejection' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('attempt_count >= max parks the order without calling bank', async () => {
      const order = makeOrder({ attempt_count: 5 });
      repo.findPending.mockResolvedValue([order]);

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markParked).toHaveBeenCalledWith(order.id);
    });

    it('concurrent increment (0 rows affected) skips the order', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(0); // another worker won the race

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });
  });

  // ─── reconcile ────────────────────────────────────────────────────────────

  describe('reconcile', () => {
    it('found-in-statement transitions sent → settled', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(result.settled).toBe(1);
    });

    it('found-in-statement transitions in_doubt → settled (timeout-but-settled, no resend)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
    });

    it('proven-absent transitions in_doubt → pending (same txid preserved)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      // Statement is empty — the order's txid is absent.
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
    });

    it('statement not yet complete leaves in_doubt unchanged', async () => {
      // Use a future date so the statement is not yet complete.
      const futureDate = new Date('2099-01-01');
      const order = makeOrder({ status: 'in_doubt', effective_date: futureDate });

      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const window: ReconcileWindow = { startDate: futureDate, endDate: futureDate };
      const result = await service.reconcile(window);

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('overlapping windows are idempotent', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };

      // First run settles the order.
      await service.reconcile(window);
      expect(repo.markSettled).toHaveBeenCalledTimes(1);

      // Second run over the same window: findByTxid now returns a settled order.
      repo.findByTxid.mockResolvedValue(makeOrder({ status: 'settled' }));
      await service.reconcile(window);

      // markSettled should not be called again for an already-settled order.
      expect(repo.markSettled).toHaveBeenCalledTimes(1);
    });

    it('rejected orders are untouched by reconciliation', async () => {
      const order = makeOrder({ status: 'rejected' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(result.settled).toBe(0);
    });
  });

  // ─── deriveTxid ───────────────────────────────────────────────────────────

  describe('deriveTxid', () => {
    it('is deterministic for the same input', () => {
      const id = 'order-1';
      const date = new Date('2025-06-01');
      const a = service.deriveTxid(id, date);
      const b = service.deriveTxid(id, date);
      expect(a).toBe(b);
    });

    it('yields different txids for different orders or dates', () => {
      const date = new Date('2025-06-01');
      const txidA = service.deriveTxid('order-1', date);
      const txidB = service.deriveTxid('order-2', date);
      const txidC = service.deriveTxid('order-1', new Date('2025-06-02'));
      expect(txidA).not.toBe(txidB);
      expect(txidA).not.toBe(txidC);
    });
  });

  // ─── Full lifecycle ───────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('timeout → reconcile proves absent → resend accepted → settle', async () => {
      const order = makeOrder({ attempt_count: 0 });

      // Phase 1: executePayments — send times out.
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValueOnce(1);
      bank.send.mockRejectedValueOnce(new Error('timeout'));

      await service.executePayments();
      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));

      // Phase 2: reconcile — proven absent, order goes back to pending.
      const inDoubtOrder = makeOrder({ status: 'in_doubt', attempt_count: 1 });
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([inDoubtOrder]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      await service.reconcile(window);
      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);

      // Phase 3: executePayments — resend with same txid, accepted.
      const pendingOrder = makeOrder({ status: 'pending', attempt_count: 1 });
      repo.findPending.mockResolvedValue([pendingOrder]);
      repo.incrementAttempt.mockResolvedValueOnce(2);
      bank.send.mockResolvedValueOnce({ status: 'accepted' });

      await service.executePayments();
      expect(bank.send).toHaveBeenLastCalledWith({
        txid: order.txid, // same txid preserved
        amount_minor_units: order.amount_minor_units,
        key: order.supplier_key,
      });
      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));

      // Phase 4: reconcile — settlement found.
      const sentOrder = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00Z'),
      };
      repo.findByTxid.mockResolvedValue(sentOrder);
      bank.getStatement.mockResolvedValue([settlement]);

      await service.reconcile(window);
      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
    });

    it('5 timeouts → parked_manual_review', async () => {
      // Simulate 5 full cycles of: execute (timeout) + reconcile (proven absent).
      for (let attempt = 1; attempt <= 5; attempt++) {
        const orderForExecute = makeOrder({ status: 'pending', attempt_count: attempt - 1 });
        repo.findPending.mockResolvedValue([orderForExecute]);
        repo.incrementAttempt.mockResolvedValueOnce(attempt);
        bank.send.mockRejectedValueOnce(new Error('timeout'));

        await service.executePayments();
        expect(repo.markInDoubt).toHaveBeenCalledWith('order-1', expect.any(Date));

        // Reconcile: proven absent → back to pending.
        const inDoubtOrder = makeOrder({ status: 'in_doubt', attempt_count: attempt });
        bank.getStatement.mockResolvedValue([]);
        repo.findInDoubtByEffectiveDate.mockResolvedValue([inDoubtOrder]);

        const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
        await service.reconcile(window);
        expect(repo.markPendingForResend).toHaveBeenCalledWith('order-1');
      }

      // 6th executePayments: attempt_count is now 5, should park.
      const exhaustedOrder = makeOrder({ status: 'pending', attempt_count: 5 });
      repo.findPending.mockResolvedValue([exhaustedOrder]);

      await service.executePayments();
      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markParked).toHaveBeenCalledWith('order-1');
    });
  });
});
