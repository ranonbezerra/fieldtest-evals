import { beforeEach, describe, expect, it } from 'vitest';
import { PayoutOrder } from '@prisma/client';

import {
  BankAck,
  BankPermanentError,
  BankSendRequest,
  BankTransientError,
  Settlement,
} from '../src/payout/bank-gateway.js';
import { Clock, PayoutConfig } from '../src/payout/payout.constants.js';
import { PayoutRepositoryApi } from '../src/payout/payout.repository.js';
import { CreateOrderInput, PayoutService, ReconcileWindow, deriveTxid } from '../src/payout/payout.service.js';

const LAG_MS = 30 * 60_000;
const WINDOW_MS = 45 * 60_000;
const MAX_ATTEMPTS = 5;

const CONFIG: PayoutConfig = {
  publishingLagMs: LAG_MS,
  maxAttempts: MAX_ATTEMPTS,
  reconcileIntervalMs: 15 * 60_000,
  reconcileWindowMs: WINDOW_MS,
};

class FakeClock implements Clock {
  private ms: number;

  constructor(start: Date) {
    this.ms = start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

class FakeBank {
  sendCalls: BankSendRequest[] = [];
  statements = new Map<string, Settlement[]>();
  onSend: (request: BankSendRequest) => BankAck = () => ({ outcome: 'accepted' });

  async send(request: BankSendRequest): Promise<BankAck> {
    this.sendCalls.push(request);
    return this.onSend(request);
  }

  async getStatement(date: string): Promise<Settlement[]> {
    return this.statements.get(date) ?? [];
  }
}

/**
 * In-memory stand-in for payout_orders with the same conditional-update
 * semantics: every transition only applies if the row is still in the
 * state the caller observed.
 */
class FakePayoutRepository implements PayoutRepositoryApi {
  private readonly rows = new Map<string, PayoutOrder>();
  private readonly fixedNow = new Date('2025-06-01T12:00:00.000Z');

  private copy(row: PayoutOrder): PayoutOrder {
    return { ...row };
  }

  private isAwaitingEvidence(status: string): boolean {
    return status === 'in_flight' || status === 'accepted' || status === 'unknown';
  }

  async create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder> {
    if (this.rows.has(input.id)) throw new Error('duplicate id');
    if ([...this.rows.values()].some((row) => row.txid === input.txid)) throw new Error('duplicate txid');
    const row: PayoutOrder = {
      id: input.id,
      supplierKey: input.supplierKey,
      amount: BigInt(input.amount),
      effectiveDate: input.effectiveDate,
      status: 'pending',
      attemptCount: 0,
      txid: input.txid,
      lastOutcome: null,
      lastAttemptAt: null,
      settledAt: null,
      note: null,
      createdAt: this.fixedNow,
      updatedAt: this.fixedNow,
    };
    this.rows.set(row.id, row);
    return this.copy(row);
  }

  async findById(id: string): Promise<PayoutOrder | null> {
    const row = this.rows.get(id);
    return row ? this.copy(row) : null;
  }

  async findPending(): Promise<PayoutOrder[]> {
    return [...this.rows.values()].filter((row) => row.status === 'pending').map((row) => this.copy(row));
  }

  async findAwaitingEvidence(): Promise<PayoutOrder[]> {
    return [...this.rows.values()].filter((row) => this.isAwaitingEvidence(row.status)).map((row) => this.copy(row));
  }

  async settle(id: string, observedAt: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status)) return false;
    row.status = 'settled';
    row.settledAt = observedAt;
    return true;
  }

  async claimSend(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'pending' || row.attemptCount !== 0) return false;
    row.status = 'in_flight';
    row.attemptCount = 1;
    row.lastAttemptAt = now;
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status) || row.attemptCount !== expectedAttemptCount) return false;
    row.status = 'in_flight';
    row.attemptCount = expectedAttemptCount + 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'in_flight' || row.attemptCount !== expectedAttemptCount) return false;
    row.status = data.status;
    row.lastOutcome = data.lastOutcome;
    return true;
  }

  async park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || !this.isAwaitingEvidence(row.status) || row.attemptCount !== expectedAttemptCount) return false;
    row.status = 'parked';
    row.lastOutcome = 'attempts_exhausted';
    row.note = reason;
    return true;
  }
}

let repo: FakePayoutRepository;
let bank: FakeBank;
let clock: FakeClock;
let service: PayoutService;

beforeEach(() => {
  repo = new FakePayoutRepository();
  bank = new FakeBank();
  clock = new FakeClock(new Date('2025-06-01T12:00:00.000Z'));
  service = new PayoutService(repo, bank, clock, CONFIG);
});

