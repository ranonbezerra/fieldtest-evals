import { describe, expect, it } from 'vitest';
import type {
  BankSendInput,
  BankSendResult,
  OrderState,
  PayoutOrderStore,
  Settlement,
} from '../src/payout/payout.types.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { deriveTxid } from '../src/payout/txid.util.js';

const CONFIG = { lagMs: 30 * 60_000, maxAttempts: 5 };
const T0 = new Date('2025-03-10T12:00:00.000Z');
const EFFECTIVE = new Date('2025-03-10T00:00:00.000Z');
const EFFECTIVE_KEY = '2025-03-10';
const WINDOW = {
  from: new Date('2025-03-09T00:00:00.000Z'),
  to: new Date('2025-03-10T00:00:00.000Z'),
};
const AMOUNT = 1_840_000; // €18,400.00, in minor units
const KEY = 'key_123';

interface Row {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastResult: string | null;
  rejectReason: string | null;
  parkedReason: string | null;
  settleTxid: string | null;
  settledAt: Date | null;
}

function makeOrder(overrides: { id: string } & Partial<Omit<Row, 'id'>>): Row {
  return {
    supplierKey: KEY,
    amountCents: AMOUNT,
    effectiveDate: EFFECTIVE,
    state: 'PENDING',
    attemptCount: 0,
    lastAttemptAt: null,
    lastResult: null,
    rejectReason: null,
    parkedReason: null,
    settleTxid: null,
    settledAt: null,
    ...overrides,
  };
}

class FakeBank {
  scripted: BankSendResult[] = [];
  sent: BankSendInput[] = [];
  statements = new Map<string, Settlement[]>();

  async send(input: BankSendInput): Promise<BankSendResult> {
    this.sent.push(input);
    const next = this.scripted.shift();
    if (!next) throw new Error('FakeBank: no scripted outcome left');
    return next;
  }

  async getStatement(dateKey: string): Promise<Settlement[]> {
    return this.statements.get(dateKey) ?? [];
  }
}

class FakeStore implements PayoutOrderStore {
  rows = new Map<string, Row>();

  seed(order: Row): void {
    this.rows.set(order.id, { ...order });
  }

  get(id: string): Row {
    const row = this.rows.get(id);
    if (!row) throw new Error(`FakeStore: unknown order ${id}`);
    return { ...row };
  }

  snapshot(): Record<string, Row> {
    const out: Record<string, Row> = {};
    for (const [id, row] of this.rows) out[id] = { ...row };
    return out;
  }

  async findPending() {
    return [...this.rows.values()].filter((r) => r.state === 'PENDING').map((r) => ({ ...r }));
  }

  async findReconcilable(from: Date, to: Date) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN') &&
          r.effectiveDate.getTime() >= from.getTime() &&
          r.effectiveDate.getTime() <= to.getTime(),
      )
      .map((r) => ({ ...r }));
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate') {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'IN_FLIGHT', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult });
    return true;
  }

  async markOutcomeUnknown(id: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'OUTCOME_UNKNOWN', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'transient' });
    return true;
  }

  async markRejected(id: string, at: Date, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'REJECTED', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'permanent', rejectReason: reason });
    return true;
  }

  async markSettled(id: string, txid: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || !(r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN')) return false;
    Object.assign(r, { state: 'SETTLED', settleTxid: txid, settledAt: at });
    return true;
  }

  async markPendingForResend(id: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'PENDING' });
    return true;
  }

  async markNeedsReview(id: string, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'NEEDS_REVIEW', parkedReason: reason });
    return true;
  }
}

