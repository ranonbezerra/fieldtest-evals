import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';
import { PAYOUT_PROVIDER } from '../src/payout/payout.provider.js';

// Requires DATABASE_URL in the environment (Postgres).

type TransferCall = { to: string; amount: bigint };

let app: INestApplication;
let prisma: PrismaService;
let worker: PayoutWorker;
let transferCalls: TransferCall[] = [];
let providerFails = false;

const provider = {
  transfer: async (to: string, amount: bigint): Promise<{ txHash: string }> => {
    transferCalls.push({ to, amount });
    if (providerFails) {
      throw new Error('provider unavailable');
    }
    return { txHash: `tx-${transferCalls.length}` };
  },
};

const payoutBody = (idempotencyKey: string, amount = '60') => ({
  accountId: 'acc-1',
  amount,
  destinationAddress: '0xdestination',
  idempotencyKey,
});

beforeAll(async () => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
  process.env.PAYOUT_RETRY_BACKOFF_MS = '0';
  process.env.WORKER_MESSAGE_LEASE_MS = '60000';
  process.env.WORKER_BATCH_SIZE = '20';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYOUT_PROVIDER)
    .useValue(provider)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  prisma = app.get(PrismaService);
  worker = app.get(PayoutWorker);
}, 30_000);

afterAll(async () => {
  await app.close();
}, 30_000);

beforeEach(async () => {
  transferCalls = [];
  providerFails = false;
  await prisma.$executeRawUnsafe('TRUNCATE "accounts", "payouts", "messages", "ledger_entries" CASCADE');
}, 30_000);

const seedAccount = (id: string, settled: bigint) =>
  prisma.account.create({
    data: { id, settledMinorUnits: settled, reservedMinorUnits: 0n, availableMinorUnits: settled },
  });

const postPayouts = (body: unknown) => request(app.getHttpServer()).post('/payouts').send(body);

describe('POST /payouts', () => {
  it('lets exactly one of racing requests reserve the funds', async () => {
    await seedAccount('acc-1', 100n);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => postPayouts(payoutBody(`key-${i}`))),
    );
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(created[0].body.status).toBe('created');
    expect(created[0].body.amount).toBe('60');
    for (const r of rejected) {
      expect(r.body.error.code).toBe('insufficient_funds');
      expect(r.body.error.details).toBeTypeOf('object');
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.settledMinorUnits).toBe(100n);
    expect(account.reservedMinorUnits).toBe(60n);
    expect(account.availableMinorUnits).toBe(40n);

    const payouts = await prisma.payout.findMany({ where: { accountId: 'acc-1' } });
    expect(payouts).toHaveLength(1);

    const ledger = await prisma.ledgerEntry.findMany({ where: { payoutId: payouts[0].id } });
    expect(ledger).toHaveLength(2);
    expect(ledger.reduce((sum, e) => sum + e.amountMinorUnits, 0n)).toBe(0n);
  });

  it('replays the original payout for a repeated idempotencyKey', async () => {
    await seedAccount('acc-1', 100n);
    const body = payoutBody('same-key');

    const first = await postPayouts(body);
    const second = await postPayouts(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.availableMinorUnits).toBe(40n);
    expect(account.reservedMinorUnits).toBe(60n);
    expect(await prisma.payout.count({ where: { accountId: 'acc-1' } })).toBe(1);
    expect(await prisma.message.count()).toBe(1);
  });

  it('rejects a different payload that reuses an idempotencyKey', async () => {
    await seedAccount('acc-1', 100n);
    expect((await postPayouts(payoutBody('same-key'))).status).toBe(201);

    const conflict = await postPayouts(payoutBody('same-key', '70'));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');
    expect(await prisma.payout.count({ where: { accountId: 'acc-1' } })).toBe(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.availableMinorUnits).toBe(40n);
  });
});

describe('worker: at-least-once delivery', () => {
  it('moves the settled balance exactly once even when the message is redelivered', async () => {
    await seedAccount('acc-1', 100n);
    const created = await postPayouts(payoutBody('k1'));
    expect(created.status).toBe(201);

    // Creation must not move the settled balance.
    let account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.settledMinorUnits).toBe(100n);

    await worker.processMessages();

    expect(transferCalls).toHaveLength(1);
    const payout = await prisma.payout.findFirstOrThrow({ where: { accountId: 'acc-1' } });
    expect(payout.status).toBe('completed');
    expect(payout.txHash).toBe('tx-1');
    account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.settledMinorUnits).toBe(40n);
    expect(account.reservedMinorUnits).toBe(0n);
    expect(account.availableMinorUnits).toBe(40n);

    // Simulate an at-least-once redelivery of the same message.
    await prisma.message.update({
      where: { payoutId: payout.id },
      data: { status: 'pending', nextTryAt: new Date(0), leasedAt: null },
    });
    await worker.processMessages();

    expect(transferCalls).toHaveLength(1);
    account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.settledMinorUnits).toBe(40n);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('completed');
    expect((await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } })).status).toBe('done');
  });

  it('never re-sends a transfer whose first attempt outcome is unknown', async () => {
    await seedAccount('acc-1', 100n);
    const created = await postPayouts(payoutBody('k2'));
    expect(created.status).toBe(201);

    // A worker died after starting the provider call: attempt in flight,
    // lease expired, message still "processing".
    await prisma.payout.update({
      where: { id: created.body.id },
      data: { status: 'processing', attemptState: 'in_flight' },
    });
    const message = await prisma.message.findUniqueOrThrow({ where: { payoutId: created.body.id } });
    await prisma.message.update({
      where: { id: message.id },
      data: { status: 'processing', leasedAt: new Date(Date.now() - 120_000) },
    });

    await worker.processMessages();

    expect(transferCalls).toHaveLength(0);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(payout.status).toBe('needs_review');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.reservedMinorUnits).toBe(60n);
    expect(account.settledMinorUnits).toBe(100n);
  });
});

describe('worker: retry exhaustion', () => {
  it('parks for review with the reservation intact after bounded retries', async () => {
    providerFails = true;
    await seedAccount('acc-1', 100n);
    expect((await postPayouts(payoutBody('k3'))).status).toBe(201);

    for (let i = 0; i < 6; i++) {
      await worker.processMessages();
      if ((await prisma.payout.findFirstOrThrow({ where: { accountId: 'acc-1' } })).status === 'needs_review') {
        break;
      }
    }

    expect(transferCalls).toHaveLength(3);
    const payout = await prisma.payout.findFirstOrThrow({ where: { accountId: 'acc-1' } });
    expect(payout.status).toBe('needs_review');
    expect(payout.attempts).toBe(3);
    expect(payout.txHash).toBeNull();

    const account = await prisma.account.findUniqueOrThrow({ where: { id: 'acc-1' } });
    expect(account.settledMinorUnits).toBe(100n);
    expect(account.reservedMinorUnits).toBe(60n);
    expect(account.availableMinorUnits).toBe(40n);
    // Only the reservation pair was posted; nothing was reversed.
    expect(await prisma.ledgerEntry.count()).toBe(2);

    // Parking is terminal: the provider is not called again.
    await worker.processMessages();
    expect(transferCalls).toHaveLength(3);
  });
});
