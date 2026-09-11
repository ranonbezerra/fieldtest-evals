import { describe, expect, it } from 'vitest';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../src/dates.js';
import {
  buildScheduledWindow,
  classifySend,
  deriveTxid,
  isPastPublishingLag,
  MAX_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
} from '../src/payout/payout.service.js';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/bank/bank-client.js';
import type { PayoutOrderRow, PayoutOrderStore, ResendRecord, SendRecord } from '../src/payout/payout.repository.js';

const DAY = (isoDate: string): Date => startOfUtcDay(new Date(`${isoDate}T00:00:00Z`));
const MINUTE = 60 * 1000;

const KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400.00 in minor units

function order(overrides: Partial<PayoutOrderRow> & Pick<PayoutOrderRow, 'id'>): PayoutOrderRow {
  return {
    supplierId: 'sup-1',
    key: KEY,
    amountMinor: AMOUNT,
    currency: 'EUR',
    effectiveDate: DAY('2025-01-15'),
    status: 'OUTCOME_UNKNOWN',
    txid: null,
    attemptCount: 1,
    lastAttemptAt: null,
    rejectionReason: null,
    settledAt: null,
    parkedAt: null,
    ...overrides,
  };
}

const AWAITING: PayoutOrderRow['status'][] = ['SENT', 'OUTCOME_UNKNOWN'];

/**
 * In-memory stand-in for the store contract. It mirrors the real store's
 * conditional-update semantics (transitions only apply from the expected
 * state), which is what the overlap-safety of reconcile relies on.
 */
class FakeOrderStore implements PayoutOrderStore {
  private readonly rows = new Map<string, PayoutOrderRow>();

  put(row: PayoutOrderRow): this {
    this.rows.set(row.id, { ...row });
    return this;
  }

  get(id: string): PayoutOrderRow {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`no order with id ${id}`);
    return { ...row };
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'PENDING' && row.attemptCount === 0)
      .map((row) => ({ ...row }));
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const days = new Set(effectiveDates.map((day) => day.getTime()));
    return [...this.rows.values()]
      .filter(
        (row) =>
          AWAITING.includes(row.status) &&
          row.txid !== null &&
          days.has(startOfUtcDay(row.effectiveDate).getTime()),
      )
      .map((row) => ({ ...row }));
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'PENDING' || row.attemptCount !== 0) return false;
    Object.assign(row, data, { attemptCount: 1 });
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status) || row.attemptCount !== expectedAttemptCount) {
      return false;
    }
    row.attemptCount += 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    Object.assign(row, data);
    return true;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'SETTLED';
    row.settledAt = at;
    return true;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'PARKED';
    row.parkedAt = at;
    return true;
  }
}

/** Scripted stand-in for the bank. */
class FakeBank implements BankClient {
  sent: BankSendRequest[] = [];
  private readonly queued: (BankSendResponse | Error)[] = [];
  private defaultResponse: BankSendResponse = { statusCode: 202, reason: '' };
  private readonly statements = new Map<string, Settlement[]>();

  queueSend(response: BankSendResponse | Error): this {
    this.queued.push(response);
    return this;
  }

  setSend(response: BankSendResponse | Error): this {
    this.defaultResponse = response;
    return this;
  }

  statementFor(isoDate: string, txids: string[]): this {
    this.statements.set(isoDate, txids.map((txid) => ({ txid })));
    return this;
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    this.sent.push({ ...request });
    const response = this.queued.shift() ?? this.defaultResponse;
    if (response instanceof Error) throw response;
    return response;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(toUtcYmd(date)) ?? [];
  }
}

