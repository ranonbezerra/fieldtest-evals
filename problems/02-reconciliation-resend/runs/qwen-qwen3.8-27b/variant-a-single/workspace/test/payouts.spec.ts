import { describe, expect, it, vi } from 'vitest';
import { ParkReason, PayoutStatus } from '@prisma/client';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/bank/bank.client';
import type { PayoutTransitionData, PayoutsRepository } from '../src/payouts/payouts.repository';
import { MAX_SEND_ATTEMPTS, PayoutsService, classifySendResponse, deriveTxid } from '../src/payouts/payouts.service';
import type { PayoutsConfig } from '../src/payouts/payouts.service';

const PUBLISHING_LAG_MS = 30 * 60_000;

function makeConfig(overrides: Partial<PayoutsConfig> = {}): PayoutsConfig {
  return { publishingLagMs: PUBLISHING_LAG_MS, sendBatchSize: 100, ...overrides };
}

function minsAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/** A window ending 31 minutes ago: safely past the 30-minute publishing lag. */
function windowPastLag(): { from: Date; to: Date } {
  return { from: minsAgo(90), to: minsAgo(31) };
}

interface FakePayout {
  id: string;
  supplierKey: string;
  amountMinor: number;
  effectiveDate: Date;
  status: PayoutStatus;
  attempts: number;
  txid: string;
  parkReason: ParkReason | null;
  lastAttemptAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * In-memory implementation of the repository contract. It is the "database" of
 * these tests, so asserting on its rows is asserting on persisted state.
 */
class FakePayoutsRepository {
  readonly orders = new Map<string, FakePayout>();
  private seq = 0;

  create(data: {
    id: string;
    supplierKey: string;
    amountMinor: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<FakePayout> {
    const order: FakePayout = {
      id: data.id,
      supplierKey: data.supplierKey,
      amountMinor: data.amountMinor,
      effectiveDate: data.effectiveDate,
      status: PayoutStatus.pending,
      attempts: 0,
      txid: data.txid,
      parkReason: null,
      lastAttemptAt: null,
      settledAt: null,
      createdAt: new Date(++this.seq),
      updatedAt: new Date(),
    };
    this.orders.set(order.id, order);
    return Promise.resolve(order);
  }

  findToSend(batchSize: number): Promise<FakePayout[]> {
    const eligible = [...this.orders.values()]
      .filter((o) => o.status === PayoutStatus.pending || o.status === PayoutStatus.retryable)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(eligible.slice(0, batchSize));
  }

  findInFlightAttemptedBefore(to: Date): Promise<FakePayout[]> {
    const rows = [...this.orders.values()].filter(
      (o) =>
        o.status === PayoutStatus.in_flight &&
        o.lastAttemptAt !== null &&
        o.lastAttemptAt.getTime() <= to.getTime(),
    );
    return Promise.resolve(rows);
  }

  findUnsettledByTxids(txids: string[]): Promise<FakePayout[]> {
    const rows = [...this.orders.values()].filter(
      (o) => o.status !== PayoutStatus.settled && txids.includes(o.txid),
    );
    return Promise.resolve(rows);
  }

  transition(id: string, from: PayoutStatus[], data: PayoutTransitionData): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || !from.includes(order.status)) return Promise.resolve(false);
    order.status = data.status;
    if (data.attempts !== undefined) order.attempts += data.attempts.increment;
    if (data.parkReason !== undefined) order.parkReason = data.parkReason;
    if (data.lastAttemptAt !== undefined) order.lastAttemptAt = data.lastAttemptAt;
    if (data.settledAt !== undefined) order.settledAt = data.settledAt;
    order.updatedAt = new Date();
    return Promise.resolve(true);
  }
}

function makeFakeBank() {
  const sentRequests: BankSendRequest[] = [];
  const bank = {
    sentRequests,
    send: vi.fn(async (request: BankSendRequest): Promise<BankSendResponse> => {
      sentRequests.push(request);
      return { status: 200 };
    }),
    getStatement: vi.fn(async (_date: Date): Promise<Settlement[]> => []),
  };
  return bank;
}

type FakeBank = ReturnType<typeof makeFakeBank>;

function harness(config: PayoutsConfig = makeConfig()) {
  const bank = makeFakeBank();
  const repo = new FakePayoutsRepository();
  const service = new PayoutsService(
    repo as unknown as PayoutsRepository,
    bank as unknown as BankClient,
    config,
  );
  return { bank, repo, service };
}

/** Make every send time out (unknown outcome), still recording what was sent. */
function timeoutBank(bank: FakeBank): void {
  bank.send.mockImplementation(async (request: BankSendRequest): Promise<BankSendResponse> => {
    bank.sentRequests.push(request);
    throw new Error('connection timed out');
  });
}

async function seedOrder(service: PayoutsService, amountMinor = 10_000): Promise<FakePayout> {
  return service.createOrder({
    supplierKey: '00123456789012',
    amountMinor,
    effectiveDate: new Date('2025-06-01T00:00:00Z'),
  });
}

describe('payouts: execute + reconcile', () => {
  it('settles a timed-out order when the statement shows it, and never re-sends it', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service, 150_000);

    // First send times out: the outcome is unknown, so the order is in flight.
    timeoutBank(bank);
    await service.executePayments();
    expect(order.status).toBe(PayoutStatus.in_flight);
    expect(order.attempts).toBe(1);

    // While the outcome is unknown, it must not be re-sent.
    expect((await service.executePayments()).attempted).toBe(0);

    // Time passes: the attempt is now older than the publishing lag.
    order.lastAttemptAt = minsAgo(45);

    // The bank's statement shows the payment settled, under our txid.
    const settledAt = minsAgo(40);
    bank.getStatement.mockImplementation(async (): Promise<Settlement[]> => [
      { txid: order.txid, amount: order.amountMinor, settledAt },
    ]);
    const result = await service.reconcile(windowPastLag());

    expect(result.settled).toBe(1);
    expect(order.status).toBe(PayoutStatus.settled);
    expect(order.settledAt).toEqual(settledAt);

    // Still never re-sent afterwards.
    const after = await service.executePayments();
    expect(after.attempted).toBe(0);
    expect(order.status).toBe(PayoutStatus.settled);
    expect(order.attempts).toBe(1);
    expect(bank.send).toHaveBeenCalledTimes(1);
  });

