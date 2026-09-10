import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayoutController } from '../src/payout/payout.controller.js';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from '../src/payout/payout.errors.js';
import { PayoutProvider, TransferOutcome } from '../src/payout/payout.provider.js';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from '../src/payout/payout.repository.js';
import { MAX_PROVIDER_ATTEMPTS, PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorkerService } from '../src/payout/payout.worker.js';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter.js';

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

interface AccountRow {
  id: string;
  settledBalance: bigint;
  reservedBalance: bigint;
}

interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
  lastError: string | null;
}

interface OutboxRow {
  id: string;
  payoutId: string;
  status: string;
  availableAt: Date;
  updatedAt: Date;
}

interface LedgerRow {
  payoutId: string;
  accountId: string;
  bucket: string;
  direction: string;
  amount: bigint;
  sequence: number;
}

class UniqueViolationError extends Error {
  code = 'P2002';
}

class MockProvider implements PayoutProvider {
  calls = 0;
  outcomes: Array<TransferOutcome | Error> = [];
  lastArgs: Array<{ to: string; amount: bigint }> = [];

  setOutcomes(outcomes: Array<TransferOutcome | Error>): void {
    this.outcomes = [...outcomes];
  }

  async transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome> {
    this.calls += 1;
    this.lastArgs.push(args);
    const next = this.outcomes.shift();
    if (next === undefined) {
      throw new Error('mock provider exhausted');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

class InMemoryRepository {
  accounts = new Map<string, AccountRow>();
  payouts: PayoutRow[] = [];
  outbox: OutboxRow[] = [];
  processed: string[] = [];
  ledger: LedgerRow[] = [];
  private payoutSeq = 0;
  private outboxSeq = 0;

  addAccount(id: string, settledBalance: bigint, reservedBalance = 0n): void {
    this.accounts.set(id, { id, settledBalance, reservedBalance });
  }

  account(id: string): AccountRow {
    const row = this.accounts.get(id);
    if (!row) {
      throw new Error(`no account ${id} in stub`);
    }
    return row;
  }

  payout(id: string): PayoutRow {
    const row = this.payouts.find((p) => p.id === id);
    if (!row) {
      throw new Error(`no payout ${id} in stub`);
    }
    return row;
  }

  outboxRow(id: string): OutboxRow {
    const row = this.outbox.find((o) => o.id === id);
    if (!row) {
      throw new Error(`no outbox row ${id} in stub`);
    }
    return row;
  }

  payoutFor(payoutId: string): OutboxRow {
    const row = this.outbox.find((o) => o.payoutId === payoutId);
    if (!row) {
      throw new Error(`no outbox row for payout ${payoutId}`);
    }
    return row;
  }

  ledgerFor(payoutId: string): LedgerRow[] {
    return this.ledger.filter((l) => l.payoutId === payoutId);
  }

  findPayoutByKey(accountId: string, idempotencyKey: string) {
    const row = this.payouts.find(
      (p) => p.accountId === accountId && p.idempotencyKey === idempotencyKey,
    );
    return row ? { ...row } : null;
  }

  findPayoutById(id: string) {
    const row = this.payouts.find((p) => p.id === id);
    return row ? { ...row } : null;
  }

  accountExists(id: string): boolean {
    return this.accounts.has(id);
  }

  reserveIfSufficient(accountId: string, amount: bigint): number {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      return 0;
    }
    if (acc.settledBalance < amount) {
      return 0;
    }
    acc.settledBalance -= amount;
    acc.reservedBalance += amount;
    return 1;
  }

  createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): string {
    const acc = this.accounts.get(input.accountId);
    if (!acc) {
      throw new Error('no account');
    }
    if (
      this.payouts.some(
        (p) => p.accountId === input.accountId && p.idempotencyKey === input.idempotencyKey,
      )
    ) {
      throw new UniqueViolationError('unique constraint (payouts_account_id_idempotency_key_key)');
    }
    if (acc.settledBalance < input.amount) {
      // The atomic reservation inside the transaction failed; the whole
      // transaction rolls back.
      throw new Error('RESERVATION_FAILED');
    }
    acc.settledBalance -= input.amount;
    acc.reservedBalance += input.amount;
    this.payoutSeq += 1;
    const payout: PayoutRow = {
      id: `payout-${this.payoutSeq}`,
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
      status: 'CREATED',
      attempts: 0,
      txHash: null,
      lastError: null,
    };
    this.payouts.push(payout);
    this.outboxSeq += 1;
    this.outbox.push({
      id: `msg-${this.outboxSeq}`,
      payoutId: payout.id,
      status: 'PENDING',
      availableAt: new Date(),
      updatedAt: new Date(),
    });
    this.ledger.push(
      { payoutId: payout.id, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: payout.id, accountId: input.accountId, bucket: 'RESERVED', direction: 'debit', amount: input.amount, sequence: 2 },
    );
    return payout.id;
  }

  claimNext(): Delivery | null {
    const row =
      this.outbox.find((o) => o.status === 'PENDING' && o.availableAt <= new Date()) ??
      this.outbox.find((o) => o.status === 'PROCESSING');
    if (!row) {
      return null;
    }
    row.status = 'PROCESSING';
    row.updatedAt = new Date();
    return {
      outboxId: row.id,
      payoutId: row.payoutId,
      deliveredAt: row.updatedAt,
    };
  }

  markProcessing(payoutId: string): void {
    const p = this.payout(payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot mark processing from ${p.status}`);
    }
    p.status = 'PROCESSING';
  }

  recordSent(payoutId: string, txHash: string): void {
    const p = this.payout(payoutId);
    if (p.status === 'SENT') {
      return; // redelivery: no-op
    }
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot record sent from ${p.status}`);
    }
    p.status = 'SENT';
    p.txHash = txHash;
  }

