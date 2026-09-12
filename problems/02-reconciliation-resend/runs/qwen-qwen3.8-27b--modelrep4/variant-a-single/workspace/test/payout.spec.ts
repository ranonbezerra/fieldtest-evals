import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import {
  CoverageRecord,
  PayoutRecord,
  PayoutRepositoryContract,
  ReconcileWindow,
  SendOutcomeUpdate,
  SettlementInput,
  SettlementRecord,
} from '../src/payout/payout.repository.js';
import {
  BankClient,
  BankSendInput,
  BankSendResult,
  BankSettlement,
} from '../src/payout/bank-client.token.js';

const NOW = new Date('2024-01-01T10:00:00.000Z');
const EFFECTIVE_DATE = new Date('2024-01-01T00:00:00.000Z');

function makeOrder(overrides: Partial<PayoutRecord>): PayoutRecord {
  return {
    id: 'order',
    supplierId: null,
    bankKey: 'bank-key',
    amountMinor: 1000,
    effectiveDate: EFFECTIVE_DATE,
    status: 'pending',
    attempts: 0,
    lastTxId: null,
    lastAttemptAt: null,
    lastError: null,
    resendProvenAt: null,
    settledAt: null,
    settlementId: null,
    reviewReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class FakePayoutRepository implements PayoutRepositoryContract {
  private readonly orders = new Map<string, PayoutRecord>();
  private readonly settlements = new Map<string, SettlementRecord>();
  private readonly coverage = new Map<string, CoverageRecord>();

  add(order: PayoutRecord): void {
    this.orders.set(order.id, order);
  }

  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private settlementKey(statementDate: Date, txId: string): string {
    return `${this.dateKey(statementDate)}:${txId}`;
  }

  async findPendingOrders(limit = 100): Promise<PayoutRecord[]> {
    return [...this.orders.values()]
      .filter((order) => order.status === 'pending')
      .slice(0, limit);
  }

  async findOrdersByTxId(txId: string): Promise<PayoutRecord[]> {
    return [...this.orders.values()].filter((order) => order.lastTxId === txId);
  }

  async findSendFailedOrders(): Promise<PayoutRecord[]> {
    return [...this.orders.values()].filter(
      (order) => order.status === 'send_failed',
    );
  }

  async upsertSettlement(input: SettlementInput): Promise<SettlementRecord> {
    const key = this.settlementKey(input.statementDate, input.txId);
    const existing = this.settlements.get(key);

    if (existing) {
      existing.amountMinor = input.amountMinor;
      if (input.settledAt) {
        existing.settledAt = input.settledAt;
      }
      if (input.bankReference) {
        existing.bankReference = input.bankReference;
      }
      return existing;
    }

    const record: SettlementRecord = {
      id: `settlement-${key}`,
      statementDate: input.statementDate,
      txId: input.txId,
      amountMinor: input.amountMinor,
      settledAt: input.settledAt ?? null,
      bankReference: input.bankReference ?? null,
      receivedAt: new Date(),
    };
    this.settlements.set(key, record);
    return record;
  }

  async findSettlementByStatementDateAndTxId(
    statementDate: Date,
    txId: string,
  ): Promise<SettlementRecord | null> {
    return this.settlements.get(this.settlementKey(statementDate, txId)) ?? null;
  }

  async recordStatementCoverage(date: Date, checkedAt: Date): Promise<void> {
    const key = this.dateKey(date);
    const existing = this.coverage.get(key);
    if (!existing || checkedAt.getTime() > existing.checkedAt.getTime()) {
      this.coverage.set(key, { date, checkedAt });
    }
  }

  async getStatementCoverage(date: Date): Promise<CoverageRecord | null> {
    return this.coverage.get(this.dateKey(date)) ?? null;
  }

  async markSettled(
    id: string,
    settlementId: string,
    settledAt: Date,
  ): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || !['pending', 'sent', 'send_failed'].includes(order.status)) {
      return false;
    }

    order.status = 'settled';
    order.settlementId = settlementId;
    order.settledAt = settledAt;
    order.lastError = null;
    order.resendProvenAt = null;
    order.reviewReason = null;
    return true;
  }

  async markReview(id: string, reason: string): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || !['pending', 'sent', 'send_failed'].includes(order.status)) {
      return false;
    }

    order.status = 'review';
    order.reviewReason = reason;
    return true;
  }

  async updateSendOutcome(id: string, data: SendOutcomeUpdate): Promise<void> {
    const order = this.orders.get(id);
    if (!order || !['pending', 'sent', 'send_failed'].includes(order.status)) {
      return;
    }

    Object.assign(order, data);
  }

  async claimSendFailedForResend(id: string, provenAt: Date): Promise<boolean> {
    const order = this.orders.get(id);
    if (!order || order.status !== 'send_failed') {
      return false;
    }

    order.status = 'pending';
    order.resendProvenAt = provenAt;
    return true;
  }
}