  it('re-sends a proven-absent order, reusing the same deterministic txid', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service, 75_500);
    expect(order.txid).toBe(deriveTxid(order.id, order.effectiveDate));

    // First send times out.
    timeoutBank(bank);
    await service.executePayments();
    expect(order.status).toBe(PayoutStatus.in_flight);

    // No re-send before there is proof of absence.
    expect((await service.executePayments()).attempted).toBe(0);

    // The statement (fully published) is empty: the send is proven absent.
    order.lastAttemptAt = minsAgo(45);
    const result = await service.reconcile(windowPastLag());
    expect(result.provenAbsent).toBe(1);
    expect(result.settled).toBe(0);
    expect(order.status).toBe(PayoutStatus.retryable);

    // Now it may be re-sent — and must reuse the same txid.
    const resends = await service.executePayments();
    expect(resends.attempted).toBe(1);
    expect(resends.accepted).toBe(1);
    expect(order.status).toBe(PayoutStatus.sent);
    expect(order.attempts).toBe(2);
    expect(bank.sentRequests.length).toBe(2);
    expect(bank.sentRequests[1].txid).toBe(bank.sentRequests[0].txid);
    expect(bank.sentRequests[1].txid).toBe(order.txid);
    expect(bank.sentRequests[1].amount).toBe(75_500);
    expect(bank.sentRequests[1].key).toBe('00123456789012');
  });

  it('parks an order for manual review after 5 failed attempts and never auto-reverts it', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service, 1_000);

    // Every send times out; every statement is published and empty.
    timeoutBank(bank);
    bank.getStatement.mockImplementation(async (): Promise<Settlement[]> => []);

    // Attempts 1..4: in flight, then proven absent, then retryable.
    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      await service.executePayments();
      expect(order.attempts).toBe(attempt);
      expect(order.status).toBe(PayoutStatus.in_flight);

      order.lastAttemptAt = minsAgo(45);
      await service.reconcile(windowPastLag());
      expect(order.status).toBe(PayoutStatus.retryable);
    }

    // Attempt 5 hits the cap: the order is parked, not queued for another send.
    await service.executePayments();
    expect(order.attempts).toBe(MAX_SEND_ATTEMPTS);
    expect(order.status).toBe(PayoutStatus.parked);
    expect(order.parkReason).toBe(ParkReason.attempt_limit);

    // Reconciliation (even with a fully published, empty statement) must not
    // auto-revert a parked order into a sendable state.
    order.lastAttemptAt = minsAgo(45);
    const result = await service.reconcile(windowPastLag());
    expect(result.provenAbsent).toBe(0);
    expect(order.status).toBe(PayoutStatus.parked);
    expect(order.parkReason).toBe(ParkReason.attempt_limit);

    // And execution must not touch it.
    expect((await service.executePayments()).attempted).toBe(0);
    expect(bank.send).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
    expect(order.status).toBe(PayoutStatus.parked);
  });

  it('treats an accepted send as sent and waits for settlement', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service);

    await service.executePayments(); // default bank: HTTP 200 -> accepted
    expect(order.status).toBe(PayoutStatus.sent);
    expect(order.attempts).toBe(1);
    expect((await service.executePayments()).attempted).toBe(0); // awaiting settlement
  });

  it('treats a duplicate as sent (the bank already has the txid)', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service);

    bank.send.mockResolvedValueOnce({ status: 409, code: 'DUPLICATE_TXID' });
    await service.executePayments();
    expect(order.status).toBe(PayoutStatus.sent);
    expect(order.attempts).toBe(1);
    expect((await service.executePayments()).attempted).toBe(0);
  });

  it('parks a permanently rejected order without ever retrying it', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service);

    bank.send.mockResolvedValueOnce({ status: 400, code: 'INVALID_BENEFICIARY' });
    await service.executePayments();
    expect(order.status).toBe(PayoutStatus.parked);
    expect(order.parkReason).toBe(ParkReason.permanent_rejection);
    expect((await service.executePayments()).attempted).toBe(0);
  });

  it('is idempotent across overlapping reconcile windows', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service, 25_000);

    timeoutBank(bank);
    await service.executePayments();
    order.lastAttemptAt = minsAgo(50);

    const settledAt = minsAgo(45);
    bank.getStatement.mockImplementation(async (): Promise<Settlement[]> => [
      { txid: order.txid, amount: order.amountMinor, settledAt },
    ]);

    const first = await service.reconcile({ from: minsAgo(90), to: minsAgo(31) });
    expect(first.settled).toBe(1);

    // Overlapping window, run again: nothing may change twice.
    const second = await service.reconcile({ from: minsAgo(60), to: minsAgo(31) });
    expect(second.settled).toBe(0);
    expect(second.provenAbsent).toBe(0);
    expect(order.status).toBe(PayoutStatus.settled);
    expect(order.attempts).toBe(1);
    expect(bank.send).toHaveBeenCalledTimes(1);
  });

  it('does not treat a not-yet-fully-published statement as proof of absence', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service);

    timeoutBank(bank);
    await service.executePayments();
    expect(order.status).toBe(PayoutStatus.in_flight);

    // The attempt is 8 minutes old and the window ends 5 minutes ago: still
    // inside the publishing lag, so absence cannot be proven.
    order.lastAttemptAt = minsAgo(8);
    const result = await service.reconcile({ from: minsAgo(20), to: minsAgo(5) });
    expect(result.provenAbsent).toBe(0);
    expect(result.settled).toBe(0);
    expect(order.status).toBe(PayoutStatus.in_flight);
    expect((await service.executePayments()).attempted).toBe(0);
  });

  it('flags a statement amount mismatch instead of settling or re-sending', async () => {
    const { bank, service } = harness();
    const order = await seedOrder(service, 1_000);

    timeoutBank(bank);
    await service.executePayments();
    order.lastAttemptAt = minsAgo(45);

    bank.getStatement.mockImplementation(async (): Promise<Settlement[]> => [
      { txid: order.txid, amount: 1_001, settledAt: minsAgo(40) },
    ]);
    const result = await service.reconcile(windowPastLag());
    expect(result.discrepancies).toBe(1);
    expect(result.settled).toBe(0);
    // A seen-but-mismatched txid is never "absent".
    expect(result.provenAbsent).toBe(0);
    expect(order.status).toBe(PayoutStatus.in_flight);
  });
});

