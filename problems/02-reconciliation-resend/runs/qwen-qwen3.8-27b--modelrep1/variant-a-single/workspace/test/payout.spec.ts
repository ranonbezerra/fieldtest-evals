import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BankRequestError,
  type BankClient,
  type BankSendRequest,
  type BankSendResponse,
  type Settlement,
} from '../src/payout/bank.client.js';
import type { PayoutConfig } from '../src/payout/payout.config.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import { classifySendResponse, deriveTxid, PayoutService } from '../src/payout/payout.service.js';

// ---------------------------------------------------------------------------
// Test doubles. They mirror the guarded-update semantics of PayoutRepository
// and the logical interface of the bank, so the tests exercise PayoutService
// behaviour: resulting order states, attempt counts, and what actually gets
// sent to the bank.
// ---------------------------------------------------------------------------

const S = {
  PENDING: 'PENDING',
  AWAITING_SETTLEMENT: 'AWAITING_SETTLEMENT',
  RETRYABLE: 'RETRYABLE',
  SETTLED: 'SETTLED',
  NEEDS_MANUAL_REVIEW: 'NEEDS_MANUAL_REVIEW',
} as const;

interface OrderRow {
  id: string;
  supplierKey: string;
  amount: number;
  effectiveDate: Date;
  state: (typeof S)[keyof typeof S];
  txid: string | null;
  attempts: number;
  lastSendAt: Date | null;
  lastOutcome: string | null;
  resendEligibleAt: Date | null;
  parkedReason: string | null;
  settledAt: Date | null;
  settlementAmount: number | null;
}

class FakeRepo {
  private readonly rows = new Map<string, OrderRow>();

  add(row: OrderRow): void {
    this.rows.set(row.id, { ...row });
  }

