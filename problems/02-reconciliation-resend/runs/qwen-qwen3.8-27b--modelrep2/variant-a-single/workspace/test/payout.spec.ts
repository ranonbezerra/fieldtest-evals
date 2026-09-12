import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { PayoutController } from '../src/payout/payout.controller.js';
import { PayoutService, deriveTxid } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import type { BankClient, BankSendResponse, StatementEntry } from '../src/payout/bank-client.types.js';
import type { ClaimResult, Order, ReconcileWindow, SendResult } from '../src/payout/order.types.js';
import { iterDays } from '../src/payout/date-window.js';

const T0 = Date.parse('2025-06-01T12:00:00Z');
const LAG = 30 * 60 * 1000;
const H = 60 * 60 * 1000;

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    supplierKey: 'key-supplier-1',
    amountMinor: 12500n,
    effectiveDate: '2025-06-01',
    state: 'PENDING',
    attempts: 0,
    txid: null,
    sentAt: null,
    absentConfirmedAt: null,
    lastError: null,
    ...overrides,
  };
}

// ---------- fakes ----------

class FakeRepo {
  orders: Order[];
  calls: { op: string; orderId: string }[] = [];

  constructor(orders: Order[] = []) {
    this.orders = orders.map((o) => ({ ...o }));
  }

  private get(id: string): Order {
    const o = this.orders.find((x) => x.id === id);
    if (!o) throw new Error(`no order ${id}`);
    return o;
  }

  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    return this.orders
      .filter(
        (o) =>
          o.state === 'PENDING' ||
          (o.state === 'FAILED' && o.absentConfirmedAt !== null && o.attempts < maxAttempts),
      )
      .map((o) => ({ ...o }));
  }

  async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    this.calls.push({ op: 'claim', orderId: id });
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') {
      return { ok: false, reason: 'already_claimed' };
    }
    o.state = 'SENT';
    o.attempts = o.state === 'SENT' ? o.attempts + 1 : 1; // note: state already flipped; see below
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    return { ok: true, order: { ...o } };
  }

  async sendResult(id: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    this.calls.push({ op: 'sendResult', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT') throw new Error('sendResult on non-SENT order');
    if (kind === 'success') o.lastError = note;
    else if (kind === 'permanent') {
      o.state = 'MANUAL_REVIEW';
      o.lastError = note;
    } else {
      o.state = 'FAILED';
      o.lastError = note;
    }
  }

  async findSettleCandidates(): Promise<Order[]> {
    return this.orders
      .filter((o) => (o.state === 'PENDING' || o.state === 'SENT' || o.state === 'FAILED') && o.txid !== null)
      .map((o) => ({ ...o }));
  }

  async settleMatched(id: string): Promise<number> {
    this.calls.push({ op: 'settle', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING' && o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'SETTLED';
    o.lastError = null;
    return 1;
  }

  async parkForReview(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'park', orderId: id });
    const o = this.get(id);
    if (o.state !== 'SENT' && o.state !== 'FAILED') return 0;
    o.state = 'MANUAL_REVIEW';
    o.lastError = note;
    return 1;
  }

  async failStalePending(id: string, note: string): Promise<number> {
    this.calls.push({ op: 'failStale', orderId: id });
    const o = this.get(id);
    if (o.state !== 'PENDING') return 0;
    o.state = 'FAILED';
    o.attempts += 1;
    o.lastError = note;
    return 1;
  }

  async confirmAbsent(id: string, at: Date): Promise<number> {
    this.calls.push({ op: 'absent', orderId: id });
    const o = this.get(id);
    if (o.state !== 'FAILED' || o.absentConfirmedAt !== null) return 0;
    o.absentConfirmedAt = at;
    return 1;
  }
}

// Fix the fake claim() attempt bump: PENDING starts at 0, FAILED already counted.
// (Implemented correctly below by restoring the original state before flipping.)
class CorrectFakeRepo extends FakeRepo {
  override async claim(id: string, txid: string, now: Date): Promise<ClaimResult> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'already_claimed' };
    if (o.state !== 'PENDING' && o.state !== 'FAILED') {
      return { ok: false, reason: 'already_claimed' };
    }
    const wasPending = o.state === 'PENDING';
    o.attempts = wasPending ? 1 : o.attempts + 1;
    o.state = 'SENT';
    o.txid = txid;
    o.sentAt = now;
    o.lastError = null;
    this.calls.push({ op: 'claim', orderId: id });
    return { ok: true, order: { ...o } };
  }
}

