import { beforeEach, describe, expect, it } from 'vitest';
import {
  PayoutService,
  deriveTxid,
  type BankClient,
  type BankSendOutcome,
  type Settlement,
} from '../src/payout/payout.service.js';
import {
  MAX_SEND_ATTEMPTS,
  type OpenOrder,
  type OrderState,
  type PayoutRepository,
} from '../src/payout/payout.repository.js';

const ORDER_ID = 'ord-1';
const EFFECTIVE_DATE = new Date('2025-03-10T00:00:00Z');
const TXID = deriveTxid(ORDER_ID, EFFECTIVE_DATE);
const MIN = 60 * 1000;
const WINDOW_FROM = '2025-03-08T00:00:00Z';

function makeOrder(overrides: Partial<OpenOrder> = {}): OpenOrder {
  return {
    id: ORDER_ID,
    amountMinor: 4999,
    recipientKey: 'sup-123',
    effectiveDate: EFFECTIVE_DATE,
    state: 'pending',
    attemptCount: 0,
    lastSendAt: null,
    provenAbsentAt: null,
    settledAt: null,
    reviewReason: null,
    ...overrides,
  };
}

class FakeRepository implements PayoutRepository {
  private orders = new Map<string, OpenOrder>();

  add(order: OpenOrder): void {
    this.orders.set(order.id, { ...order });
  }

  get(id: string): OpenOrder {
    const order = this.orders.get(id);
    if (!order) throw new Error(`order ${id} not found`);
    return order;
  }

  async findSendable(): Promise<OpenOrder[]> {
    return [...this.orders.values()]
      .filter(
        (o) =>
          o.attemptCount < MAX_SEND_ATTEMPTS &&
          (o.state === 'pending' || (o.state === 'send_unknown' && o.provenAbsentAt !== null)),
      )
      .map((o) => ({ ...o }));
  }

  async claimForSend(id: string, expectedState: 'pending' | 'send_unknown', now: Date): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || order.state !== expectedState || order.attemptCount >= MAX_SEND_ATTEMPTS) return false;
    if (expectedState === 'send_unknown' && order.provenAbsentAt === null) return false;
    order.state = 'send_unknown';
    order.attemptCount += 1;
    order.lastSendAt = now;
    order.provenAbsentAt = null;
    return true;
  }

  async recordOutcome(id: string, attemptCount: number, state: OrderState, reviewReason: string | null): Promise<void> {
    const order = this.orders.get(id);
    if (!order || order.state !== 'send_unknown' || order.attemptCount !== attemptCount) return;
    order.state = state;
    order.reviewReason = reviewReason;
  }

  async findOpen(): Promise<OpenOrder[]> {
    return [...this.orders.values()]
      .filter((o) => o.state === 'in_flight' || o.state === 'send_unknown' || o.state === 'needs_review')
      .map((o) => ({ ...o }));
  }

  async settle(id: string, settledAt: Date, expectedStates: OrderState[]): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || !expectedStates.includes(order.state)) return false;
    order.state = 'settled';
    order.settledAt = settledAt;
    order.reviewReason = null;
    return true;
  }

  async markProvenAbsent(id: string, now: Date): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.state === 'send_unknown') order.provenAbsentAt = now;
  }

  async markNeedsReview(id: string, reason: string): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.state !== 'settled') {
      order.state = 'needs_review';
      order.reviewReason = reason;
    }
  }
}

type SendPayload = { txid: string; amount: number; key: string };

class FakeBank implements BankClient {
  sent: SendPayload[] = [];
  private statements = new Map<string, Settlement[]>();
  private handler: (payload: SendPayload) => Promise<BankSendOutcome> = () =>
    Promise.reject(new Error('socket timed out'));

  onSend(handler: (payload: SendPayload) => Promise<BankSendOutcome>): void {
    this.handler = handler;
  }

  statementFor(isoDay: string, entries: Settlement[]): void {
    this.statements.set(isoDay, entries);
  }

  async send(payload: SendPayload): Promise<BankSendOutcome> {
    this.sent.push(payload);
    return this.handler(payload);
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(date.toISOString().slice(0, 10)) ?? [];
  }
}

