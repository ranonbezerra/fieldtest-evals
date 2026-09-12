# repair2-set

## reasoning

```
We need to fix import path. In src/app.module.ts imports PayoutModule from './payout/payout.module' but actual file is src/payout/payout.module.ts (maybe). Path should be './payout/payout.module' relative to src/app.module.ts which is in src/. That is correct. However error cannot find module, maybe missing extension .js? In ESM, need .js extension when importing compiled .js. In TypeScript source, import should be './payout/payout.module' works with ts-node. But with tsconfig "module": "ESNext" and "type": "module", need .js extension. So change to './payout/payout.module.js'. Also tests have @ts-expect-error unused; they were expecting errors but now code works, so remove those directives.

We need to edit src/app.module.ts and test/payout.spec.ts (remove three @ts-expect-error lines). Also adjust import maybe other files referencing? Only error is that.

Implement changes.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### test/payout.spec.ts
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PayoutService, ReconcileWindow } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { BankService, BankSendResult, BankSettlement } from '../src/bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

/**
 * In‑memory repository for unit testing. Implements the subset of methods used by
 * PayoutService.
 */
class InMemoryPayoutRepository implements Partial<PayoutRepository> {
  private payouts: Payout[] = [];

  async findPendingOrders(): Promise<Payout[]> {
    return this.payouts.filter(
      (p) => p.status === PayoutStatus.PENDING && p.attempts < 5,
    );
  }

  async findOrdersAwaitingEvidence(): Promise<Payout[]> {
    return this.payouts.filter((p) => p.status === PayoutStatus.SENT);
  }

  async findOrdersByTxids(txids: string[]): Promise<Payout[]> {
    if (txids.length === 0) return [];
    return this.payouts.filter((p) => p.txid && txids.includes(p.txid));
  }

  async markSent(id: number, txid: string): Promise<Payout> {
    const p = this.payouts.find((p) => p.id === id)!;
    p.status = PayoutStatus.SENT;
    p.txid = txid;
    p.attempts += 1;
    p.updatedAt = new Date();
    return p;
  }

  async markSettled(id: number): Promise<Payout> {
    const p = this.payouts.find((p) => p.id === id)!;
    p.status = PayoutStatus.SETTLED;
    p.updatedAt = new Date();
    return p;
  }

  async markFailed(id: number): Promise<Payout> {
    const p = this.payouts.find((p) => p.id === id)!;
    p.status = PayoutStatus.FAILED;
    p.updatedAt = new Date();
    return p;
  }

  async parkOrder(id: number): Promise<Payout> {
    const p = this.payouts.find((p) => p.id === id)!;
    p.status = PayoutStatus.PARKED;
    p.updatedAt = new Date();
    return p;
  }

  async updateTxid(id: number, txid: string): Promise<Payout> {
    const p = this.payouts.find((p) => p.id === id)!;
    p.txid = txid;
    p.updatedAt = new Date();
    return p;
  }

  // Helper for test setup
  create(p: Partial<Payout>) {
    const newPayout: Payout = {
      id: p.id ?? this.payouts.length + 1,
      amount: p.amount ?? 0,
      bankKey: p.bankKey ?? '',
      effectiveDate: p.effectiveDate ?? new Date(),
      status: p.status ?? PayoutStatus.PENDING,
      attempts: p.attempts ?? 0,
      txid: p.txid ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Payout;
    this.payouts.push(newPayout);
    return newPayout;
  }

  getById(id: number): Payout | undefined {
    return this.payouts.find((p) => p.id === id);
  }
}

/**
 * Fake bank service that lets tests pre‑program responses and statements.
 */
class FakeBankService implements BankService {
  private sendResponses: Map<string, BankSendResult[]> = new Map();
  private statements: Map<string, BankSettlement[]> = new Map();
  public sendCallCounts: Record<string, number> = {};

  setResponsesForTxid(txid: string, responses: BankSendResult[]) {
    this.sendResponses.set(txid, [...responses]);
  }

  async send(payload: {
    txid: string;
    amount: number;
    key: string;
  }): Promise<BankSendResult> {
    const { txid } = payload;
    this.sendCallCounts[txid] = (this.sendCallCounts[txid] ?? 0) + 1;
    const seq = this.sendResponses.get(txid);
    if (seq && seq.length > 0) {
      const result = seq.shift()!;
      this.sendResponses.set(txid, seq);
      return result;
    }
    // Default fallback
    return { status: 'transient_error' };
  }

  setStatement(date: Date, settlements: BankSettlement[]) {
    const key = date.toISOString().split('T')[0];
    this.statements.set(key, settlements);
  }

  async getStatement(date: Date): Promise<BankSettlement[]> {
    const key = date.toISOString().split('T')[0];
    return this.statements.get(key) ?? [];
  }
}

/**
 * Utility to compute the deterministic txid using the same algorithm as the service.
 */
function computeTxId(payout: Payout): string {
  const input = `${payout.id}-${payout.effectiveDate.toISOString()}`;
  return createHash('sha256').update(input).digest('hex');
}

describe('PayoutService – timeout‑but‑settled (no resend)', () => {
  let repo: InMemoryPayoutRepository;
  let bank: FakeBankService;
  let service: PayoutService;

  beforeEach(() => {
    repo = new InMemoryPayoutRepository();
    bank = new FakeBankService();
    // we only need the subset of methods used.
    service = new PayoutService(repo as any, bank as any);
  });

  it('does not resend when the txid appears in the statement after a transient error', async () => {
    const effectiveDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const payout = repo.create({
      amount: 18400,
      bankKey: 'supplier-key',
      effectiveDate,
    });

    const txid = computeTxId(payout);
    bank.setResponsesForTxid(txid, [{ status: 'transient_error' }]);

    // Simulate the bank's statement containing the txid (settled) after the lag.
    bank.setStatement(effectiveDate, [
      { txid, amount: payout.amount, settledAt: new Date() },
    ]);

    // First execution – transient error recorded.
    await service.executePayments();

    let updated = repo.getById(payout.id)!;
    expect(updated.status).toBe(PayoutStatus.SENT);
    expect(updated.attempts).toBe(1);
    expect(updated.txid).toBe(txid);
    expect(bank.sendCallCounts[txid]).toBe(1);

    // Reconcile – should detect settlement and mark settled, no resend.
    const window: ReconcileWindow = {
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    };
    await service.reconcile(window);

    updated = repo.getById(payout.id)!;
    expect(updated.status).toBe(PayoutStatus.SETTLED);
    expect(updated.attempts).toBe(1); // No extra attempt.
    expect(bank.sendCallCounts[txid]).toBe(1); // No resend.
  });
});

describe('PayoutService – proven‑absent (re‑send with same txid)', () => {
  let repo: InMemoryPayoutRepository;
  let bank: FakeBankService;
  let service: PayoutService;

  beforeEach(() => {
    repo = new InMemoryPayoutRepository();
    bank = new FakeBankService();
    service = new PayoutService(repo as any, bank as any);
  });

  it('re‑sends when the txid is absent from the statement past the publishing lag', async () => {
    // Effective date sufficiently in the past to be past the 30‑min lag.
    const effectiveDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const payout = repo.create({
      amount: 5000,
      bankKey: 'supplier-key',
      effectiveDate,
    });

    const txid = computeTxId(payout);
    // First attempt – transient error.
    bank.setResponsesForTxid(txid, [{ status: 'transient_error' }]);
    // No settlement for the first window.
    bank.setStatement(effectiveDate, []); // Empty statement.

    // Execute first send.
    await service.executePayments();

    let updated = repo.getById(payout.id)!;
    expect(updated.status).toBe(PayoutStatus.SENT);
    expect(updated.attempts).toBe(1);
    expect(bank.sendCallCounts[txid]).toBe(1);

    // Reconcile – should trigger a resend because the txid is absent and lag has passed.
    const window1: ReconcileWindow = {
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    };
    // Program the second send to be accepted.
    bank.setResponsesForTxid(txid, [{ status: 'accepted' }]);
    // Still no settlement at this moment.
    bank.setStatement(effectiveDate, []);

    await service.reconcile(window1);

    updated = repo.getById(payout.id)!;
    expect(updated.status).toBe(PayoutStatus.SENT);
    expect(updated.attempts).toBe(2);
    expect(bank.sendCallCounts[txid]).toBe(2);

    // Simulate the bank finally publishing the settlement.
    bank.setStatement(effectiveDate, [
      { txid, amount: payout.amount, settledAt: new Date() },
    ]);

    // Reconcile again – should mark settled.
    const window2: ReconcileWindow = {
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    };
    await service.reconcile(window2);

    updated = repo.getById(payout.id)!;
    expect(updated.status).toBe(PayoutStatus.SETTLED);
    expect(updated.attempts).toBe(2);
    expect(bank.sendCallCounts[txid]).toBe(2);
  });
});

describe('PayoutService – attempts exhausted (parked for review)', () => {
  let repo: InMemoryPayoutRepository;
  let bank: FakeBankService;
  let service: PayoutService;

  beforeEach(() => {
    repo = new InMemoryPayoutRepository();
    bank = new FakeBankService();
    service = new PayoutService(repo as any, bank as any);
  });

  it('parks the payout after 5 attempts with no settlement', async () => {
    const effectiveDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const payout = repo.create({
      amount: 2500,
      bankKey: 'supplier-key',
      effectiveDate,
    });

    const txid = computeTxId(payout);
    // Program 5 transient errors.
    bank.setResponsesForTxid(txid, [
      { status: 'transient_error' },
      { status: 'transient_error' },
      { status: 'transient_error' },
      { status: 'transient_error' },
      { status: 'transient_error' },
    ]);
    // No settlement ever appears.
    bank.setStatement(effectiveDate, []);

    // First execution.
    await service.executePayments();
    // First reconcile – triggers resend #2.
    await service.reconcile({
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    });

    // Second reconcile – triggers resend #3.
    await service.reconcile({
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    });

    // Third reconcile – triggers resend #4.
    await service.reconcile({
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    });

    // Fourth reconcile – triggers resend #5.
    await service.reconcile({
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    });

    // Fifth reconcile – attempts have reached the maximum; should be parked.
    await service.reconcile({
      from: new Date(effectiveDate.getTime() - 5 * 60 * 1000),
      to: new Date(),
    });

    const final = repo.getById(payout.id)!;
    expect(final.status).toBe(PayoutStatus.PARKED);
    expect(final.attempts).toBe(5);
    // Six total send calls: 1 initial + 4 resends (5 attempts) + final attempt that led to parking.
    expect(bank.sendCallCounts[txid]).toBe(5);
  });
});
```
