/**
 * Behaviour tests for the payout path.
 *
 * They run against a real PostgreSQL database: concurrency, idempotency, and
 * at-least-once redelivery are only meaningful when the database is the
 * actual arbiter. Point DATABASE_URL at a throwaway test database; `pnpm
 * test` applies the migrations first.
 */
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { MessageStatus, PayoutStatus } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutResult } from '../src/payout/payout.service.js';
import { PayoutWorkerService } from '../src/payout/payout-worker.service.js';
import { PAYOUT_PROVIDER } from '../src/payout/payout-provider.js';
import type { PayoutProvider } from '../src/payout/payout-provider.js';
import { InsufficientFundsError } from '../src/payout/payout-errors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Keep the background poll from firing mid-test; make the retry budget explicit.
process.env.WORKER_POLL_INTERVAL_MS = '3600000';
process.env.MAX_PROVIDER_ATTEMPTS = '3';

class FakeProvider implements PayoutProvider {
  readonly calls: Array<{ to: string; amount: bigint }> = [];
  failuresLeft = 0;
  failWith = 'provider timeout (simulated)';

  async transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.calls.push(input);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error(this.failWith);
    }
    return { txHash: `0xtx${this.calls.length}` };
  }
}

let app: INestApplication;
let prisma: PrismaService;
let service: PayoutService;
let worker: PayoutWorkerService;
let provider: FakeProvider;
const createdAccountIds: string[] = [];

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a test Postgres database (see .env.example)');
  }
  provider = new FakeProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYOUT_PROVIDER)
    .useValue(provider)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  service = app.get(PayoutService);
  worker = app.get(PayoutWorkerService);
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

afterEach(async () => {
  const ids = createdAccountIds.splice(0);
  if (ids.length === 0) {
    return;
  }
  const payouts = await prisma.payout.findMany({
    where: { accountId: { in: ids } },
    select: { id: true },
  });
  const payoutIds = payouts.map((p) => p.id);
  if (payoutIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.outboxMessage.deleteMany({ where: { payoutId: { in: payoutIds } } });
  }
  await prisma.payout.deleteMany({ where: { accountId: { in: ids } } });
  await prisma.account.deleteMany({ where: { id: { in: ids } } });
});

beforeEach(() => {
  provider.calls.length = 0;
  provider.failuresLeft = 0;
});

async function createAccount(settled: bigint): Promise<{ id: string }> {
  const account = await prisma.account.create({ data: { settled } });
  createdAccountIds.push(account.id);
  return account;
}

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Drive one message through the worker until it is terminal or `rounds` are used up. */
async function driveMessage(messageId: string, rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    const message = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: messageId } });
    if (message.status === MessageStatus.PROCESSED) {
      return;
    }
    if (message.status === MessageStatus.PENDING) {
      // Simulate the backoff elapsing.
      await prisma.outboxMessage.update({
        where: { id: messageId },
        data: { nextAttemptAt: new Date(0) },
      });
    }
    await worker.processMessage(messageId);
  }
}

