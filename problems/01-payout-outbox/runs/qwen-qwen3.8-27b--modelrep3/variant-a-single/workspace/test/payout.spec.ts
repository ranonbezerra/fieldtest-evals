import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PAYOUT_WORKER_OPTIONS, PayoutWorker } from '../src/payout/payout.worker.js';
import { DefinitiveTransferError, TRANSFER_PROVIDER } from '../src/payout/transfer.provider.js';
import type { TransferProvider } from '../src/payout/transfer.provider.js';

class FakeProvider implements TransferProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  handler: (args: { to: string; amount: bigint }, callIndex: number) => { txHash: string } = () => ({
    txHash: '0xfake',
  });

  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    const callIndex = this.calls.length;
    this.calls.push(args);
    return this.handler(args, callIndex);
  }
}

describe('payouts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PayoutService;
  let worker: PayoutWorker;
  let provider: FakeProvider;

  const accountRow = async (accountId: string) => {
    const [row] = await prisma.$queryRaw<Array<{ settled_minor: bigint; held_minor: bigint }>>`
      SELECT "settled_minor", "held_minor" FROM "accounts" WHERE "id" = ${accountId}
    `;
    return row;
  };

  const ledgerTotals = async () => {
    const [row] = await prisma.$queryRaw<Array<{ total_debit: bigint; total_credit: bigint }>>`
      SELECT COALESCE(SUM("debit_minor"), 0)::bigint AS "total_debit",
             COALESCE(SUM("credit_minor"), 0)::bigint AS "total_credit"
      FROM "ledger_entries"
    `;
    return row;
  };

  const seedAccount = async (settledMinor: bigint) =>
    prisma.account.create({ data: { settledMinor, heldMinor: 0n } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TRANSFER_PROVIDER)
      .useValue(new FakeProvider())
      .overrideProvider(PAYOUT_WORKER_OPTIONS)
      .useValue({
        autostart: false,
        intervalMs: 10_000,
        batchLimit: 20,
        maxAttempts: 3,
        backoffBaseMs: 1,
        backoffMaxMs: 5,
        staleProcessingMs: 60_000,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(PayoutService);
    worker = app.get(PayoutWorker);
    provider = app.get(TRANSFER_PROVIDER) as FakeProvider;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ledger_entries", "payout_messages", "payouts", "accounts" CASCADE',
    );
    provider.calls = [];
    provider.handler = () => ({ txHash: '0xfake' });
  }, 30_000);

  it('never overdraws an account under concurrent payout requests', async () => {
    const account = await seedAccount(100_000n);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app.getHttpServer()).post('/payouts').send({
          accountId: account.id,
          amount: '40000',
          destinationAddress: `destination-${String(i).padStart(2, '0')}`,
          idempotencyKey: `concurrency-${i}`,
        }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(2);
    expect(rejected).toHaveLength(6);
    expect(created[0].body).toMatchObject({ status: 'CREATED', amount: '40000', duplicate: false });
    expect(new Set(created.map((r) => r.body.id)).size).toBe(2);
    expect(rejected[0].body.error.code).toBe('insufficient_funds');
    expect(rejected[0].body.error.details).toEqual(
      expect.objectContaining({ accountId: account.id, requestedMinor: '40000' }),
    );

    const row = await accountRow(account.id);
    expect(row.settled_minor).toBe(100_000n); // settled balance changes only on confirmation
    expect(row.held_minor).toBe(80_000n); // exactly the two reserves, never more
  }, 20_000);

  it('replays the same idempotency key without a second payout or reserve', async () => {
    const account = await seedAccount(10_000n);
    const body = {
      accountId: account.id,
      amount: '3000',
      destinationAddress: 'destination-01',
      idempotencyKey: 'replay-key',
    };

    const first = await request(app.getHttpServer()).post('/payouts').send(body);
    const second = await request(app.getHttpServer()).post('/payouts').send(body);

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    expect(await prisma.payout.count({ where: { idempotencyKey: 'replay-key' } })).toBe(1);
    const row = await accountRow(account.id);
    expect(row.held_minor).toBe(3000n);
    expect(row.settled_minor).toBe(10_000n);
    const totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);
  });

  it('creates exactly one payout when the same idempotency key is raced', async () => {
    const account = await seedAccount(10_000n);
    const body = {
      accountId: account.id,
      amount: '3000',
      destinationAddress: 'destination-02',
      idempotencyKey: 'race-key',
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => request(app.getHttpServer()).post('/payouts').send(body)),
    );

    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.payout.count({ where: { idempotencyKey: 'race-key' } })).toBe(1);
    expect((await accountRow(account.id)).held_minor).toBe(3000n);
  }, 20_000);

  it('settles a payout once even when its message is delivered twice', async () => {
    const account = await seedAccount(10_000n);
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '2500',
      destinationAddress: 'destination-03',
      idempotencyKey: 'worker-once',
    });

    await worker.processMessages();

    let done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(done?.txHash).toBe('0xfake');
    expect(provider.calls).toHaveLength(1);
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4); // reserve(2) + complete(2)
    let totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);

    // duplicate delivery of the same message
    await prisma.payoutMessage.updateMany({
      where: { payoutId: payout.id },
      data: { status: 'PENDING', processedAt: null, lastError: null },
    });
    await worker.processMessages();

    done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(1); // no second transfer
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4); // no double settlement
    totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);
    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
  });

  it('recovers a payout left in SENT after a crash and settles it exactly once', async () => {
    const account = await seedAccount(10_000n);
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '2500',
      destinationAddress: 'destination-04',
      idempotencyKey: 'crash-1',
    });

    // simulate a crash right after the txHash was recorded, before settlement;
    // the stale claim is then reclaimed by the worker
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'SENT', txHash: '0xcrash', sentAt: new Date() },
    });
    await prisma.payoutMessage.update({
      where: { payoutId: payout.id },
      data: { status: 'PROCESSING', claimedAt: new Date(Date.now() - 120_000) },
    });

    await worker.processMessages();

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(done?.txHash).toBe('0xcrash');
    expect(provider.calls).toHaveLength(0); // no second transfer is attempted
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4);
    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
  });

  it('exhausts bounded retries, keeps funds held and escalates to needs_review', async () => {
    const account = await seedAccount(10_000n);
    provider.handler = () => {
      throw new Error('provider timeout');
    };
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '4000',
      destinationAddress: 'destination-05',
      idempotencyKey: 'retry-1',
    });

    let message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    for (let i = 0; i < 8 && message?.status !== 'DEAD'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await worker.processMessages();
      message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    }

    expect(message?.status).toBe('DEAD');
    expect(message?.attempts).toBe(3);
    expect(message?.lastError).toContain('provider timeout');

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('NEEDS_REVIEW');
    expect(done?.error).toContain('provider timeout');

    // the safe choice: the hold is kept, the settled balance is untouched,
    // and nothing is settled or released in the ledger
    expect((await accountRow(account.id)).settled_minor).toBe(10_000n);
    expect((await accountRow(account.id)).held_minor).toBe(4000n);
    const actions = (
      await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id }, select: { action: true } })
    ).map((e) => e.action);
    expect(actions).toEqual(['RESERVE', 'RESERVE']);
    expect(provider.calls).toHaveLength(3);
  }, 20_000);

  it('fails the payout and releases the hold on a definitive provider rejection', async () => {
    const account = await seedAccount(10_000n);
    provider.handler = () => {
      throw new DefinitiveTransferError('invalid destination address');
    };
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '4000',
      destinationAddress: 'destination-06',
      idempotencyKey: 'definitive-1',
    });

    await worker.processMessages();

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('FAILED');
    expect(done?.error).toContain('invalid destination');
    expect((await accountRow(account.id)).settled_minor).toBe(10_000n);
    expect((await accountRow(account.id)).held_minor).toBe(0n); // hold released back to available

    const actions = (
      await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id }, select: { action: true } })
    )
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual(['RELEASE', 'RESERVE']);
    const totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);

    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
    expect(provider.calls).toHaveLength(1); // a definitive rejection is never retried
  });

  it('answers unknown accounts and invalid bodies with the error envelope', async () => {
    const missingAccount = '00000000-0000-4000-8000-000000000000';

    const notFound = await request(app.getHttpServer()).post('/payouts').send({
      accountId: missingAccount,
      amount: '100',
      destinationAddress: 'destination-07',
      idempotencyKey: 'envelope-1',
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('resource_not_found');
    expect(typeof notFound.body.error.message).toBe('string');
    expect(notFound.body.error.details).toEqual({ account: missingAccount });

    const invalid = await request(app.getHttpServer()).post('/payouts').send({
      accountId: 'not-a-uuid',
      amount: -5,
      destinationAddress: 'short',
      idempotencyKey: '',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('validation_error');
    expect(Array.isArray(invalid.body.error.details.issues)).toBe(true);
    expect(invalid.body.error.details.issues.length).toBeGreaterThanOrEqual(3);
  });
});