describe('PayoutService.executePayments', () => {
  it('sends pending orders and classifies the four outcomes onto four distinct paths', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-acc' }));
    store.seed(makeOrder({ id: 'o-dup' }));
    store.seed(makeOrder({ id: 'o-trans' }));
    store.seed(makeOrder({ id: 'o-perm' }));
    bank.scripted.push(
      { outcome: 'accepted' },
      { outcome: 'duplicate' },
      { outcome: 'transient', detail: '503' },
      { outcome: 'permanent', reason: 'closed_beneficiary' },
    );
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.executePayments(T0);

    expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 1, permanent: 1 });
    expect(store.get('o-acc').state).toBe('IN_FLIGHT');
    expect(store.get('o-acc').lastResult).toBe('accepted');
    expect(store.get('o-dup').state).toBe('IN_FLIGHT');
    expect(store.get('o-dup').lastResult).toBe('duplicate');
    expect(store.get('o-trans').state).toBe('OUTCOME_UNKNOWN');
    expect(store.get('o-trans').lastResult).toBe('transient');
    expect(store.get('o-perm').state).toBe('REJECTED');
    expect(store.get('o-perm').lastResult).toBe('permanent');
    expect(store.get('o-perm').rejectReason).toBe('closed_beneficiary');
    for (const id of ['o-acc', 'o-dup', 'o-trans', 'o-perm']) {
      expect(store.get(id).attemptCount).toBe(1);
    }
    // Each send carried its order's own derived txid, amount and key.
    expect(bank.sent).toEqual([
      { txid: deriveTxid('o-acc', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-dup', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-trans', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-perm', EFFECTIVE), amount: AMOUNT, key: KEY },
    ]);
  });

  it('treats a transport throw from bank.send as an unknown outcome, not a trigger to act', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    bank.send = async (input) => {
      bank.sent.push(input);
      throw new Error('ECONNRESET');
    };
    store.seed(makeOrder({ id: 'o-err' }));
    const service = new PayoutService(store, bank, CONFIG);

    await service.executePayments(T0);

    const row = store.get('o-err');
    expect(row.state).toBe('OUTCOME_UNKNOWN');
    expect(row.attemptCount).toBe(1);

    // The send path does not act on not knowing: a second run sends nothing.
    await service.executePayments(new Date(T0.getTime() + 60_000));
    expect(bank.sent).toHaveLength(1);
  });
});