describe('PayoutService', () => {
  describe('reconcile: a timed-out send that the statement proves landed', () => {
    it('settles the order and never re-sends it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const txid = deriveTxid('ord-1', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-1',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN', // the send timed out; the outcome is unknown
          lastAttemptAt: new Date(now.getTime() - 5 * MINUTE), // well inside the publishing lag
        }),
      );
      const bank = new FakeBank().statementFor(toUtcYmd(effectiveDate), [txid]);
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-1');
      expect(after.status).toBe('SETTLED');
      expect(after.settledAt).toEqual(now);
      expect(bank.sent).toEqual([]); // the timeout did not trigger a re-send
      expect(summary).toMatchObject({ settled: 1, resent: 0 });

      // A second run over the same window changes nothing.
      await service.reconcile(buildScheduledWindow(now), now);
      expect(store.get('ord-1').status).toBe('SETTLED');
      expect(bank.sent).toEqual([]);
    });
  });

  describe('reconcile: absence proven past the publishing lag', () => {
    it('re-sends with the same txid and the same amount', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-2', effectiveDate); // what the first (timed-out) send used
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-2',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'bank unavailable' });
      const service = new PayoutService(store, bank);

      await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // same txid, not a new one
      const after = store.get('ord-2');
      expect(after.attemptCount).toBe(2);
      expect(after.status).toBe('OUTCOME_UNKNOWN'); // the re-send failed again: record and wait
      expect(after.lastAttemptAt).toEqual(now);
    });

    it('does not re-send while the publishing lag has not elapsed', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-3', effectiveDate);
      const lastAttempt = new Date(now.getTime() - 5 * MINUTE);
      const store = new FakeOrderStore().put(
        order({ id: 'ord-3', effectiveDate, txid, status: 'OUTCOME_UNKNOWN', lastAttemptAt: lastAttempt }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([]);
      const after = store.get('ord-3');
      expect(after.status).toBe('OUTCOME_UNKNOWN');
      expect(after.attemptCount).toBe(1);
      expect(after.lastAttemptAt).toEqual(lastAttempt);
      expect(summary.stillAwaiting).toBe(1);
    });

    it('is idempotent when run repeatedly over the same window', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-4', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-4',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 2 * 60 * MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 202, reason: '' }); // the re-send is accepted
      const service = new PayoutService(store, bank);
      const window = buildScheduledWindow(now);

      await service.reconcile(window, now);
      const afterFirst = store.get('ord-4');
      expect(afterFirst.status).toBe('SENT');
      expect(afterFirst.attemptCount).toBe(2);
      expect(bank.sent).toHaveLength(1);

      // Same window, same instant: the fresh send is still inside its own lag.
      await service.reconcile(window, now);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);

      // The next scheduled run (15 minutes later) is still inside the lag.
      const nextRun = new Date(now.getTime() + 15 * MINUTE);
      await service.reconcile(buildScheduledWindow(nextRun), nextRun);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);
    });
  });

  describe('reconcile: attempt exhaustion', () => {
    it('parks the order for review once attempts are exhausted, and never reverts it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-5', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-5',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-5');
      expect(after.status).toBe('PARKED');
      expect(after.parkedAt).toEqual(now);
      expect(bank.sent).toEqual([]); // no sixth send
      expect(summary.parked).toBe(1);

      // A later overlapping run must not release or revert the parked order.
      const later = new Date(now.getTime() + 60 * MINUTE);
      await service.reconcile(buildScheduledWindow(later), later);
      expect(store.get('ord-5')).toEqual(after);
      expect(bank.sent).toEqual([]);

      // Even fresh statement evidence does not auto-release a parked order:
      // a human makes that call.
      bank.statementFor(toUtcYmd(effectiveDate), [txid]);
      await service.reconcile(buildScheduledWindow(later), later);
      expect(store.get('ord-5').status).toBe('PARKED');
    });

    it('makes the fifth attempt the last, then parks when it too is proven absent', async () => {
      const t0 = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-6', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-6',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS - 1, // four attempts so far
          lastAttemptAt: new Date(t0.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'still down' });
      const service = new PayoutService(store, bank);

      const first = await service.reconcile(buildScheduledWindow(t0), t0);
      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // the fifth attempt
      expect(store.get('ord-6').attemptCount).toBe(MAX_ATTEMPTS);
      expect(first.resent).toBe(0);
      expect(first.stillAwaiting).toBe(1);

      const t1 = new Date(t0.getTime() + PUBLISHING_LAG_MS + MINUTE);
      const second = await service.reconcile(buildScheduledWindow(t1), t1);
      const after = store.get('ord-6');
      expect(after.status).toBe('PARKED');
      expect(bank.sent).toHaveLength(1); // still only the fifth attempt
      expect(second.parked).toBe(1);
    });
  });

  describe('executePayments: the four send outcomes', () => {
    it('routes each outcome to its own state, deriving the txid for every order', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 9, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const ids = ['ord-a', 'ord-b', 'ord-c', 'ord-d', 'ord-e'];
      const store = new FakeOrderStore();
      for (const id of ids) {
        store.put(order({ id, effectiveDate, status: 'PENDING', attemptCount: 0 }));
      }
      const bank = new FakeBank()
        .queueSend({ statusCode: 202, reason: '' }) // accepted: in flight
        .queueSend({ statusCode: 409, reason: 'txid already known' }) // duplicate: success
        .queueSend({ statusCode: 503, reason: 'bank overloaded' }) // transient: unknown
        .queueSend(new Error('socket hang up')) // no answer at all: unknown
        .queueSend({ statusCode: 422, reason: 'blocked account' }); // permanent
      const service = new PayoutService(store, bank);

      const summary = await service.executePayments(now);

      expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 2, permanent: 1 });

      const byId = (id: string): PayoutOrderRow => store.get(id);
      expect(byId('ord-a').status).toBe('SENT');
      expect(byId('ord-b').status).toBe('SENT'); // a duplicate is a success, not an error
      expect(byId('ord-c').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-d').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-e').status).toBe('REJECTED');
      expect(byId('ord-e').rejectionReason).toBe('blocked account');
      for (const id of ids) {
        const row = byId(id);
        expect(row.txid).toBe(deriveTxid(id, effectiveDate));
        expect(row.attemptCount).toBe(1);
        expect(row.lastAttemptAt).toEqual(now);
      }
      expect(bank.sent.map((request) => request.txid)).toEqual(
        ids.map((id) => deriveTxid(id, effectiveDate)),
      );
    });
  });

  describe('txid derivation', () => {
    it('is deterministic per order and effective date, and changes with either', () => {
      const d1 = DAY('2025-01-15');
      expect(deriveTxid('ord-9', d1)).toBe(deriveTxid('ord-9', new Date(d1.getTime())));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-9', DAY('2025-01-16')));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-10', d1));
      expect(deriveTxid('ord-9', d1)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('classification and window helpers', () => {
    it('classifies raw bank responses into the four outcomes', () => {
      expect(classifySend({ statusCode: 201, reason: '' })).toBe('accepted');
      expect(classifySend({ statusCode: 409, reason: '' })).toBe('duplicate');
      expect(classifySend({ statusCode: 500, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 408, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 429, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 0, reason: 'timeout' })).toBe('transient');
      expect(classifySend({ statusCode: 400, reason: 'malformed' })).toBe('permanent');
      expect(classifySend({ statusCode: 403, reason: 'blocked account' })).toBe('permanent');
    });

    it('treats an order as past the lag exactly when the lag has elapsed since its last attempt', () => {
      const t = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS), t)).toBe(true);
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS + 1000), t)).toBe(false);
    });

    it('maps the scheduled window onto yesterday and today (UTC)', () => {
      const now = new Date(Date.UTC(2025, 0, 20, 0, 15, 0));
      const window = buildScheduledWindow(now);
      expect(window.from).toEqual(new Date(Date.UTC(2025, 0, 19, 0, 0, 0)));
      expect(window.to).toEqual(new Date(Date.UTC(2025, 0, 21, 0, 0, 0)));
      expect(window.to.getTime() - window.from.getTime()).toBe(2 * DAY_MS);
    });
  });
});