  get(id: string): OrderRow {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no order ${id}`);
    return row;
  }

  findSendable(): OrderRow[] {
    return [...this.rows.values()].filter(
      (r) => r.state === S.PENDING || (r.state === S.RETRYABLE && r.resendEligibleAt !== null),
    );
  }

  findRetryable(): OrderRow[] {
    return [...this.rows.values()].filter((r) => r.state === S.RETRYABLE);
  }

  findByTxids(txids: string[]): OrderRow[] {
    return [...this.rows.values()].filter((r) => r.txid !== null && txids.includes(r.txid));
  }

  markAwaitingSettlement(
    id: string,
    data: { txid: string; attempts: number; lastSendAt: Date; lastOutcome: string },
  ): boolean {
    const r = this.rows.get(id);
    if (!r || (r.state !== S.PENDING && r.state !== S.RETRYABLE)) return false;
    r.state = S.AWAITING_SETTLEMENT;
    r.txid = data.txid;
    r.attempts = data.attempts;
    r.lastSendAt = data.lastSendAt;
    r.lastOutcome = data.lastOutcome;
    r.resendEligibleAt = null;
    return true;
  }

  markRetryable(id: string, data: { attempts: number; lastSendAt: Date; lastOutcome: string }): boolean {
    const r = this.rows.get(id);
    if (!r || (r.state !== S.PENDING && r.state !== S.RETRYABLE)) return false;
    r.state = S.RETRYABLE;
    r.attempts = data.attempts;
    r.lastSendAt = data.lastSendAt;
    r.lastOutcome = data.lastOutcome;
    r.resendEligibleAt = null;
    return true;
  }

  markParked(
    id: string,
    data: { reason: string; lastOutcome?: string; attempts?: number; lastSendAt?: Date },
  ): boolean {
    const r = this.rows.get(id);
    if (!r || (r.state !== S.PENDING && r.state !== S.RETRYABLE && r.state !== S.AWAITING_SETTLEMENT)) {
      return false;
    }
    r.state = S.NEEDS_MANUAL_REVIEW;
    r.parkedReason = data.reason;
    if (data.lastOutcome !== undefined) r.lastOutcome = data.lastOutcome;
    if (data.attempts !== undefined) r.attempts = data.attempts;
    if (data.lastSendAt !== undefined) r.lastSendAt = data.lastSendAt;
    return true;
  }

  markSettled(id: string, data: { settledAt: Date; settlementAmount: number }): boolean {
    const r = this.rows.get(id);
    if (
      !r ||
      (r.state !== S.AWAITING_SETTLEMENT &&
        r.state !== S.RETRYABLE &&
        r.state !== S.NEEDS_MANUAL_REVIEW)
    ) {
      return false;
    }
    r.state = S.SETTLED;
    r.settledAt = data.settledAt;
    r.settlementAmount = data.settlementAmount;
    return true;
  }

  markResendEligible(ids: string[], at: Date): number {
    let count = 0;
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r && r.state === S.RETRYABLE) {
        r.resendEligibleAt = at;
        count += 1;
      }
    }
    return count;
  }
}

class FakeBank implements BankClient {
  readonly sendCalls: BankSendRequest[] = [];
  private readonly statements = new Map<string, Settlement[]>();

  constructor(
    private readonly impl: (call: number, req: BankSendRequest) => BankSendResponse | Promise<BankSendResponse>,
  ) {}

  async send(req: BankSendRequest): Promise<BankSendResponse> {
    this.sendCalls.push(req);
    return this.impl(this.sendCalls.length, req);
  }

  setStatement(day: string, entries: Settlement[]): void {
    this.statements.set(day, entries);
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(date.toISOString().slice(0, 10)) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const LAG_MS = 30 * 60_000;
const T0 = new Date(Date.UTC(2025, 0, 20, 12, 0, 0)); // 2025-01-20T12:00Z
const DAY_START = new Date(Date.UTC(2025, 0, 20, 0, 0, 0));

const CONFIG: PayoutConfig = {
  maxAttempts: 5,
  publishingLagMs: LAG_MS,
  reconcileSpanMs: 24 * 60 * 60_000,
  bankApiBaseUrl: '',
  bankApiToken: '',
  bankRequestTimeoutMs: 1_000,
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'ord-1',
    supplierKey: 'key-1',
    amount: 12345, // 123.45, minor units
    effectiveDate: new Date(Date.UTC(2025, 0, 15)),
    state: S.PENDING,
    txid: null,
    attempts: 0,
    lastSendAt: null,
    lastOutcome: null,
    resendEligibleAt: null,
    parkedReason: null,
    settledAt: null,
    settlementAmount: null,
    ...overrides,
  };
}

function buildService(repo: FakeRepo, bank: FakeBank): PayoutService {
  return new PayoutService(repo as unknown as PayoutRepository, bank, CONFIG);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Unit-level behaviour
// ---------------------------------------------------------------------------

describe('classifySendResponse', () => {
  it('maps bank responses to accepted, duplicate, transient and permanent', () => {
    expect(classifySendResponse({ status: 'accepted' })).toBe('accepted');
    expect(classifySendResponse({ status: 'duplicate' })).toBe('duplicate');
    expect(classifySendResponse({ status: 'rejected', code: 'BANK_TIMEOUT' })).toBe('transient');
    expect(classifySendResponse({ status: 'rejected', code: 'RATE_LIMITED' })).toBe('transient');
    expect(classifySendResponse({ status: 'rejected', code: 'HTTP_503' })).toBe('transient');
    expect(classifySendResponse({ status: 'rejected', code: 'INVALID_KEY' })).toBe('permanent');
    expect(classifySendResponse({ status: 'rejected', code: 'HTTP_400' })).toBe('permanent');
  });
});

describe('deriveTxid', () => {
  it('is stable for order id + effective date and sensitive to both', () => {
    const a = deriveTxid('ord-1', new Date(Date.UTC(2025, 0, 15)));
    const b = deriveTxid('ord-1', new Date(Date.UTC(2025, 0, 15, 13, 45))); // same day, different time
    const c = deriveTxid('ord-1', new Date(Date.UTC(2025, 0, 16))); // different day
    const d = deriveTxid('ord-2', new Date(Date.UTC(2025, 0, 15))); // different order
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

// ---------------------------------------------------------------------------
// executePayments
// ---------------------------------------------------------------------------

describe('executePayments', () => {
  it('sends a pending order and awaits settlement on acceptance', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'accepted' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    const summary = await service.executePayments();

    expect(summary).toEqual({ sent: 1, accepted: 1, duplicates: 0, transient: 0, permanent: 0, parked: 0 });
    expect(bank.sendCalls).toEqual([
      { txid: deriveTxid(row.id, row.effectiveDate), amount: row.amount, key: row.supplierKey },
    ]);
    expect(repo.get(row.id)).toMatchObject({ state: S.AWAITING_SETTLEMENT, attempts: 1, lastOutcome: 'accepted' });
    expect(repo.get(row.id).lastSendAt?.getTime()).toBe(T0.getTime());
  });

  it('parks permanently rejected orders and never retries them', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'rejected', code: 'INVALID_KEY', message: 'unknown key' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    const first = await service.executePayments();
    expect(first).toMatchObject({ sent: 1, permanent: 1, parked: 1 });
    expect(repo.get(row.id)).toMatchObject({
      state: S.NEEDS_MANUAL_REVIEW,
      parkedReason: 'permanent_rejection',
      attempts: 1,
    });

    const second = await service.executePayments();
    expect(second.sent).toBe(0);
    expect(bank.sendCalls.length).toBe(1);
    expect(repo.get(row.id).state).toBe(S.NEEDS_MANUAL_REVIEW);
  });

  it('treats a duplicate response as confirmation of an earlier attempt, not a new one', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'duplicate' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    const summary = await service.executePayments();
    expect(summary).toMatchObject({ sent: 1, duplicates: 1, accepted: 0 });
    expect(repo.get(row.id)).toMatchObject({ state: S.AWAITING_SETTLEMENT, attempts: 0, lastOutcome: 'duplicate' });

    bank.setStatement(dayKey(T0), [
      { txid: deriveTxid(row.id, row.effectiveDate), amount: row.amount, timestamp: new Date(T0.getTime() + 60_000) },
    ]);
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const reconciled = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(reconciled.settled).toBe(1);
    expect(repo.get(row.id)).toMatchObject({ state: S.SETTLED, attempts: 0 });
  });
});

// ---------------------------------------------------------------------------
// The three required reconciliation scenarios
// ---------------------------------------------------------------------------

describe('reconciliation scenarios', () => {
  it('does not resend a timed-out order once the statement shows it settled', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => {
      throw new BankRequestError('timed out', true, 'BANK_TIMEOUT');
    });
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);
    const txid = deriveTxid(row.id, row.effectiveDate);

    const first = await service.executePayments();
    expect(first).toEqual({ sent: 1, accepted: 0, duplicates: 0, transient: 1, permanent: 0, parked: 0 });
    expect(repo.get(row.id)).toMatchObject({ state: S.RETRYABLE, attempts: 1, lastOutcome: 'transient', txid });
    expect(repo.get(row.id).lastSendAt?.getTime()).toBe(T0.getTime());

    // The bank actually settled the payment; the statement shows it past the lag.
    const settledAt = new Date(T0.getTime() + 60_000);
    bank.setStatement(dayKey(T0), [{ txid, amount: row.amount, timestamp: settledAt }]);
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const summary = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(summary).toMatchObject({ settled: 1, provenAbsent: 0 });
    expect(repo.get(row.id)).toMatchObject({ state: S.SETTLED, settlementAmount: row.amount });
    expect(repo.get(row.id).settledAt?.getTime()).toBe(settledAt.getTime());

    // No resend: the order is settled, not retryable.
    const second = await service.executePayments();
    expect(second.sent).toBe(0);
    expect(bank.sendCalls.length).toBe(1);
  });

  it('resends a proven-absent order with the same txid, and only past the publishing lag', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank((call) => {
      if (call === 1) throw new BankRequestError('timed out', true, 'BANK_TIMEOUT');
      return { status: 'accepted' };
    });
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    await service.executePayments();
    expect(repo.get(row.id)).toMatchObject({ state: S.RETRYABLE, attempts: 1 });

    // Not past the publishing lag yet: not eligible, and nothing may be sent.
    const early = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS - 60_000) });
    expect(early.provenAbsent).toBe(0);
    expect(repo.get(row.id).resendEligibleAt).toBeNull();
    expect((await service.executePayments()).sent).toBe(0);

    // Past the lag, and the statement has no trace of the txid: proven absent.
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const late = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(late.provenAbsent).toBe(1);

    const second = await service.executePayments();
    expect(second).toEqual({ sent: 1, accepted: 1, duplicates: 0, transient: 0, permanent: 0, parked: 0 });
    expect(bank.sendCalls.length).toBe(2);
    expect(bank.sendCalls[1].txid).toBe(bank.sendCalls[0].txid);
    expect(bank.sendCalls[1].txid).toBe(deriveTxid(row.id, row.effectiveDate));
    expect(bank.sendCalls[1]).toMatchObject({ amount: row.amount, key: row.supplierKey });
    expect(repo.get(row.id)).toMatchObject({ state: S.AWAITING_SETTLEMENT, attempts: 2, lastOutcome: 'accepted' });
    expect(repo.get(row.id).resendEligibleAt).toBeNull();
    expect(repo.get(row.id).lastSendAt?.getTime()).toBe(T0.getTime() + 2 * LAG_MS);
  });

  it('parks an order for manual review after 5 failed attempts and never auto-reverts it', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => {
      throw new BankRequestError('timed out', true, 'BANK_TIMEOUT');
    });
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    let nowMs = T0.getTime();
    for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt += 1) {
      vi.setSystemTime(new Date(nowMs));
      await service.executePayments();
      const current = repo.get(row.id);
      if (attempt < CONFIG.maxAttempts) {
        expect(current).toMatchObject({ state: S.RETRYABLE, attempts: attempt });
        // Prove absence so the next attempt is allowed.
        const to = new Date((current.lastSendAt?.getTime() ?? nowMs) + LAG_MS + 60_000);
        vi.setSystemTime(new Date(to.getTime() + 60_000)); // wall clock past the claimed horizon
        const summary = await service.reconcile({ from: DAY_START, to });
        expect(summary.provenAbsent).toBe(1);
        nowMs = to.getTime() + 60_000;
      } else {
        expect(current).toMatchObject({
          state: S.NEEDS_MANUAL_REVIEW,
          attempts: CONFIG.maxAttempts,
          parkedReason: 'attempts_exhausted',
        });
      }
    }

    // The parked order is dead to both jobs, no matter how much time passes.
    const finalNow = new Date(nowMs + 2 * LAG_MS);
    vi.setSystemTime(finalNow);
    await service.reconcile({ from: DAY_START, to: new Date(finalNow.getTime() - LAG_MS) });
    const again = await service.executePayments();
    expect(again.sent).toBe(0);
    expect(bank.sendCalls.length).toBe(CONFIG.maxAttempts);
    expect(repo.get(row.id)).toMatchObject({ state: S.NEEDS_MANUAL_REVIEW, parkedReason: 'attempts_exhausted' });
  });
});

// ---------------------------------------------------------------------------
// reconcile() robustness
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  it('reprocesses overlapping windows without double-settling', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'accepted' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    await service.executePayments();
    const entryTs = new Date(T0.getTime() + 120_000);
    bank.setStatement(dayKey(T0), [
      { txid: deriveTxid(row.id, row.effectiveDate), amount: row.amount, timestamp: entryTs },
    ]);

    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const first = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(first).toMatchObject({ settled: 1, entries: 1 });
    expect(repo.get(row.id).settledAt?.getTime()).toBe(entryTs.getTime());

    // Overlapping window, same day re-read: no state change, no double count.
    vi.setSystemTime(new Date(T0.getTime() + 3 * LAG_MS));
    const second = await service.reconcile({
      from: new Date(T0.getTime() - 3 * 3_600_000),
      to: new Date(T0.getTime() + 2 * LAG_MS),
    });
    expect(second).toMatchObject({ settled: 0, entries: 1 });
    expect(repo.get(row.id)).toMatchObject({ state: S.SETTLED, attempts: 1 });
    expect(repo.get(row.id).settledAt?.getTime()).toBe(entryTs.getTime());
  });

  it('parks an order when the statement amount does not match', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'accepted' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    await service.executePayments();
    bank.setStatement(dayKey(T0), [
      { txid: deriveTxid(row.id, row.effectiveDate), amount: row.amount + 1, timestamp: new Date(T0.getTime() + 60_000) },
    ]);
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const summary = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(summary).toMatchObject({ settled: 0, parked: 1 });
    expect(repo.get(row.id)).toMatchObject({ state: S.NEEDS_MANUAL_REVIEW, parkedReason: 'amount_mismatch' });
    expect(repo.get(row.id).settledAt).toBeNull();
  });

  it('ignores statement entries that match no order', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'accepted' }));
    const service = buildService(repo, bank);
    const row = makeOrder();
    repo.add(row);

    bank.setStatement(dayKey(T0), [{ txid: 'someone-else', amount: 1, timestamp: new Date(T0.getTime() + 60_000) }]);
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const summary = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(summary).toMatchObject({ unmatched: 1, settled: 0, parked: 0 });
    expect(repo.get(row.id)).toMatchObject({ state: S.AWAITING_SETTLEMENT });
  });

  it('settles a parked order once the statement proves the money moved', async () => {
    const repo = new FakeRepo();
    const bank = new FakeBank(() => ({ status: 'duplicate' }));
    const service = buildService(repo, bank);
    const row = makeOrder({ state: S.NEEDS_MANUAL_REVIEW, parkedReason: 'attempts_exhausted', attempts: 5 });
    row.txid = deriveTxid(row.id, row.effectiveDate);
    repo.add(row);

    bank.setStatement(dayKey(T0), [
      { txid: row.txid, amount: row.amount, timestamp: new Date(T0.getTime() + 60_000) },
    ]);
    vi.setSystemTime(new Date(T0.getTime() + 2 * LAG_MS));
    const summary = await service.reconcile({ from: DAY_START, to: new Date(T0.getTime() + LAG_MS + 60_000) });
    expect(summary.settled).toBe(1);
    expect(repo.get(row.id)).toMatchObject({ state: S.SETTLED, settlementAmount: row.amount });
  });
});