  settle(payoutId: string, accountId: string, amount: bigint): void {
    const p = this.payout(payoutId);
    if (p.status !== 'SENT') {
      return; // guarded: redelivery is a no-op
    }
    const acc = this.account(accountId);
    acc.reservedBalance -= amount;
    acc.settledBalance += amount;
    this.ledger.push(
      { payoutId, accountId, bucket: 'RESERVED', direction: 'credit', amount, sequence: 1 },
      { payoutId, accountId, bucket: 'ONCHAIN', direction: 'debit', amount, sequence: 2 },
    );
    p.status = 'COMPLETED';
  }

  recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): void {
    const p = this.payout(input.payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      return;
    }
    const acc = this.account(input.accountId);
    acc.settledBalance += input.amount;
    acc.reservedBalance -= input.amount;
    p.status = 'FAILED';
    p.lastError = input.error;
    this.outboxRow(input.outboxId).status = 'FAILED';
    this.ledger.push(
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'RESERVED', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'debit', amount: input.amount, sequence: 2 },
    );
  }

  recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): void {
    const p = this.payout(input.payoutId);
    p.attempts += 1;
    p.lastError = input.error;
    p.status = input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING';
    const row = this.outboxRow(input.outboxId);
    if (input.exhausted) {
      row.status = 'ABANDONED';
    } else {
      row.status = 'PENDING';
      row.availableAt = input.retryAt;
    }
  }

  markProcessed(outboxId: string): void {
    if (!this.processed.includes(outboxId)) {
      this.processed.push(outboxId);
    }
  }

  findLedgerEntries(payoutId: string): LedgerRow[] {
    return this.ledger
      .filter((l) => l.payoutId === payoutId)
      .sort((a, b) => a.sequence - b.sequence);
  }
}

async function runUntilIdle(worker: PayoutWorkerService, maxRounds = 10): Promise<void> {
  for (let i = 0; i < maxRounds; i += 1) {
    const processed = await worker.processMessages();
    if (processed === 0) {
      return;
    }
  }
}