const SUPPLIER_KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400 in minor units
const EFFECTIVE_DATE = new Date('2025-06-01T09:00:00.000Z');

function windowNow(): ReconcileWindow {
  const now = clock.now();
  return { from: new Date(now.getTime() - WINDOW_MS), to: now };
}

function newOrder(overrides: Partial<CreateOrderInput> = {}): Promise<PayoutOrder> {
  return service.createOrder({
    supplierKey: SUPPLIER_KEY,
    amount: AMOUNT,
    effectiveDate: EFFECTIVE_DATE,
    ...overrides,
  });
}

describe('PayoutService', () => {
  it('settles a timed-out send found in the statement and never re-sends it', async () => {
    bank.onSend = () => {
      throw new BankTransientError('connect timeout');
    };
    const order = await newOrder();
    await service.executePayments();

    let current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown');
    expect(current?.attemptCount).toBe(1);

    // The bank publishes the settlement, carrying the txid we submitted.
    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT }]);
    clock.advance(LAG_MS + 60_000); // past the publishing lag

    const report = await service.reconcile(windowNow());

    current = await repo.findById(order.id);
    expect(current?.status).toBe('settled');
    expect(current?.settledAt).toBeInstanceOf(Date);
    expect(report.settled).toBe(1);
    expect(bank.sendCalls).toHaveLength(1); // no re-send: the statement proves it landed
  });

  it('re-sends a proven-absent order with the same derived txid', async () => {
    const order = await newOrder();
    const firstTxid = order.txid;

    let firstSend = true;
    bank.onSend = () => {
      if (firstSend) {
        firstSend = false;
        throw new BankTransientError('gateway timeout');
      }
      return { outcome: 'accepted' };
    };

    await service.executePayments();
    expect((await repo.findById(order.id))?.status).toBe('unknown');

    // Bank is reachable again; no statement entry exists for this txid.
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('accepted');
    expect(current?.attemptCount).toBe(2);
    expect(current?.txid).toBe(firstTxid); // same instruction, not a new payment
    expect(bank.sendCalls).toHaveLength(2);
    expect(bank.sendCalls[1]).toEqual({ txid: firstTxid, amount: AMOUNT, key: SUPPLIER_KEY });
  });

  it('parks an order after five attempts and never reverts the parking', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();

    await service.executePayments(); // attempt 1
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      clock.advance(LAG_MS + 60_000);
      await service.reconcile(windowNow());
      expect((await repo.findById(order.id))?.attemptCount).toBe(attempt);
    }

    // Fifth attempt recorded, still absent past the lag -> park, no sixth send.
    clock.advance(LAG_MS + 60_000);
    const report = await service.reconcile(windowNow());
    const parked = await repo.findById(order.id);
    expect(parked?.status).toBe('parked');
    expect(parked?.attemptCount).toBe(MAX_ATTEMPTS);
    expect(report.parked).toBe(1);
    expect(bank.sendCalls).toHaveLength(MAX_ATTEMPTS);

    // Later evidence does not auto-revert a parked order.
    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT }]);
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());
    expect((await repo.findById(order.id))?.status).toBe('parked');
    expect(bank.sendCalls).toHaveLength(MAX_ATTEMPTS);
  });

  it('makes no changes when reconcile is run twice over the same window', async () => {
    const settledOrder = await newOrder({ supplierKey: 'DE02120300000000202051', amount: 250_000 });
    const timedOutOrder = await newOrder();

    let timedOutFirst = true;
    bank.onSend = (request) => {
      if (request.txid === timedOutOrder.txid && timedOutFirst) {
        timedOutFirst = false;
        throw new BankTransientError('gateway timeout');
      }
      return { outcome: 'accepted' };
    };

    await service.executePayments(); // settledOrder: accepted, timedOutOrder: unknown
    bank.statements.set(settledOrder.effectiveDate.toISOString().slice(0, 10), [
      { txid: settledOrder.txid, amount: 250_000 },
    ]);
    clock.advance(LAG_MS + 60_000); // both past the lag

    await service.reconcile(windowNow()); // run 1: settles, resends the timed-out order
    const afterFirst = await Promise.all([repo.findById(settledOrder.id), repo.findById(timedOutOrder.id)]);
    const sendsAfterFirst = bank.sendCalls.length;

    await service.reconcile(windowNow()); // run 2: same window, same clock

    const afterSecond = await Promise.all([repo.findById(settledOrder.id), repo.findById(timedOutOrder.id)]);
    expect(afterSecond).toEqual(afterFirst);
    expect(bank.sendCalls).toHaveLength(sendsAfterFirst);
  });

  it('takes a distinct path for each of the four bank.send outcomes', async () => {
    const acceptedOrder = await newOrder({ supplierKey: 'DE4450010517548001', amount: 100_000 });
    const duplicateOrder = await newOrder({ supplierKey: 'DE4450010517548002', amount: 200_000 });
    const transientOrder = await newOrder({ supplierKey: 'DE4450010517548003', amount: 300_000 });
    const rejectedOrder = await newOrder({ supplierKey: 'DE4450010517548004', amount: 400_000 });

    bank.onSend = (request) => {
      if (request.txid === acceptedOrder.txid) return { outcome: 'accepted' };
      if (request.txid === duplicateOrder.txid) return { outcome: 'duplicate' };
      if (request.txid === transientOrder.txid) throw new BankTransientError('bank 503');
      throw new BankPermanentError('beneficiary account closed', 'BEN_CLOSED');
    };

    await service.executePayments();

    expect((await repo.findById(acceptedOrder.id))?.status).toBe('accepted');
    expect((await repo.findById(acceptedOrder.id))?.lastOutcome).toBe('accepted');
    // Duplicate is a success: the bank already has the instruction.
    expect((await repo.findById(duplicateOrder.id))?.status).toBe('accepted');
    expect((await repo.findById(duplicateOrder.id))?.lastOutcome).toBe('duplicate');
    // Transient: outcome unknown — recorded, no retry from the send path.
    expect((await repo.findById(transientOrder.id))?.status).toBe('unknown');
    expect((await repo.findById(transientOrder.id))?.lastOutcome).toBe('transient');
    // Permanent: terminal, a human decides next.
    expect((await repo.findById(rejectedOrder.id))?.status).toBe('rejected');
    expect((await repo.findById(rejectedOrder.id))?.lastOutcome).toBe('permanent_rejection');
    for (const id of [acceptedOrder.id, duplicateOrder.id, transientOrder.id, rejectedOrder.id]) {
      expect((await repo.findById(id))?.attemptCount).toBe(1);
    }

    // Reconciliation never retries a permanent rejection.
    clock.advance(LAG_MS + 60_000);
    await service.reconcile(windowNow());
    expect((await repo.findById(rejectedOrder.id))?.status).toBe('rejected');
    expect(bank.sendCalls.filter((call) => call.txid === rejectedOrder.txid)).toHaveLength(1);
  });

  it('neither settles nor re-sends when the statement amount does not match', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();
    await service.executePayments();

    const date = order.effectiveDate.toISOString().slice(0, 10);
    bank.statements.set(date, [{ txid: order.txid, amount: AMOUNT + 1 }]);
    clock.advance(LAG_MS + 60_000);
    const report = await service.reconcile(windowNow());

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown');
    expect(current?.attemptCount).toBe(1);
    expect(report.amountMismatches).toBe(1);
    expect(bank.sendCalls).toHaveLength(1);
  });

  it('aborts reconciliation when a statement fetch fails instead of proving absence', async () => {
    bank.onSend = () => {
      throw new BankTransientError('gateway timeout');
    };
    const order = await newOrder();
    await service.executePayments();
    clock.advance(LAG_MS + 60_000);

    bank.getStatement = async () => {
      throw new BankTransientError('statement endpoint returned 500');
    };
    await expect(service.reconcile(windowNow())).rejects.toThrow(BankTransientError);

    const current = await repo.findById(order.id);
    expect(current?.status).toBe('unknown'); // unchanged
    expect(bank.sendCalls).toHaveLength(1); // no re-send
  });

  it('derives the same txid for the same order on the same effective date', () => {
    const midnight = new Date('2025-06-01T00:00:00.000Z');
    const evening = new Date('2025-06-01T21:15:00.000Z'); // same UTC date
    expect(deriveTxid('order-1', midnight)).toBe(deriveTxid('order-1', evening));
    expect(deriveTxid('order-1', midnight)).not.toBe(deriveTxid('order-2', midnight));
    expect(deriveTxid('order-1', midnight)).not.toBe(deriveTxid('order-1', new Date('2025-06-02T00:00:00.000Z')));
  });

  it('rejects a reconcile window whose bounds are invalid', async () => {
    await expect(
      service.reconcile({
        from: new Date('2025-06-01T13:00:00.000Z'),
        to: new Date('2025-06-01T12:00:00.000Z'),
      }),
    ).rejects.toThrow('from < to');
  });
});
