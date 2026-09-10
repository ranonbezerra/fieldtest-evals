import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ListBody, OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
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

  it('applies 24 concurrent transitions on the same totals row without losing any', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = Array.from({ length: 24 }, (_, i) => 100 + i); // 100..123
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<OrderBody>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    // 12 approves + 12 rejects, all in flight at once, all moving the same
    // company_financial_totals row.
    const responses = await Promise.all([
      ...ids.slice(0, 12).map((id) => postJson(app!, `/payment-orders/${id}/approve`)),
      ...ids.slice(12).map((id) => postJson(app!, `/payment-orders/${id}/reject`)),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const approvedSum = amounts.slice(0, 12).reduce((sum, value) => sum + value, 0);
    const rejectedSum = amounts.slice(12).reduce((sum, value) => sum + value, 0);

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: String(approvedSum),
      rejected_amount_cents: String(rejectedSum),
      orders_count: 24,
    });

    // The totals must equal an aggregation of the source table, exactly.
    const grouped = await prisma!.paymentOrder.groupBy({
      by: ['status'],
      where: { companyId: fx.companyId },
      _sum: { amountCents: true },
    });
    const sumFor = (status: string): number =>
      grouped.find((g) => g.status === status)?._sum.amountCents ?? 0;
    expect(sumFor('approved')).toBe(approvedSum);
    expect(sumFor('rejected')).toBe(rejectedSum);
    expect(sumFor('pending')).toBe(0);

    // And the dashboard reflects every one of them.
    const approvedList = await getJson<ListBody>(app!, '/operations', {
      company_id: fx.companyId, status: 'approved',
    });
    const rejectedList = await getJson<ListBody>(app!, '/operations', {
      company_id: fx.companyId, status: 'rejected',
    });
    expect(approvedList.body.total).toBe(12);
    expect(rejectedList.body.total).toBe(12);
  });

  it('creates the totals row exactly once under concurrent first writes', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const responses = await Promise.all(
      [500, 700].map((amountCents) =>
        postJson<OrderBody>(app!, '/payment-orders', {
          company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
        }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '0',
      orders_count: 2,
    });
  });
});