describe('PayoutService (concurrent creation, idempotency, delivery safety)', () => {
  let repo: InMemoryRepository;
  let provider: MockProvider;
  let service: PayoutService;
  let worker: PayoutWorkerService;

  function setup(funds = 4000n) {
    repo = new InMemoryRepository();
    repo.addAccount(ACCOUNT_ID, funds);
    provider = new MockProvider();
    service = new PayoutService(repo as unknown as PayoutRepository, provider);
    worker = new PayoutWorkerService(
      service,
      repo as unknown as PayoutRepository,
    );
  }

  function deliveryFor(payoutId: string): Delivery {
    const row = repo.payoutFor(payoutId);
    return { outboxId: row.id, payoutId, deliveredAt: new Date() };
  }

  it('two concurrent creations against one account with funds for one: exactly one payout, no overdraft', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
    };

    const results = await Promise.allSettled([
      service.createPayout({ ...base, idempotencyKey: 'k1' }),
      service.createPayout({ ...base, idempotencyKey: 'k2' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(InsufficientFundsError);

    expect(repo.payouts).toHaveLength(1);
    expect(repo.payouts[0].id).toBe(winner.id);
    expect(repo.payouts[0].status).toBe('CREATED');
    expect(repo.outbox).toHaveLength(1);

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    const entries = repo.ledgerFor(winner.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit', amount: 3000n });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit', amount: 3000n });
  });

  it('a retry with the same idempotency key returns the original payout and reserves nothing further', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'same-key',
    };

    // Sequential retry: served by the pre-check.
    const first = await service.createPayout(base);
    const second = await service.createPayout(base);
    expect(second.id).toBe(first.id);
    expect(repo.payouts).toHaveLength(1);

    // Racing retry: both see an empty table, one insert hits the unique
    // constraint, the loser must return the winner's payout.
    const racing = await Promise.allSettled([
      service.createPayout(base),
      service.createPayout(base),
    ]);
    expect(racing.every((r) => r.status === 'fulfilled')).toBe(true);
    const a = (racing[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const b = (racing[1] as PromiseFulfilledResult<PayoutRecord>).value;
    expect(a.id).toBe(first.id);
    expect(b.id).toBe(first.id);

    expect(repo.payouts).toHaveLength(1);
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(3000n);
    expect(acc.settledBalance).toBe(1000n);
    expect(repo.ledgerFor(first.id)).toHaveLength(2);
  });

  it('the same message delivered twice results in exactly one transfer and one settlement', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([
      { txHash: '0xdeadbeef' },
      { txHash: '0xdeadbeef' }, // the redelivery must not be used
    ]);

    const delivery = deliveryFor(created.id);
    await service.processDelivery(delivery);
    await service.processDelivery(delivery); // duplicate delivery

    expect(provider.calls).toBe(1);
    expect(provider.lastArgs[0]).toEqual({ to: '0xabc', amount: 3000n });

    const p = repo.payout(created.id);
    expect(p.status).toBe('COMPLETED');
    expect(p.txHash).toBe('0xdeadbeef');

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(0n);
    expect(acc.settledBalance).toBe(1000n);

    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(4);
    const settlement = entries.filter((e) => e.direction === 'debit' && e.bucket === 'ONCHAIN');
    expect(settlement).toHaveLength(1);

    expect(repo.processed.filter((id) => id === delivery.outboxId)).toHaveLength(1);
    expect(repo.payoutFor(created.id).status).not.toBe('PENDING');
  });

  it('retry exhaustion parks the payout in NEEDS_REVIEW with the reservation intact and nothing reversed', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    // Four uncertain (timeout) outcomes: no tx hash, no definitive failure.
    provider.setOutcomes([
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
    ]);

    await runUntilIdle(worker);
    expect(provider.calls).toBe(MAX_PROVIDER_ATTEMPTS);

    const p = repo.payout(created.id);
    expect(p.status).toBe('NEEDS_REVIEW');
    expect(p.attempts).toBe(MAX_PROVIDER_ATTEMPTS);
    expect(p.txHash).toBeNull();
    expect(repo.payoutFor(created.id).status).toBe('ABANDONED');

    // The reservation is still in place; nothing was released or refunded.
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    // Only the reservation ledger pair exists: no release, no settlement.
    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit' });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit' });

    // The queue is quiet: no further attempts are scheduled.
    expect(await worker.processMessages()).toBe(0);
  });

  it('settled balance moves only after provider confirmation', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    provider.setOutcomes([{ txHash: '0xconfirm1' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('COMPLETED');
    expect(repo.account(ACCOUNT_ID).reservedBalance).toBe(0n);
    expect(repo.account(ACCOUNT_ID).settledBalance).toBe(4000n - 3000n + 3000n);
    expect(repo.ledgerFor(created.id)).toHaveLength(4);
  });

  it('a definitive provider failure releases the hold instead of parking it', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([{ definitive: true, message: 'insufficient gas' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('FAILED');
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(4000n);
    expect(acc.reservedBalance).toBe(0n);
    expect(repo.payoutFor(created.id).status).toBe('FAILED');
  });

  it('rejects a payout for a missing account', async () => {
    setup(4000n);
    await expect(
      service.createPayout({
        accountId: '22222222-2222-2222-2222-222222222222',
        amount: 1000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(AccountNotFound);
  });
});

describe('PayoutController', () => {
  async function buildController(fakeService: Record<string, unknown>) {
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: PayoutService, useValue: fakeService }],
    })
      .overrideProvider(PayoutService)
      .useValue(fakeService)
      .compile();
    moduleRef.useGlobalFilters(new ErrorEnvelopeFilter());
    const controller = moduleRef.get(PayoutController);
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ErrorEnvelopeFilter());
    await app.init();
    return { controller, app, server: app.getHttpServer() };
  }

  const okPayout = {
    id: 'payout-1',
    accountId: ACCOUNT_ID,
    amount: 3000n,
    destinationAddress: '0xabc',
    idempotencyKey: 'k1',
    status: 'CREATED',
    attempts: 0,
    txHash: null,
  };

  it('creates a payout and returns the money-safe view with the amount as a string', async () => {
    const createPayout = vi.fn().mockResolvedValue(okPayout);
    const service = new PayoutService({} as never, {} as never);
    const { app, server } = await buildController({
      createPayout,
      toView: (p: (typeof okPayout)) => ({
        id: p.id,
        accountId: p.accountId,
        amount: p.amount.toString(),
        destinationAddress: p.destinationAddress,
        idempotencyKey: p.idempotencyKey,
        status: p.status,
        txHash: p.txHash,
      }),
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      id: 'payout-1',
      accountId: ACCOUNT_ID,
      amount: '3000',
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
      status: 'CREATED',
      txHash: null,
    });
    expect(createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        amount: 3000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    );
    await app.close();
  });

  it('maps insufficient funds to the single error envelope with 422', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new InsufficientFundsError(1000n, 3000n)),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'insufficient_funds',
        message: expect.any(String),
        details: { available: '1000', requested: '3000' },
      },
    });
    await app.close();
  });

  it('maps a missing account to 404 in the single error envelope', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new AccountNotFound('missing')),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: 'missing',
        amount: '1000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('account_not_found');
    expect(res.body.error.details).toEqual({ accountId: 'missing' });
    await app.close();
  });

  it('rejects a non-integer amount with 400 and field details', async () => {
    const createPayout = vi.fn();
    const { app, server } = await buildController({
      createPayout,
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '30.5',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.amount).toBeTruthy();
    expect(createPayout).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('parseAmount', () => {
  it('accepts decimal digit strings and rejects everything else', async () => {
    const { parseAmount } = await import('../src/payout/payout.service.js') as {
      parseAmount: (raw: unknown) => bigint;
    };
    expect(parseAmount('0')).toBe(0n);
    expect(parseAmount('3000')).toBe(3000n);
    for (const bad of ['30.5', '-1', '1e3', '', '  ', '0x10', null, 3000, 3000n, true]) {
      expect(() => parseAmount(bad)).toThrow(PayoutValidationError);
    }
  });
});