describe('PayoutService', () => {
  let repo: FakeRepository;
  let bank: FakeBank;
  let service: PayoutService;
  let now: Date;

  beforeEach(() => {
    repo = new FakeRepository();
    bank = new FakeBank();
    now = new Date('2025-03-10T10:00:00Z');
    service = new PayoutService(repo, bank);
    service.clock = () => new Date(now.getTime());
  });

  const windowFrom = (fromIso: string) => ({ from: new Date(fromIso), to: new Date(now.getTime()) });

  it('settles a timed-out order from the statement and never re-sends it', async () => {
    repo.add(makeOrder());

    await service.executePayments(); // the bank times out on attempt 1
    expect(repo.get(ORDER_ID).state).toBe('send_unknown');
    expect(repo.get(ORDER_ID).attemptCount).toBe(1);
    expect(bank.sent).toHaveLength(1);

    // Nothing has proven the txid absent yet, so no resend is allowed.
    await service.executePayments();
    expect(bank.sent).toHaveLength(1);

    // The bank did process it: the statement carries our txid.
    now = new Date('2025-03-10T10:35:00Z');
    bank.statementFor('2025-03-10', [{ txid: TXID, amount: 4999, settledAt: new Date('2025-03-10T10:00:05Z') }]);
    const first = await service.reconcile(windowFrom(WINDOW_FROM));
    expect(first.settled).toBe(1);
    expect(repo.get(ORDER_ID).state).toBe('settled');
    expect(repo.get(ORDER_ID).settledAt).toEqual(new Date('2025-03-10T10:00:05Z'));

    // Later, with an overlapping window: still settled, and never re-sent.
    now = new Date('2025-03-10T12:00:00Z');
    const overlap = await service.reconcile(windowFrom('2025-03-09T00:00:00Z'));
    expect(overlap.settled).toBe(0);
    await service.executePayments();
    expect(bank.sent).toHaveLength(1);
    expect(repo.get(ORDER_ID).state).toBe('settled');
    expect(repo.get(ORDER_ID).attemptCount).toBe(1);
  });

  it('re-sends with the same txid once reconciliation proves the send absent', async () => {
    repo.add(makeOrder());

    await service.executePayments(); // attempt 1 times out
    expect(repo.get(ORDER_ID).state).toBe('send_unknown');

    // Inside the publishing lag: absence cannot be proven, so no resend.
    now = new Date('2025-03-10T10:31:00Z');
    const tooEarly = await service.reconcile(windowFrom(WINDOW_FROM));
    expect(tooEarly.provenAbsent).toBe(0);
    await service.executePayments();
    expect(bank.sent).toHaveLength(1);

    // Past the lag and the statement is empty: proven absent.
    now = new Date('2025-03-10T11:05:00Z');
    const proof = await service.reconcile(windowFrom(WINDOW_FROM));
    expect(proof.provenAbsent).toBe(1);
    expect(repo.get(ORDER_ID).provenAbsentAt).toEqual(new Date('2025-03-10T11:05:00Z'));

    bank.onSend(() => Promise.resolve({ status: 'accepted' }));
    await service.executePayments(); // attempt 2

    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[0].txid).toBe(TXID);
    expect(bank.sent[1].txid).toBe(TXID); // same txid: the bank dedupes a straggler
    expect(bank.sent[1].amount).toBe(4999);
    expect(bank.sent[1].key).toBe('sup-123');
    expect(repo.get(ORDER_ID).state).toBe('in_flight');
    expect(repo.get(ORDER_ID).attemptCount).toBe(2);
  });

  it('stops auto-sending after five attempts and parks the order for manual review', async () => {
    repo.add(makeOrder({ amountMinor: 1000 }));

    for (let i = 1; i <= MAX_SEND_ATTEMPTS; i++) {
      await service.executePayments(); // the bank keeps timing out
      now = new Date(now.getTime() + 65 * MIN); // let the publishing lag elapse
      await service.reconcile(windowFrom(WINDOW_FROM));
    }

    expect(repo.get(ORDER_ID).state).toBe('needs_review');
    expect(repo.get(ORDER_ID).reviewReason).toBe('attempts_exhausted');
    expect(repo.get(ORDER_ID).attemptCount).toBe(MAX_SEND_ATTEMPTS);
    expect(bank.sent).toHaveLength(MAX_SEND_ATTEMPTS);
    for (const call of bank.sent) expect(call.txid).toBe(TXID);

    // A parked order is never auto-retried, even with a fresh proven absence.
    await service.executePayments();
    expect(bank.sent).toHaveLength(MAX_SEND_ATTEMPTS);
    expect(repo.get(ORDER_ID).state).toBe('needs_review');
  });

  it('treats a bank duplicate as in-flight and does not send again', async () => {
    repo.add(makeOrder());
    bank.onSend(() => Promise.resolve({ status: 'duplicate' }));

    await service.executePayments();
    expect(repo.get(ORDER_ID).state).toBe('in_flight');
    expect(repo.get(ORDER_ID).attemptCount).toBe(1);

    // In-flight orders await the statement; they are not re-sent.
    await service.executePayments();
    expect(bank.sent).toHaveLength(1);
  });

  it('parks a permanently rejected order for manual review without retrying', async () => {
    repo.add(makeOrder());
    bank.onSend(() =>
      Promise.resolve({ status: 'rejected', code: 'invalid_key', message: 'key does not exist' }),
    );

    await service.executePayments();
    expect(repo.get(ORDER_ID).state).toBe('needs_review');
    expect(repo.get(ORDER_ID).reviewReason).toBe('permanent_rejection:invalid_key');

    // A permanent rejection is never auto-retried, even after a proven absence.
    now = new Date('2025-03-10T11:05:00Z');
    await service.reconcile(windowFrom(WINDOW_FROM));
    await service.executePayments();
    expect(bank.sent).toHaveLength(1);
    expect(repo.get(ORDER_ID).state).toBe('needs_review');
  });

  it('parks an order whose statement amount does not match', async () => {
    repo.add(makeOrder());
    bank.onSend(() => Promise.resolve({ status: 'accepted' }));
    await service.executePayments();
    expect(repo.get(ORDER_ID).state).toBe('in_flight');

    now = new Date('2025-03-10T11:05:00Z');
    bank.statementFor('2025-03-10', [
      { txid: TXID, amount: 4998, settledAt: new Date('2025-03-10T10:00:05Z') },
    ]);
    const result = await service.reconcile(windowFrom(WINDOW_FROM));
    expect(result.settled).toBe(0);
    expect(result.parked).toBe(1);
    expect(repo.get(ORDER_ID).state).toBe('needs_review');
    expect(repo.get(ORDER_ID).reviewReason).toBe('amount_mismatch');
  });
});
