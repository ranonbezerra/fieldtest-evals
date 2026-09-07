import { afterAll, describe, expect, it } from 'vitest';
import { LedgerBucket, PrismaClient } from '@prisma/client';
import { DomainError } from '../src/common/errors';
import { BlockchainProvider, ProviderOutcome, TransferRequest } from '../src/payout/blockchain-provider';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutWorker } from '../src/payout/payout.worker';

// Give the test pool room for the concurrent-creation load (before any client is created).
process.env.PRISMA_DB_CONNECTION_LIMIT ??= '30';

const prisma = new PrismaClient();
const repo = new PayoutRepository(prisma);

// Fake provider: outcome is configured per test; every call is recorded.
let providerNext: ProviderOutcome = { kind: 'unknown', reason: 'outcome not configured' };
const providerCalls: TransferRequest[] = [];
const provider: BlockchainProvider = {
  transfer: async (request: TransferRequest): Promise<ProviderOutcome> => {
    providerCalls.push(request);
    return providerNext;
  },
};

const workerConfig = { intervalMs: 3_600_000, leaseMs: 5_000, batchSize: 50 };
const service = new PayoutService(repo, provider, { maxAttempts: 3, retryBaseMs: 0 });
const worker = new PayoutWorker(repo, service, workerConfig);

function resetProvider(outcome: ProviderOutcome): void {
  providerCalls.length = 0;
  providerNext = outcome;
}

async function createAccount(settled: bigint): Promise<{ id: string }> {
  return prisma.account.create({ data: { settledBalance: settled, reservedBalance: 0n } });
}

function getPayout(id: string) {
  return prisma.payout.findUniqueOrThrow({ where: { id } });
}

function getAccount(id: string) {
  return prisma.account.findUniqueOrThrow({ where: { id } });
}

async function bucketNet(accountId: string, bucket: LedgerBucket): Promise<bigint> {
  const entries = await prisma.ledgerEntry.findMany({ where: { accountId, bucket } });
  return entries.reduce((acc, entry) => (entry.side === 'debit' ? acc + entry.amount : acc - entry.amount), 0n);
}

function transferMessageOf(refId: string) {
  return prisma.outboxMessage.findFirst({ where: { kind: 'payout_transfer', refId } });
}

