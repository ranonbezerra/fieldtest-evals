import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Order, SettlementRecord } from '@prisma/client';
import {
  BankCode,
  deriveTxid,
  toUtcDateKey,
  type BankClient,
  type BankSendRequest,
  type BankSendResult,
  type Settlement,
} from '../src/payout/bank.client.js';
import type { AttemptPatch, NewOrderInput } from '../src/payout/payout.repository.js';
import {
  MAX_SEND_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
  type ReconcileWindow,
} from '../src/payout/payout.service.js';

const MIN = 60_000;
const T0 = new Date('2025-03-10T09:00:00.000Z');
const EFFECTIVE_DATE = new Date('2025-03-10T00:00:00.000Z');
// Comfortably past the 30-minute publishing lag.
const PAST_LAG = PUBLISHING_LAG_MS + 15 * MIN;

/* ------------------------------------------------------------------ */
/* fakes                                                               */
/* ------------------------------------------------------------------ */

class FakeBank implements BankClient {
  sends: BankSendRequest[] = [];
  nextResult: BankSendResult = { type: 'response', code: BankCode.Accepted, message: 'accepted' };
  statements = new Map<string, Settlement[]>();

  send(request: BankSendRequest): Promise<BankSendResult> {
    this.sends.push({ ...request });
    return Promise.resolve(this.nextResult);
  }

  getStatement(date: string): Promise<Settlement[]> {
    return Promise.resolve(this.statements.get(date) ?? []);
  }
}

class FakeOrderRepository {
  orders = new Map<string, Order>();
  settlementRecords: SettlementRecord[] = [];

  create(input: NewOrderInput): Promise<Order> {
    const id = randomUUID();
    const order: Order = {
      id,
      supplierKey: input.supplierKey,
      amountMinor: input.amountMinor,
      effectiveDate: input.effectiveDate,
      txid: deriveTxid({
        id,
        effectiveDate: input.effectiveDate,
        amountMinor: input.amountMinor,
        supplierKey: input.supplierKey,
      }),
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      settledAt: null,
      parkedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.orders.set(id, order);
    return Promise.resolve(order);
  }

  findPending(): Promise<Order[]> {
    return Promise.resolve([...this.orders.values()].filter((o) => o.status === 'pending'));
  }

  findById(id: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(id) ?? null);
  }

  findByTxid(txid: string): Promise<Order | null> {
    return Promise.resolve([...this.orders.values()].find((o) => o.txid === txid) ?? null);
  }

  findUnknownReadyForEvidence(asOf: Date): Promise<Order[]> {
    return Promise.resolve(
      [...this.orders.values()].filter(
        (o) => o.status === 'unknown' && o.lastAttemptAt !== null && o.lastAttemptAt.getTime() <= asOf.getTime(),
      ),
    );
  }

  applyAttempt(id: string, patch: AttemptPatch): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, patch, { updatedAt: new Date() });
    return Promise.resolve(order);
  }

  settle(id: string, settledAt: Date): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, { status: 'settled', settledAt, updatedAt: new Date() });
    return Promise.resolve(order);
  }

  park(id: string, at: Date, reason: string): Promise<Order> {
    const order = this.require(id);
    Object.assign(order, {
      status: 'parked',
      parkedAt: at,
      lastOutcome: `parked:${reason}`,
      updatedAt: new Date(),
    });
    return Promise.resolve(order);
  }

  recordSettlement(input: {
    orderId: string;
    txid: string;
    statementDate: string;
    settledAt: Date;
  }): Promise<SettlementRecord> {
    const existing = this.settlementRecords.find((r) => r.txid === input.txid);
    if (existing) return Promise.resolve(existing);
    const row: SettlementRecord = {
      ...input,
      id: randomUUID(),
      recordedAt: new Date(),
    };
    this.settlementRecords.push(row);
    return Promise.resolve(row);
  }

  private require(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`unknown order ${id}`);
    return order;
  }
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

let now: Date;
let repo: FakeOrderRepository;
let bank: FakeBank;
let service: PayoutService;

beforeEach(() => {
  now = new Date(T0);
  repo = new FakeOrderRepository();
  bank = new FakeBank();
  service = new PayoutService(repo, bank, () => now);
});

async function makeOrder(overrides: Partial<NewOrderInput> = {}): Promise<Order> {
  return repo.create({
    supplierKey: 'DE893705000042203314',
    amountMinor: 1_840_000,
    effectiveDate: EFFECTIVE_DATE,
    ...overrides,
  });
}