describe('PayoutService.reconcile', () => {
  it('settles a timed-out order that appears on the statement and never re-sends it', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-1' }));
    bank.scripted.push({ outcome: 'transient', detail: 'timeout' });
    const service = new PayoutService(store, bank, CONFIG);

    // The original send times out: outcome unknown, nothing else changes.
    await service.executePayments(T0);
    expect(store.get('order-1').state).toBe('OUTCOME_UNKNOWN');
    expect(store.get('order-1').attemptCount).toBe(1);

    // The bank's statement (published after the lag) shows the txid we sent.
    const txid = deriveTxid('order-1', EFFECTIVE);
    bank.statements.set(EFFECTIVE_KEY, [{ txid, key: KEY }]);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);

    expect(summary).toEqual({ settled: 1, rescheduled: 0, parked: 0 });
    const settled = store.get('order-1');
    expect(settled.state).toBe('SETTLED');
    expect(settled.settleTxid).toBe(txid);

    // No re-send: the send path has nothing left to do for this order.
    const sentBefore = bank.sent.length;
    await service.executePayments(new Date(afterLag.getTime() + 60_000));
    expect(bank.sent.length).toBe(sentBefore);
  });

  it('settles an in-flight order once its statement entry appears', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-set', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    bank.statements.set(EFFECTIVE_KEY, [{ txid: deriveTxid('o-set', EFFECTIVE), key: KEY }]);
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.reconcile(WINDOW, T0);

    expect(summary).toEqual({ settled: 1, rescheduled: 0, parked: 0 });
    const row = store.get('o-set');
    expect(row.state).toBe('SETTLED');
    expect(row.settleTxid).toBe(deriveTxid('o-set', EFFECTIVE));
    expect(row.settledAt).toBe(T0);
  });

  it('re-sends a proven-absent order past the lag with the same derived txid', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-2' }));
    bank.scripted.push({ outcome: 'transient', detail: 'timeout' });
    const service = new PayoutService(store, bank, CONFIG);

    await service.executePayments(T0);
    expect(store.get('order-2').state).toBe('OUTCOME_UNKNOWN');
    const firstTxid = bank.sent[0].txid;

    // Past the lag, the statement for the order's date is empty: proven absent.
    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);
    expect(summary).toEqual({ settled: 0, rescheduled: 1, parked: 0 });
    expect(store.get('order-2').state).toBe('PENDING');

    // The next send goes out with the same txid — the bank sees the same instruction.
    bank.scripted.push({ outcome: 'accepted' });
    await service.executePayments(new Date(afterLag.getTime() + 60_000));
    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[1].txid).toBe(firstTxid);
    expect(bank.sent[1].amount).toBe(AMOUNT);
    expect(store.get('order-2').state).toBe('IN_FLIGHT');
    expect(store.get('order-2').attemptCount).toBe(2);
  });

  it('does not act on an unknown outcome while the publishing lag has not passed', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-lag', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.reconcile(WINDOW, new Date(T0.getTime() + CONFIG.lagMs - 1_000));

    expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.get('o-lag').state).toBe('OUTCOME_UNKNOWN');
    expect(bank.sent).toHaveLength(0);
  });

  it('never re-sends an accepted in-flight order that is late on the statement', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-inflight', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    const service = new PayoutService(store, bank, CONFIG);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);

    expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.get('o-inflight').state).toBe('IN_FLIGHT');

    // The send path must not touch it either: a double payment is the incident.
    await service.executePayments(afterLag);
    expect(bank.sent).toHaveLength(0);
  });

  it('is idempotent across repeated and overlapping reconcile windows', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'a', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    store.seed(makeOrder({ id: 'b', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    store.seed(makeOrder({ id: 'c', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    bank.statements.set(EFFECTIVE_KEY, [{ txid: deriveTxid('a', EFFECTIVE), key: KEY }]);
    const service = new PayoutService(store, bank, CONFIG);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const first = await service.reconcile(WINDOW, afterLag);
    expect(first).toEqual({ settled: 1, rescheduled: 1, parked: 0 });
    const afterFirst = store.snapshot();

    // Run twice over the same window: identical state after both.
    const second = await service.reconcile(WINDOW, new Date(afterLag.getTime() + 60_000));
    expect(second).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.snapshot()).toEqual(afterFirst);

    // A shifted, overlapping window changes nothing either.
    const wider = { from: new Date('2025-03-08T00:00:00.000Z'), to: new Date('2025-03-11T00:00:00.000Z') };
    const third = await service.reconcile(wider, new Date(afterLag.getTime() + 120_000));
    expect(third).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.snapshot()).toEqual(afterFirst);
  });

  it('parks the order for manual review after five attempts and never auto-reverts it', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-5' }));
    const service = new PayoutService(store, bank, CONFIG);

    let clock = T0;
    let lastSummary = { settled: 0, rescheduled: 0, parked: 0 };
    for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
      bank.scripted.push({ outcome: 'transient', detail: `timeout ${attempt}` });
      await service.executePayments(clock);
      clock = new Date(clock.getTime() + CONFIG.lagMs + 60_000); // wait out the publishing lag
      lastSummary = await service.reconcile(WINDOW, clock);
      expect(store.get('order-5').attemptCount).toBe(attempt);
      if (attempt < CONFIG.maxAttempts) {
        expect(store.get('order-5').state).toBe('PENDING');
        expect(lastSummary.rescheduled).toBe(1);
      }
    }

    // The fifth proven-absent outcome parks the order instead of releasing it.
    expect(lastSummary.parked).toBe(1);
    const parked = store.get('order-5');
    expect(parked.state).toBe('NEEDS_REVIEW');
    expect(parked.parkedReason).toBe('send_attempts_exhausted');
    expect(parked.attemptCount).toBe(CONFIG.maxAttempts);

    // Every attempt used the same derived txid.
    expect(bank.sent).toHaveLength(CONFIG.maxAttempts);
    const txid = deriveTxid('order-5', EFFECTIVE);
    for (const sent of bank.sent) expect(sent.txid).toBe(txid);

    // Terminal: neither a further reconcile nor the send path touches it.
    const after = store.snapshot();
    const later = new Date(clock.getTime() + CONFIG.lagMs + 60_000);
    await service.reconcile(WINDOW, later);
    await service.executePayments(later);
    expect(store.snapshot()).toEqual(after);
    expect(bank.sent).toHaveLength(CONFIG.maxAttempts);
  });
});
