import type { OrderStatus } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ReDerivationService } from '../src/re-derivation/re-derivation.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ListBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('re-derivation for an arbitrary window', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('rebuilds rows and totals from source for the window, ordered by recency', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    const now = new Date();
    const statuses: OrderStatus[] = ['pending', 'approved', 'rejected', 'approved', 'pending'];

    // Source rows only (the write-path hooks were bypassed on purpose).
    const ids: string[] = [];
    for (let i = 0; i < statuses.length; i += 1) {
      const createdAt = new Date(now.getTime() - (i + 1) * 60_000);
      const order = await prisma!.paymentOrder.create({
        data: {
          companyId: fx.companyId,
          workerId: fx.workerId,
          eventId: fx.eventId,
          status: statuses[i],
          amountCents: 100 * (i + 1),
          createdAt,
          updatedAt: createdAt,
        },
      });
      ids.push(order.id);
    }
    // An order outside the window, to prove the boundary is respected.
    const outsideCreatedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await prisma!.paymentOrder.create({
      data: {
        companyId: fx.companyId,
        workerId: fx.workerId,
        eventId: fx.eventId,
        status: 'approved',
        amountCents: 777,
        createdAt: outsideCreatedAt,
        updatedAt: outsideCreatedAt,
      },
    });

    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const deriveService = app!.app.get(ReDerivationService);
    const result = await deriveService.derive(from, now);
    expect(result.rows_rebuilt).toBe(5);

    // The dashboard shows exactly the window, newest first, from the projection.
    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(5);
    expect(listed.body.items.map((item) => item.id)).toEqual(ids);
    expect(listed.body.items.map((item) => item.status)).toEqual(statuses);
    expect(listed.body.items[0]).toMatchObject({
      worker_name: fx.workerName,
      event_name: fx.eventName,
      amount_cents: 100,
    });

    // Totals are rebuilt from the WHOLE history of the company,
    // including the outside-window order.
    const totals = await prisma!.companyFinancialTotals.findUnique({ where: { companyId: fx.companyId } });
    expect(totals?.pendingAmountCents).toBe(BigInt(100 + 500));
    expect(totals?.approvedAmountCents).toBe(BigInt(200 + 400 + 777));
    expect(totals?.rejectedAmountCents).toBe(BigInt(300));
    expect(totals?.ordersCount).toBe(6);
  });

  it('running the same window twice leaves an identical state', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    for (let i = 0; i < 4; i += 1) {
      const createdAt = new Date(Date.now() - (i + 1) * 60_000);
      await prisma!.paymentOrder.create({
        data: {
          companyId: fx.companyId,
          workerId: fx.workerId,
          eventId: fx.eventId,
          status: i % 2 === 0 ? 'pending' : 'approved',
          amountCents: 40 * (i + 1),
          createdAt,
          updatedAt: createdAt,
        },
      });
    }

    const deriveService = app!.app.get(ReDerivationService);
    const from = new Date(Date.now() - 3_600_000);
    await deriveService.derive(from, new Date());

    const snapshot = async () => ({
      rows: plainify(
        await prisma!.operationReadModel.findMany({
          where: { companyId: fx.companyId },
          orderBy: { paymentOrderId: 'asc' },
        }),
      ),
      totals: plainify(await prisma!.companyFinancialTotals.findMany({ orderBy: { companyId: 'asc' } })),
    });

    const first = await snapshot();
    expect(first.rows).toHaveLength(4);
    expect(first.totals.length).toBeGreaterThanOrEqual(1);

    await deriveService.derive(from, new Date());
    const second = await snapshot();
    expect(second).toEqual(first);
  });
});

function plainify<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