class FakeBank implements BankClient {
  sent: { txid: string; amountMinor: bigint; key: string }[] = [];
  statements = new Map<string, StatementEntry[]>();
  script: ((txid: string) => BankSendResponse)[] = [];
  defaultResponse: BankSendResponse = { ok: true, statusText: 'accepted' };
  statementCalls: string[] = [];

  pushResponse(r: BankSendResponse) {
    this.script.push(() => r);
  }

  async send(req: { txid: string; amountMinor: bigint; key: string }): Promise<BankSendResponse> {
    this.sent.push(req);
    const next = this.script.shift();
    return next ? next(req.txid) : this.defaultResponse;
  }

  async getStatement(date: string): Promise<StatementEntry[]> {
    this.statementCalls.push(date);
    return this.statements.get(date) ?? [];
  }
}

class FakeClock {
  private t: number;
  constructor(t: number) {
    this.t = t;
  }
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  set(ms: number) {
    this.t = ms;
  }
}

function buildService(repo: FakeRepo, bank: FakeBank, clock: FakeClock, maxAttempts = 5) {
  return new PayoutService(repo as unknown as PayoutRepository, bank, clock, { maxAttempts, lagMs: LAG });
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const window0 = (): ReconcileWindow => ({ from: day(T0), to: day(T0) });
const window1 = (): ReconcileWindow => ({ from: day(T0), to: day(T0 + 2 * 24 * 60 * 60 * 1000) });

// ---------- payout.service ----------

describe('PayoutService', () => {
  it('sends PENDING orders with a deterministic txid and parks nothing on accept', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const r = await svc.executePayments();
    expect(r).toEqual({ executed: 1, skipped: 0 });

    const expectedTxid = hash('ord-1|2025-06-01');
    expect(bank.sent).toHaveLength(1);
    expect(bank.sent[0]).toEqual({ txid: expectedTxid, amountMinor: 12500n, key: 'key-supplier-1' });
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(1);
    expect(repo.orders[0].txid).toBe(expectedTxid);
  });

  it('derives the txid purely from order id + effective date', () => {
    expect(deriveTxid('ord-1', '2025-06-01')).toBe(hash('ord-1|2025-06-01'));
    expect(deriveTxid('ord-1', '2025-06-02')).not.toBe(deriveTxid('ord-1', '2025-06-01'));
  });

  it('timeout-but-settled: reconciles to SETTLED and never resends', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // First attempt times out.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // No absent-confirmation yet (within publishing lag) -> not re-sent.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Reconcile a window that does not yet contain the settlement date.
    await svc.reconcile(window0());
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].absentConfirmedAt).toBeNull();

    // The statement shows the txid as settled -> advance to SETTLED.
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-02', [{ txid, amountMinor: 12500n, settledAt: '2025-06-02T09:00:00Z' }]);
    clock.advance(2 * H);
    const r = await svc.reconcile(window1());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // A later execute must not touch it.
    clock.advance(H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('proven-absent: reconciliation enables a retry with the same txid', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('FAILED');

    // Before the lag elapses, no retry.
    clock.advance(10 * 60 * 1000);
    expect((await svc.executePayments()).executed).toBe(0);

    // Past the lag with an empty statement: proven absent.
    clock.advance(25 * 60 * 1000); // 35 min after send
    const r = await svc.reconcile(window0());
    expect(r.absentConfirmed).toBe(1);
    expect(repo.orders[0].absentConfirmedAt).not.toBeNull();

    // Retry: same txid, attempt 2, succeeds this time.
    const first = bank.sent[0].txid;
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[1].txid).toBe(first);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].state).toBe('SENT');

    // Statement confirms -> settled.
    bank.statements.set('2025-06-01', [
      { txid: first, amountMinor: 12500n, settledAt: new Date(T0 + 40 * 60 * 1000).toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    const r3 = await svc.reconcile(window0());
    expect(r3.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('attempt exhaustion: parks for manual review after 5 proven-absent failures', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
      const r = await svc.executePayments();
      expect(r.executed).toBe(1);
      expect(repo.orders[0].state).toBe('FAILED');
      expect(repo.orders[0].attempts).toBe(attempt);

      // Prove absent so the next attempt is allowed (if any remain).
      clock.advance(35 * 60 * 1000);
      const rr = await svc.reconcile(window0());
      if (attempt < 5) {
        expect(rr.absentConfirmed).toBe(1);
      } else {
        expect(rr.parked).toBe(1);
        expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
      }
    }

    // No further execute or reconcile can move it; attempts stay at 5.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    const rr = await svc.reconcile(window1());
    expect(rr.parked).toBe(0);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].attempts).toBe(5);
  });

  it('a timeout on the 5th attempt settles instead of parking', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    // Four transient failures, each proven absent.
    for (let i = 0; i < 4; i += 1) {
      bank.pushResponse({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
      await svc.executePayments();
      clock.advance(35 * 60 * 1000);
      await svc.reconcile(window0());
    }
    expect(repo.orders[0].attempts).toBe(4);

    // 5th attempt times out; the statement still shows it settled.
    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    expect(repo.orders[0].attempts).toBe(5);
    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
    expect(repo.orders[0].lastError).toBeNull();
  });

  it('duplicate response: no extra attempt, no double count', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 'timeout', code: 'TIMEOUT' });
    await svc.executePayments();
    clock.advance(35 * 60 * 1000);
    await svc.reconcile(window0());

    // Retry hits the bank's idempotency store.
    bank.pushResponse({ ok: true, statusText: 'duplicate' });
    const r = await svc.executePayments();
    expect(r.executed).toBe(1);
    expect(repo.orders[0].state).toBe('SENT');
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].lastError).toContain('duplicate');

    bank.statements.set('2025-06-01', [
      { txid: bank.sent[0].txid, amountMinor: 12500n, settledAt: new Date().toISOString() },
    ]);
    clock.advance(10 * 60 * 1000);
    expect((await svc.reconcile(window0())).settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('permanent rejection: parked for manual review immediately', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.pushResponse({ ok: false, status: 422, code: 'INVALID_KEY', message: 'key not found' });
    await svc.executePayments();
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
    expect(repo.orders[0].lastError).toContain('INVALID_KEY');
    expect(repo.orders[0].attempts).toBe(1);

    // Never auto-reverted, never re-sent.
    clock.advance(6 * H);
    expect((await svc.executePayments()).executed).toBe(0);
    expect(bank.sent).toHaveLength(1);
  });

  it('amount mismatch in the statement parks instead of settling', async () => {
    const repo = new CorrectFakeRepo([makeOrder()]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    await svc.executePayments(); // accepted
    expect(repo.orders[0].state).toBe('SENT');

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 9999n, settledAt: new Date().toISOString() }]);
    clock.advance(35 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.settled).toBe(0);
    expect(r.mismatches).toBe(1);
    expect(repo.orders[0].state).toBe('MANUAL_REVIEW');
  });

  it('overlapping windows are idempotent: a second run changes nothing', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    const txid = hash('ord-1|2025-06-01');
    bank.statements.set('2025-06-01', [{ txid, amountMinor: 12500n, settledAt: new Date(T0).toISOString() }]);
    const first = await svc.reconcile(window0());
    expect(first.settled).toBe(1);
    expect(repo.orders[0].state).toBe('SETTLED');

    // Same window again, shifted, and overlapping.
    clock.advance(15 * 60 * 1000);
    const second = await svc.reconcile(window1());
    expect(second.settled).toBe(0);
    expect(second.absentConfirmed).toBe(0);
    expect(second.parked).toBe(0);
    expect(second.mismatches).toBe(0);
    expect(repo.orders[0].state).toBe('SETTLED');
  });

  it('a stale PENDING (crashed send) becomes FAILED via reconciliation and retries next round', async () => {
    const repo = new CorrectFakeRepo([
      makeOrder({ sentAt: new Date(T0), txid: hash('ord-1|2025-06-01') }),
    ]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.parked).toBe(1);
    expect(repo.orders[0].state).toBe('FAILED');
    expect(repo.orders[0].attempts).toBe(1);

    // Not yet proven absent at this instant? sentAt is 40 min old -> proven.
    // It is now retryable on the next execute.
    const r2 = await svc.executePayments();
    expect(r2.executed).toBe(1);
    expect(repo.orders[0].attempts).toBe(2);
    expect(repo.orders[0].txid).toBe(hash('ord-1|2025-06-01'));
  });

  it('unknown txids in the statement are ignored', async () => {
    const repo = new CorrectFakeRepo([makeOrder({ state: 'SENT', attempts: 1, txid: hash('ord-1|2025-06-01'), sentAt: new Date(T0) })]);
    const bank = new FakeBank();
    const clock = new FakeClock(T0);
    const svc = buildService(repo, bank, clock);

    bank.statements.set('2025-06-01', [
      { txid: 'unknown-txid', amountMinor: 100n, settledAt: new Date(T0).toISOString() },
    ]);
    clock.advance(40 * 60 * 1000);
    const r = await svc.reconcile(window0());
    expect(r.entries).toBe(1);
    expect(r.settled).toBe(0);
    expect(repo.orders[0].state).toBe('SENT');
  });

  it('iterDays covers inclusive calendar days', () => {
    expect([...iterDays('2025-06-01', '2025-06-01')]).toEqual(['2025-06-01']);
    expect([...iterDays('2025-06-01', '2025-06-03')]).toEqual(['2025-06-01', '2025-06-02', '2025-06-03']);
  });
});