describe('txid derivation', () => {
  it('is deterministic per order and effective date, and differs otherwise', () => {
    const date = new Date('2025-06-01T00:00:00Z');
    expect(deriveTxid('order-1', date)).toBe(deriveTxid('order-1', '2025-06-01'));
    expect(deriveTxid('order-1', date)).not.toBe(deriveTxid('order-2', date));
    expect(deriveTxid('order-1', date)).not.toBe(deriveTxid('order-1', '2025-06-02'));
  });
});

describe('bank send response classification', () => {
  it('maps raw responses to the four categories', () => {
    expect(classifySendResponse({ status: 200 })).toBe('accepted');
    expect(classifySendResponse({ status: 202 })).toBe('accepted');
    expect(classifySendResponse({ status: 409 })).toBe('duplicate');
    expect(classifySendResponse({ status: 409, code: 'DUPLICATE_TXID' })).toBe('duplicate');
    expect(classifySendResponse({ status: 0 })).toBe('transient');
    expect(classifySendResponse({ status: 408 })).toBe('transient');
    expect(classifySendResponse({ status: 429 })).toBe('transient');
    expect(classifySendResponse({ status: 503 })).toBe('transient');
    expect(classifySendResponse({ status: 400, code: 'INVALID_BENEFICIARY' })).toBe('permanent');
    expect(classifySendResponse({ status: 402 })).toBe('permanent');
  });
});