describe('concurrent creation against one account', () => {
  it('exactly one of two racing 30.00 payouts on a 40.00 account is created', async () => {
    const account = await createAccount(4000n);
    const results = await Promise.allSettled([
      service.createPayout({
        accountId: account.id,
        amount: '3000',
        destinationAddress: '0xdestA',
        idempotencyKey: key('conc-a'),
      }),
      service.createPayout({
        accountId: account.id,
        amount: '3000',
        destinationAddress: '0xdestB',
        idempotencyKey: key('conc-b'),
      }),
    ]);

    const wins = results.filter((r): r is PromiseFulfilledResult<PayoutResult> => r.status === 'fulfilled');
    const losses = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0].reason).toBeInstanceOf(InsufficientFundsError);

    const payouts = await prisma.payout.findMany({ where: { accountId: account.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe(PayoutStatus.CREATED);
    expect(payouts[0].amount).toBe(3000n);

    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.settled).toBe(4000n); // the settled balance never moved
    expect(acct.reserved).toBe(3000n); // exactly one reservation, no overdraft

    const messages = await prisma.outboxMessage.findMany({ where: { payoutId: payouts[0].id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe(MessageStatus.PENDING);
  });

  it('racing retries with the same idempotency key create one payout', async () => {
    const account = await createAccount(5000n);
    const body = {
      accountId: account.id,
      amount: '2500',
      destinationAddress: '0xdest',
      idempotencyKey: key('idem-conc'),
    };
    const [first, second] = await Promise.all([service.createPayout(body), service.createPayout(body)]);

    expect(first.payout.id).toBe(second.payout.id);
    expect(first.replayed !== second.replayed).toBe(true);

    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.reserved).toBe(2500n); // reserved exactly once
    expect(acct.settled).toBe(5000n);
    expect(await prisma.payout.count({ where: { accountId: account.id } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { payoutId: first.payout.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { payoutId: first.payout.id } })).toBe(2);
  });

  it('a sequential replay returns the original payout and reserves nothing further', async () => {
    const account = await createAccount(5000n);
    const body = {
      accountId: account.id,
      amount: '1200',
      destinationAddress: '0xdest',
      idempotencyKey: key('idem-seq'),
    };
    const first = await service.createPayout(body);
    const second = await service.createPayout(body);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payout).toEqual(first.payout);

    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.reserved).toBe(1200n);
    expect(await prisma.payout.count({ where: { accountId: account.id } })).toBe(1);
  });
});

describe('settlement on provider confirmation', () => {
  it('moves the settled balance only when the worker holds a txHash from the provider', async () => {
    const account = await createAccount(5000n);
    const result = await service.createPayout({
      accountId: account.id,
      amount: '1500',
      destinationAddress: '0xdest',
      idempotencyKey: key('settle'),
    });

    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(before.settled).toBe(5000n);
    expect(before.reserved).toBe(1500n);

    await worker.processMessages();

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
    expect(payout.txHash).toBe('0xtx1');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual({ to: '0xdest', amount: 1500n });

    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.settled).toBe(3500n);
    expect(after.reserved).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id } });
    expect(entries).toHaveLength(4);
    const kinds = entries.map((e) => `${e.side}:${e.bucket}`).sort();
    expect(kinds).toEqual(['CREDIT:AVAILABLE', 'CREDIT:HELD', 'DEBIT:HELD', 'DEBIT:PAID_OUT'].sort());
  });
});

describe('duplicate message delivery', () => {
  it('delivering the same message twice results in exactly one transfer', async () => {
    const account = await createAccount(5000n);
    const result = await service.createPayout({
      accountId: account.id,
      amount: '2000',
      destinationAddress: '0xdest',
      idempotencyKey: key('dup'),
    });
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { payoutId: result.payout.id },
    });

    await worker.processMessage(message.id); // first delivery
    expect(provider.calls).toHaveLength(1);

    // Duplicate #1: the same id is handed to the worker again immediately.
    await worker.processMessage(message.id);
    // Duplicate #2: the queue redelivers the row, as an at-least-once queue
    // would after a crash.
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: { status: MessageStatus.PENDING, nextAttemptAt: new Date(0) },
    });
    await worker.processMessages();

    expect(provider.calls).toHaveLength(1); // still exactly one transfer
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.settled).toBe(3000n); // debited exactly once
    expect(acct.reserved).toBe(0n);
    const final = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(final.status).toBe(MessageStatus.PROCESSED);
  });

  it('never calls the provider again once a txHash is on record', async () => {
    const account = await createAccount(5000n);
    const result = await service.createPayout({
      accountId: account.id,
      amount: '1000',
      destinationAddress: '0xdest',
      idempotencyKey: key('crash'),
    });

    // Simulate a worker that recorded the hash and died before settling.
    await prisma.payout.update({
      where: { id: result.payout.id },
      data: { status: PayoutStatus.SENT, txHash: '0xrecorded' },
    });
    await prisma.outboxMessage.updateMany({
      where: { payoutId: result.payout.id },
      data: { status: MessageStatus.PENDING, nextAttemptAt: new Date(0) },
    });

    await worker.processMessages();

    expect(provider.calls).toHaveLength(0); // no second transfer
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
    expect(payout.txHash).toBe('0xrecorded');
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.settled).toBe(4000n);
    expect(acct.reserved).toBe(0n);
  });
});