// ---------- payout.controller ----------

describe('PayoutController', () => {
  async function buildController() {
    const service = {
      executePayments: vi.fn(async () => ({ executed: 1, skipped: 0 })),
      reconcile: vi.fn(async () => ({ scannedDays: 1, entries: 0, settled: 0, absentConfirmed: 0, parked: 0, mismatches: 0 })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: 'PayoutService', useValue: service }],
    }).compile();
    const controller = moduleRef.get(PayoutController);
    return { controller, service };
  }

  it('execute posts to the service', async () => {
    const { controller, service } = await buildController();
    const r = await controller.execute({});
    expect(r).toEqual({ executed: 1, skipped: 0 });
    expect(service.executePayments).toHaveBeenCalledTimes(1);
  });

  it('reconcile defaults to today when no window is given', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({});
    const today = new Date().toISOString().slice(0, 10);
    expect(service.reconcile).toHaveBeenCalledWith({ from: today, to: today });
  });

  it('reconcile forwards an explicit window', async () => {
    const { controller, service } = await buildController();
    await controller.reconcile({ from: '2025-06-01', to: '2025-06-02' });
    expect(service.reconcile).toHaveBeenCalledWith({ from: '2025-06-01', to: '2025-06-02' });
  });

  it('reconcile rejects a window whose start is after its end', async () => {
    const { controller } = await buildController();
    await expect(controller.reconcile({ from: '2025-06-02', to: '2025-06-01' })).rejects.toThrow(
      /start must not be after end/,
    );
  });
});