class FakeBankClient implements BankClient {
  readonly sendCalls: BankSendInput[] = [];
  private readonly statements = new Map<string, BankSettlement[]>();
  private readonly sendQueue: Array<BankSendResult | Error> = [];

  setStatement(date: string, entries: BankSettlement[]): void {
    this.statements.set(date, entries);
  }

  enqueueSend(result: BankSendResult | Error): void {
    this.sendQueue.push(result);
  }

  async send(input: BankSendInput): Promise<BankSendResult> {
    this.sendCalls.push(input);
    const next = this.sendQueue.shift();

    if (next instanceof Error) {
      throw next;
    }

    if (!next) {
      return { kind: 'accepted', txid: input.txid };
    }

    if (
      (next.kind === 'accepted' || next.kind === 'duplicate') &&
      next.txid.length === 0
    ) {
      return { kind: next.kind, txid: input.txid };
    }

    return next;
  }

  async getStatement(date: string): Promise<BankSettlement[]> {
    return this.statements.get(date) ?? [];
  }
}

function createService() {
  const repository = new FakePayoutRepository();
  const bank = new FakeBankClient();
  const service = new PayoutService(repository, bank);
  return { repository, bank, service };
}

function windowAroundNow(): ReconcileWindow {
  return {
    from: new Date(NOW.getTime() - 15 * 60 * 1000),
    to: NOW,
  };
}

describe('PayoutService reconciliation', () => {
  beforeAll(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('does not resend a timeout that later settles', async () => {
    const { repository, bank, service } = createService();

    const order = makeOrder({
      id: 'order-timeout-settled',
      status: 'send_failed',
      attempts: 1,
      lastTxId: 'tx-1',
      lastAttemptAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    repository.add(order);

    bank.setStatement('2024-01-01', [
      {
        txid: 'tx-1',
        amount: 1000,
        settledAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      },
    ]);

    await service.reconcile(windowAroundNow());

    expect(order.status).toBe('settled');
    expect(order.settlementId).toBeTruthy();
    expect(bank.sendCalls).toHaveLength(0);
  });

  it('resends after reconciliation proves absence with the same txid', async () => {
    const { repository, bank, service } = createService();

    const order = makeOrder({
      id: 'order-proven-absent',
      status: 'send_failed',
      attempts: 1,
      lastTxId: 'tx-2',
      lastAttemptAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    repository.add(order);

    bank.setStatement('2024-01-01', []);
    bank.enqueueSend({ kind: 'accepted', txid: '' });

    await service.reconcile(windowAroundNow());

    expect(bank.sendCalls).toHaveLength(1);
    expect(bank.sendCalls[0].txid).toBe('tx-2');
    expect(bank.sendCalls[0].amount).toBe(1000);
    expect(order.status).toBe('sent');
    expect(order.attempts).toBe(2);
  });

  it('parks for review when the attempt limit is exhausted', async () => {
    const { repository, bank, service } = createService();

    const order = makeOrder({
      id: 'order-exhausted',
      status: 'send_failed',
      attempts: 4,
      lastTxId: 'tx-3',
      lastAttemptAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    repository.add(order);

    bank.setStatement('2024-01-01', []);
    bank.enqueueSend({ kind: 'transient', message: 'bank unavailable' });

    await service.reconcile(windowAroundNow());

    expect(bank.sendCalls).toHaveLength(1);
    expect(bank.sendCalls[0].txid).toBe('tx-3');
    expect(order.status).toBe('review');
    expect(order.reviewReason).toBe('attempts_exhausted');
    expect(order.attempts).toBe(5);
  });
});
