import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountNotFoundError, InsufficientFundsError } from '../src/common/service-error.js';
import type { PayoutProvider } from '../src/payout/blockchain-provider.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';

// Integration tests against a real PostgreSQL (DATABASE_URL).
// Apply the schema first: pnpm prisma migrate deploy

const prisma = new PrismaClient();
const ACCOUNT_ID = 'acc_spec_1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ProviderMode = 'ok' | 'transient-fail' | 'definitive-fail';

class FakeProvider implements PayoutProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  mode: ProviderMode = 'ok';
  private counter = 0;

  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.calls.push(args);
    this.counter += 1;
    if (this.mode === 'transient-fail') {
      throw new Error(`transient provider failure #${this.counter}`);
    }
    if (this.mode === 'definitive-fail') {
      const err = new Error('invalid destination address (definitive)') as Error & { permanent: boolean };
      err.permanent = true;
      throw err;
    }
    return { txHash: `0x${this.counter}` };
  }
}

let repo: PayoutRepository;
let service: PayoutService;
let worker: PayoutWorker;
let provider: FakeProvider;

beforeEach(async () => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
  process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.outboxMessage.deleteMany({}),
    prisma.payout.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
  provider = new FakeProvider();
  repo = new PayoutRepository(prisma);
  service = new PayoutService(repo, provider);
  worker = new PayoutWorker(repo, service);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedAccount(settledMinor: bigint, heldMinor = 0n): Promise<void> {
  await prisma.account.create({
    data: { id: ACCOUNT_ID, settledBalanceMinor: settledMinor, heldBalanceMinor: heldMinor },
  });
}

function createInput(amountMinor: bigint, idempotencyKey: string) {
  return { accountId: ACCOUNT_ID, amountMinor, destinationAddress: '0xdestination', idempotencyKey };
}

async function onlyMessage(): Promise<{ id: string; status: string; attempts: number }> {
  const [message] = await prisma.outboxMessage.findMany();
  if (message === undefined) {
    throw new Error('expected exactly one outbox message, found none');
  }
  return { id: message.id, status: message.status, attempts: message.attempts };
}

describe('concurrent creation against one account', () => {
  it('never overdraws when requests race', async () => {
    await seedAccount(1000n);
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) => service.createPayout(createInput(1000n, `key-${i}`))),
    );

    const created = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      if (r.status !== 'rejected') throw new Error('unreachable');
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n); // holds do not change the settled balance
    expect(account.heldBalanceMinor).toBe(1000n); // exactly one payout was reserved
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);

    await expect(service.createPayout(createInput(1n, 'key-after'))).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('retries with the same idempotencyKey create no second payout and reserve nothing extra', async () => {
    await seedAccount(1000n);

    const [a, b] = await Promise.all([
      service.createPayout(createInput(600n, 'same-key')),
      service.createPayout(createInput(600n, 'same-key')),
    ]);
    expect(a.payout.id).toBe(b.payout.id);
    expect(a.replayed !== b.replayed).toBe(true);

    const c = await service.createPayout(createInput(600n, 'same-key'));
    expect(c.payout.id).toBe(a.payout.id);
    expect(c.replayed).toBe(true);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(600n);
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
  });

  it('rejects an unknown account', async () => {
    await expect(
      service.createPayout({ accountId: 'missing', amountMinor: 1n, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe('duplicate message delivery (at-least-once)', () => {
  it('redelivering a processed message does not call the provider again', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(400n, 'dup-key'));
    const message = await onlyMessage();
    expect(message.status).toBe('PENDING');

    await worker.processMessage(message.id);
    const afterFirst = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.txHash).toBe('0x1');
    expect(provider.calls).toHaveLength(1);

    // At-least-once redelivery of the same message.
    await worker.processMessage(message.id);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(600n); // debited exactly once
    expect(account.heldBalanceMinor).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(4); // created group + sent group, two entries each
    const groups = new Set(entries.map((e) => e.groupId));
    expect(groups.size).toBe(2);
    for (const groupId of groups) {
      const group = entries.filter((e) => e.groupId === groupId);
      const debits = group.filter((e) => e.direction === 'DEBIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      const credits = group.filter((e) => e.direction === 'CREDIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('redelivering an in-flight message never triggers a second transfer', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(300n, 'inflight-key'));
    const message = await onlyMessage();

    // Simulate a worker crash mid-attempt: the message was claimed and the
    // payout moved to PROCESSING, but the worker died before recording the
    // provider outcome.
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: { status: 'PROCESSING', claimedAt: new Date() },
    });

    await worker.processMessage(message.id);

    expect(provider.calls).toHaveLength(0); // no second transfer attempt
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(300n); // the hold is retained
  });
});

describe('retry exhaustion', () => {
  it('stops after the bounded number of attempts, keeps funds held, and flags needs-review', async () => {
    await seedAccount(1000n);
    provider.mode = 'transient-fail';
    const { payout } = await service.createPayout(createInput(500n, 'exhaust-key'));

    await worker.processMessages(); // attempt 1
    expect(provider.calls).toHaveLength(1);
    let message = await onlyMessage();
    expect(message.status).toBe('PENDING'); // requeued
    expect(message.attempts).toBe(1);

    await sleep(50); // let the retry backoff elapse
    await worker.processMessages(); // attempt 2
    expect(provider.calls).toHaveLength(2);
    message = await onlyMessage();
    expect(message.attempts).toBe(2);

    await sleep(80); // the backoff has grown
    await worker.processMessages(); // attempt 3 → exhausted
    expect(provider.calls).toHaveLength(3);
    message = await onlyMessage();
    expect(message.status).toBe('DEAD');

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    expect(after.txHash).toBeNull();
    expect(after.errorMessage).toContain('retries exhausted');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(500n); // funds stay held, not released

    // No further automatic delivery happens.
    await worker.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});

describe('definitive provider failure', () => {
  it('marks the payout failed and releases the hold', async () => {
    await seedAccount(1000n);
    provider.mode = 'definitive-fail';
    const { payout } = await service.createPayout(createInput(350n, 'def-key'));
    const message = await onlyMessage();

    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('FAILED');
    expect(after.errorMessage).toContain('definitive');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(0n); // hold released, funds back to available

    const finalMessage = await onlyMessage();
    expect(finalMessage.status).toBe('DONE');
  });
});