function windowAround(asOf: Date, widthMs = 45 * MIN): ReconcileWindow {
  return { from: new Date(asOf.getTime() - widthMs), to: asOf };
}

function snapshot(): unknown {
  return {
    orders: [...repo.orders.values()].map((o) => ({ ...o })),
    settlementRecords: repo.settlementRecords.map((r) => ({ ...r })),
  };
}

async function failFirstSend(): Promise<void> {
  bank.nextResult = { type: 'failure', message: 'connect timeout' };
  await service.executePayments();
}

/* ------------------------------------------------------------------ */
/* txid derivation                                                     */
/* ------------------------------------------------------------------ */

describe('deriveTxid', () => {
  const base = { id: 'order-1', effectiveDate: EFFECTIVE_DATE, amountMinor: 100, supplierKey: 'key-1' };

  it('is deterministic: the same order on the same effective date always yields the same txid', () => {
    expect(deriveTxid(base)).toBe(deriveTxid({ ...base }));
    expect(deriveTxid(base)).toBe(deriveTxid({ ...base, effectiveDate: '2025-03-10' }));
  });

  it('changes when any input attribute changes', () => {
    expect(deriveTxid({ ...base, id: 'order-2' })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, effectiveDate: '2025-03-11' })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, amountMinor: 101 })).not.toBe(deriveTxid(base));
    expect(deriveTxid({ ...base, supplierKey: 'key-2' })).not.toBe(deriveTxid(base));
  });
});

/* ------------------------------------------------------------------ */
/* executePayments                                                     */
/* ------------------------------------------------------------------ */