describe('retry exhaustion', () => {
  it('parks the payout in NEEDS_REVIEW with the reservation intact and nothing reversed', async () => {
    const account = await createAccount(5000n);
    provider.failuresLeft = 1000;
    const result = await service.createPayout({
      accountId: account.id,
      amount: '2000',
      destinationAddress: '0xdest',
      idempotencyKey: key('retry'),
    });
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { payoutId: result.payout.id },
    });

    await driveMessage(message.id, 5); // more than enough for MAX_PROVIDER_ATTEMPTS = 3

    expect(provider.calls).toHaveLength(3); // bounded
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
    expect(payout.status).toBe(PayoutStatus.NEEDS_REVIEW);
    expect(payout.txHash).toBeNull();
    expect(payout.lastError).toContain('provider timeout');

    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.settled).toBe(5000n); // nothing debited
    expect(acct.reserved).toBe(2000n); // hold intact, nothing released

    const msg = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(msg.status).toBe(MessageStatus.PROCESSED); // parked, not retried forever

    // Further deliveries change nothing.
    await driveMessage(message.id, 3);
    expect(provider.calls).toHaveLength(3);
    const still = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(still.settled).toBe(5000n);
    expect(still.reserved).toBe(2000n);
  });

  it('succeeds when the provider recovers within the budget', async () => {
    const account = await createAccount(5000n);
    provider.failuresLeft = 2; // fail twice, then confirm
    const result = await service.createPayout({
      accountId: account.id,
      amount: '1000',
      destinationAddress: '0xdest',
      idempotencyKey: key('recover'),
    });
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { payoutId: result.payout.id },
    });

    await driveMessage(message.id, 5);

    expect(provider.calls).toHaveLength(3);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: result.payout.id } });
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
    expect(payout.txHash).toBe('0xtx3');
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.settled).toBe(4000n);
    expect(acct.reserved).toBe(0n);
  });
});

describe('POST /payouts over HTTP', () => {
  it('returns 201 and the payout view for a new payout', async () => {
    const account = await createAccount(1000n);
    const res = await request(app.getHttpServer())
      .post('/payouts')
      .send({
        accountId: account.id,
        amount: '500',
        destinationAddress: '0xdest',
        idempotencyKey: key('http'),
      })
      .expect(201);
    expect(res.body).toMatchObject({ amount: '500', accountId: account.id, status: 'CREATED' });
    expect(typeof res.body.id).toBe('string');
  });

  it('returns 200 with the original payout on a replay of the same key', async () => {
    const account = await createAccount(1000n);
    const body = {
      accountId: account.id,
      amount: '300',
      destinationAddress: '0xdest',
      idempotencyKey: key('http-replay'),
    };
    const first = await request(app.getHttpServer()).post('/payouts').send(body).expect(201);
    const second = await request(app.getHttpServer()).post('/payouts').send(body).expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body).toEqual(first.body);
  });

  it('answers insufficient funds with the error envelope', async () => {
    const account = await createAccount(100n);
    const res = await request(app.getHttpServer())
      .post('/payouts')
      .send({
        accountId: account.id,
        amount: '500',
        destinationAddress: '0xdest',
        idempotencyKey: key('http-ins'),
      })
      .expect(422);
    expect(res.body.error.code).toBe('insufficient_funds');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).toEqual({ accountId: account.id });
  });

  it('answers an unknown account with the error envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/payouts')
      .send({
        accountId: crypto.randomUUID(),
        amount: '1',
        destinationAddress: '0xdest',
        idempotencyKey: key('http-404'),
      })
      .expect(404);
    expect(res.body.error.code).toBe('account_not_found');
    expect(res.body.error.details).toEqual({ accountId: expect.any(String) });
  });

  it('answers a malformed amount with the error envelope', async () => {
    const account = await createAccount(100n);
    const res = await request(app.getHttpServer())
      .post('/payouts')
      .send({
        accountId: account.id,
        amount: '12.50',
        destinationAddress: '0xdest',
        idempotencyKey: key('http-400'),
      })
      .expect(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(Array.isArray(res.body.error.details.violations)).toBe(true);
  });
});