/** Simulate at-least-once redelivery: put the message back as immediately due. */
async function redeliver(messageId: string): Promise<void> {
  await prisma.outboxMessage.update({
    where: { id: messageId },
    data: { status: 'pending', nextAttemptAt: new Date(0) },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('concurrent creation against one account', () => {
  it('never overdrafts: only as many payouts as available funds allow', async () => {
    const account = await createAccount(600n);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        service.createPayout({
          accountId: account.id,
          amount: 100n,
          destinationAddress: `0xdst${i}`,
          idempotencyKey: `race-${Date.now()}-${i}`,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(6);
    expect(rejected.length).toBe(4);
    for (const r of fulfilled) {
      if (r.status === 'fulfilled') expect(r.value.created).toBe(true);
    }
    for (const r of rejected) {
      if (r.status !== 'rejected') continue;
      expect(r.reason).toBeInstanceOf(DomainError);
      expect((r.reason as DomainError).code).toBe('insufficient_funds');
    }

    const fresh = await getAccount(account.id);
    expect(fresh.settledBalance).toBe(600n); // settlement untouched by reservations
    expect(fresh.reservedBalance).toBe(600n); // exactly the available funds, no more
    expect(await prisma.payout.count({ where: { accountId: account.id } })).toBe(6);
    // Ledger reconciliation: reserved bucket net equals the reserved column.
    expect(await bucketNet(account.id, 'reserved')).toBe(600n);
    expect(await bucketNet(account.id, 'available')).toBe(-600n);
  });

  it('racing requests sharing one idempotency key create a single payout and reserve once', async () => {
    const account = await createAccount(1000n);
    const key = `dupe-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.createPayout({
          accountId: account.id,
          amount: 100n,
          destinationAddress: '0xshared',
          idempotencyKey: key,
        }),
      ),
    );

    expect(new Set(results.map((r) => r.payout.id)).size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);

    const fresh = await getAccount(account.id);
    expect(fresh.settledBalance).toBe(1000n);
    expect(fresh.reservedBalance).toBe(100n); // reserved exactly once
    expect(await prisma.payout.count({ where: { accountId: account.id } })).toBe(1);
  });

  it('a sequential replay returns the original payout without reserving again', async () => {
    const account = await createAccount(500n);
    const key = `seq-${Date.now()}`;
    const first = await service.createPayout({
      accountId: account.id,
      amount: 120n,
      destinationAddress: '0xseq',
      idempotencyKey: key,
    });
    const second = await service.createPayout({
      accountId: account.id,
      amount: 120n,
      destinationAddress: '0xseq',
      idempotencyKey: key,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.payout.id).toBe(first.payout.id);
    expect(await getAccount(account.id).then((a) => a.reservedBalance)).toBe(120n);
    expect(await prisma.payout.count({ where: { accountId: account.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { payoutId: first.payout.id } })).toBe(2);
  });
});

describe('duplicate message delivery', () => {
  it('a transfer message redelivered after success is a no-op (provider called once, ledger stable)', async () => {
    const account = await createAccount(1000n);
    resetProvider({ kind: 'confirmed', txHash: '0xhash-dup' });
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: 250n,
      destinationAddress: '0xdup1',
      idempotencyKey: `dup-a-${Date.now()}`,
    });

    await worker.processMessages(); // transfer -> sent, finalize -> completed
    const callsAfterFirstPass = providerCalls.length;
    expect(callsAfterFirstPass).toBe(1);
    let fresh = await getPayout(payout.id);
    expect(fresh.status).toBe('completed');
    expect(fresh.txHash).toBe('0xhash-dup');

    // Simulate the worker seeing the same transfer message again.
    const message = await transferMessageOf(payout.id);
    expect(message).not.toBeNull();
    await redeliver(message!.id);
    await worker.processMessages();

    expect(providerCalls.length).toBe(callsAfterFirstPass); // no second transfer
    fresh = await getPayout(payout.id);
    expect(fresh.status).toBe('completed');
    const accountFresh = await getAccount(account.id);
    expect(accountFresh.settledBalance).toBe(750n);
    expect(accountFresh.reservedBalance).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { payoutId: payout.id } })).toBe(6);
    expect(await prisma.outboxMessage.findUnique({ where: { id: message!.id } })).toMatchObject({ status: 'done' });
  });

  it('a message redelivered while an attempt is in flight is never re-attempted; the payout fails closed', async () => {
    const account = await createAccount(1000n);
    resetProvider({ kind: 'confirmed', txHash: '0xshould-not-happen' });
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: 300n,
      destinationAddress: '0xdup2',
      idempotencyKey: `dup-b-${Date.now()}`,
    });

    // Simulate a worker that crashed after claiming and calling the provider:
    // payout stuck in 'processing', message redelivered.
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'processing', providerAttemptedAt: new Date() },
    });
    const message = await transferMessageOf(payout.id);
    await redeliver(message!.id);

    await worker.processMessages();

    expect(providerCalls.length).toBe(0); // provider was never called again
    const fresh = await getPayout(payout.id);
    expect(fresh.status).toBe('needs_review');
    const accountFresh = await getAccount(account.id);
    expect(accountFresh.settledBalance).toBe(1000n); // settled untouched
    expect(accountFresh.reservedBalance).toBe(300n); // funds stay reserved (fail closed)
    expect(await prisma.outboxMessage.findUnique({ where: { id: message!.id } })).toMatchObject({ status: 'dead' });
  });

  it('a finalize message redelivered after success does not double-book the ledger', async () => {
    const account = await createAccount(1000n);
    resetProvider({ kind: 'confirmed', txHash: '0xfinal' });
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: 150n,
      destinationAddress: '0xdup3',
      idempotencyKey: `dup-c-${Date.now()}`,
    });
    await worker.processMessages();
    const entriesAfterFirst = await prisma.ledgerEntry.count({ where: { payoutId: payout.id } });
    expect(entriesAfterFirst).toBe(6);

    const finalize = await prisma.outboxMessage.findFirst({ where: { kind: 'payout_finalize', refId: payout.id } });
    expect(finalize).not.toBeNull();
    await redeliver(finalize!.id);
    await worker.processMessages();

    expect(await prisma.ledgerEntry.count({ where: { payoutId: payout.id } })).toBe(entriesAfterFirst);
    expect((await getPayout(payout.id)).status).toBe('completed');

    // Double-entry invariants for this payout.
    const entries = await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id } });
    const debits = entries.filter((e) => e.side === 'debit').reduce((a, e) => a + e.amount, 0n);
    const credits = entries.filter((e) => e.side === 'credit').reduce((a, e) => a + e.amount, 0n);
    expect(debits).toBe(credits);
    expect(await bucketNet(account.id, 'available')).toBe(-150n);
    expect(await bucketNet(account.id, 'reserved')).toBe(0n);
    expect(await bucketNet(account.id, 'in_transit')).toBe(0n);
    expect(await bucketNet(account.id, 'settled_out')).toBe(150n);
  });
});

describe('retry exhaustion', () => {
  it('transient failures are retried a bounded number of times, then the payout fails closed', async () => {
    const account = await createAccount(1000n);
    resetProvider({ kind: 'transient', reason: 'provider 503' });
    const retryService = new PayoutService(repo, provider, { maxAttempts: 3, retryBaseMs: 60_000 });
    const retryWorker = new PayoutWorker(repo, retryService, workerConfig);
    const { payout } = await retryService.createPayout({
      accountId: account.id,
      amount: 400n,
      destinationAddress: '0xretry',
      idempotencyKey: `retry-${Date.now()}`,
    });

    await retryWorker.processMessages(); // attempt 1
    expect(providerCalls.length).toBe(1);
    let message = await transferMessageOf(payout.id);
    expect(message?.status).toBe('pending');
    expect(message?.retryCount).toBe(1);
    expect(message?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // real backoff
    expect((await getPayout(payout.id)).status).toBe('created'); // rolled back for retry

    await redeliver(message!.id); // simulate the backoff elapsing
    await retryWorker.processMessages(); // attempt 2
    expect(providerCalls.length).toBe(2);
    message = await transferMessageOf(payout.id);
    expect(message?.retryCount).toBe(2);

    await redeliver(message!.id);
    await retryWorker.processMessages(); // attempt 3 -> exhausted
    expect(providerCalls.length).toBe(3);
    message = await transferMessageOf(payout.id);
    expect(message?.status).toBe('dead');
    expect(message?.retryCount).toBe(3);

    const fresh = await getPayout(payout.id);
    expect(fresh.status).toBe('needs_review');
    expect(fresh.txHash).toBeNull();
    const accountFresh = await getAccount(account.id);
    expect(accountFresh.settledBalance).toBe(1000n); // never settled
    expect(accountFresh.reservedBalance).toBe(400n); // still reserved (fail closed)
    // Only the original reservation entries exist; nothing was released or booked out.
    expect(await prisma.ledgerEntry.count({ where: { payoutId: payout.id } })).toBe(2);
  });

  it('a definitive provider rejection fails the payout and releases the reservation', async () => {
    const account = await createAccount(1000n);
    resetProvider({ kind: 'rejected', reason: 'invalid destination address' });
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: 150n,
      destinationAddress: '0xbad',
      idempotencyKey: `rej-${Date.now()}`,
    });

    await worker.processMessages();

    expect(providerCalls.length).toBe(1);
    const fresh = await getPayout(payout.id);
    expect(fresh.status).toBe('failed');
    const accountFresh = await getAccount(account.id);
    expect(accountFresh.settledBalance).toBe(1000n);
    expect(accountFresh.reservedBalance).toBe(0n); // released back to available
    expect(await bucketNet(account.id, 'reserved')).toBe(0n);
    expect(await bucketNet(account.id, 'available')).toBe(0n);
    expect(await transferMessageOf(payout.id)).toMatchObject({ status: 'done' });
  });
});