describe('executePayments', () => {
  const cases: Array<{ name: string; result: BankSendResult; status: string; lastOutcome: string }> = [
    {
      name: 'accepted',
      result: { type: 'response', code: BankCode.Accepted, message: 'accepted' },
      status: 'in_flight',
      lastOutcome: 'accepted',
    },
    {
      name: 'duplicate (bank already held the instruction)',
      result: { type: 'response', code: BankCode.Duplicate, message: 'already held' },
      status: 'in_flight',
      lastOutcome: 'duplicate',
    },
    {
      name: 'transient error (outcome unknown)',
      result: { type: 'failure', message: 'connect timeout' },
      status: 'unknown',
      lastOutcome: 'transient',
    },
    {
      name: 'permanent rejection',
      result: { type: 'response', code: BankCode.RejectedBlockedAccount, message: 'blocked' },
      status: 'rejected',
      lastOutcome: `permanent:${BankCode.RejectedBlockedAccount}`,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: takes the ${c.status} path with one recorded attempt`, async () => {
      const order = await makeOrder();
      bank.nextResult = c.result;

      await service.executePayments();

      expect(order.status).toBe(c.status);
      expect(order.attempts).toBe(1);
      expect(order.lastOutcome).toBe(c.lastOutcome);
      expect(order.lastAttemptAt).toEqual(now);
      expect(bank.sends).toHaveLength(1);
      expect(bank.sends[0]).toEqual({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.supplierKey,
      });
    });
  }

  it('a permanently rejected order is terminal: reconciliation neither re-sends nor reverts it', async () => {
    const order = await makeOrder();
    bank.nextResult = { type: 'response', code: BankCode.RejectedClosedBeneficiary, message: 'closed' };
    await service.executePayments();
    expect(order.status).toBe('rejected');

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('rejected');
    expect(order.attempts).toBe(1);
    expect(order.parkedAt).toBeNull();
    expect(bank.sends).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* reconcile                                                           */
/* ------------------------------------------------------------------ */

describe('reconcile', () => {
  it('timeout-but-settled: settles the order from the statement and never re-sends it', async () => {
    const order = await makeOrder();
    await failFirstSend();
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(order.settledAt).toEqual(new Date(now.toISOString()));
    expect(order.attempts).toBe(1); // no second attempt was made
    expect(bank.sends).toHaveLength(1);
  });

  it('settles an accepted order once its entry reaches the statement', async () => {
    const order = await makeOrder();
    await service.executePayments(); // accepted by default
    expect(order.status).toBe('in_flight');

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [{ txid: order.txid, amount: order.amountMinor, date }]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(order.settledAt).toEqual(now); // no bank timestamp ⇒ as-of time
    expect(bank.sends).toHaveLength(1);
  });

  it('proven-absent: re-sends past the publication lag, with the same derived txid', async () => {
    const order = await makeOrder();
    await failFirstSend();
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    bank.nextResult = { type: 'response', code: BankCode.Accepted, message: 'accepted' };

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(bank.sends[1].txid).toBe(bank.sends[0].txid); // the same instruction, not a new payment
    expect(bank.sends[1]).toEqual({
      txid: order.txid,
      amount: order.amountMinor,
      key: order.supplierKey,
    });
  });

  it('does not re-send while the bank is still within the publication lag', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + 10 * MIN); // inside the 30-minute lag
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('unknown');
    expect(order.attempts).toBe(1);
    expect(bank.sends).toHaveLength(1);
  });

  it('treats a duplicate response on a proven-absent resend as success, not a new payment', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    bank.nextResult = { type: 'response', code: BankCode.Duplicate, message: 'already held' };

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(bank.sends[1].txid).toBe(bank.sends[0].txid);
  });

  it('parks for manual review when attempts are exhausted, and never sends a sixth time', async () => {
    const order = await makeOrder();
    await failFirstSend(); // attempt 1
    // Attempts 2..5 were made by earlier reconciles; every one left the
    // outcome unknown, as the bank never acknowledged.
    Object.assign(order, {
      status: 'unknown' as const,
      attempts: MAX_SEND_ATTEMPTS,
      lastAttemptAt: new Date(now.getTime() - PAST_LAG),
    });

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked');
    expect(order.parkedAt).toEqual(now);
    expect(order.lastOutcome).toBe('parked:attempts_exhausted');
    expect(bank.sends).toHaveLength(1); // no sixth attempt
  });

  it('retries at most five times across repeated reconciles, then parks without sending again', async () => {
    const order = await makeOrder();
    await failFirstSend(); // attempt 1

    for (let i = 0; i < 4; i += 1) {
      now = new Date(now.getTime() + PAST_LAG);
      await service.reconcile(windowAround(now));
    }
    expect(order.attempts).toBe(MAX_SEND_ATTEMPTS);
    expect(order.status).toBe('unknown');

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked');
    expect(order.parkedAt).toEqual(now);
    expect(bank.sends).toHaveLength(MAX_SEND_ATTEMPTS);
  });

  it('running twice over the same window leaves identical state (settled order)', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    const window = windowAround(now);
    await service.reconcile(window);
    const afterFirst = snapshot();

    await service.reconcile(window);
    const afterSecond = snapshot();

    expect(afterSecond).toEqual(afterFirst);
    expect(order.status).toBe('settled');
    expect(repo.settlementRecords).toHaveLength(1);
  });

  it('overlapping windows after a resend take no further action', async () => {
    const order = await makeOrder();
    await failFirstSend();

    now = new Date(now.getTime() + PAST_LAG);
    await service.reconcile(windowAround(now)); // proven absent → resend, accepted
    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    const afterFirst = snapshot();

    now = new Date(now.getTime() + 15 * MIN); // the next run, overlapping window
    await service.reconcile(windowAround(now));

    expect(order.status).toBe('in_flight');
    expect(order.attempts).toBe(2);
    expect(bank.sends).toHaveLength(2);
    expect(snapshot()).toEqual(afterFirst);
  });

  it('ignores statement entries that match no order, without failing the run', async () => {
    const order = await makeOrder();
    await service.executePayments(); // accepted → in_flight

    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [
      { txid: 'pay_000000000000000000000000000000000000000000000000000000000000', amount: 5, date },
      { txid: order.txid, amount: order.amountMinor, date, settledAt: now.toISOString() },
    ]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('settled');
    expect(repo.settlementRecords).toHaveLength(1);
    expect(repo.settlementRecords[0].orderId).toBe(order.id);
  });

  it('never touches parked orders, even if their txid later appears in the statement', async () => {
    const order = await makeOrder();
    Object.assign(order, {
      status: 'parked' as const,
      attempts: MAX_SEND_ATTEMPTS,
      lastAttemptAt: new Date(now.getTime() - PAST_LAG),
      parkedAt: new Date(now.getTime() - PAST_LAG),
      lastOutcome: 'parked:attempts_exhausted',
    });
    const date = toUtcDateKey(order.effectiveDate);
    bank.statements.set(date, [{ txid: order.txid, amount: order.amountMinor, date }]);

    await service.reconcile(windowAround(now));

    expect(order.status).toBe('parked'); // not reverted, not settled
    expect(order.settledAt).toBeNull();
    expect(repo.settlementRecords).toHaveLength(0);
    expect(bank.sends).toHaveLength(0);
  });
});
