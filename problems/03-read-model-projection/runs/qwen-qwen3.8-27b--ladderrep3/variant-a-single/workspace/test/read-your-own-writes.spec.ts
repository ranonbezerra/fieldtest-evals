import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ErrorBody, ListBody, OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('operations dashboard: read your own writes', () => {
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

  it('shows an approved order on the very next request after approving it', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const created = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId,
      worker_id: fx.workerId,
      event_id: fx.eventId,
      amount_cents: 2500,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    let listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0]).toMatchObject({
      id: orderId,
      company_id: fx.companyId,
      status: 'pending',
      amount_cents: 2500,
      worker_name: fx.workerName,
      event_name: fx.eventName,
    });

    const approved = await postJson<OrderBody>(app!, `/payment-orders/${orderId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    // No delay, no refresher: the next request already reflects the write.
    listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId, status: 'approved' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].status).toBe('approved');

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: '2500',
      rejected_amount_cents: '0',
      orders_count: 1,
    });
  });

  it('shows a rejected order and moves the exact amounts in the totals', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const first = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 1200,
    });
    const second = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 300,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rejected = await postJson<OrderBody>(app!, `/payment-orders/${second.body.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '300',
      orders_count: 2,
    });

    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId, status: 'rejected' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(second.body.id);
  });

  it('never shows an order that only exists in the source table (projection-only read path)', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    // Direct source write, bypassing the write path on purpose.
    await prisma!.paymentOrder.create({
      data: {
        companyId: fx.companyId,
        workerId: fx.workerId,
        eventId: fx.eventId,
        status: 'approved',
        amountCents: 9000,
      },
    });

    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.body.total).toBe(0);
    expect(listed.body.items).toEqual([]);

    const totals = await getJson<ErrorBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(404);
    expect(totals.body.error.code).toBe('resource_not_found');
  });

  it('returns the error envelope for unknown ids, invalid transitions and bad input', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const unknown = await postJson<ErrorBody>(
      app!,
      '/payment-orders/00000000-0000-4000-8000-000000000000/approve',
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({
      error: { code: 'resource_not_found', message: expect.any(String), details: expect.any(Object) },
    });

    const created = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 100,
    });
    await postJson(app!, `/payment-orders/${created.body.id}/approve`);
    const again = await postJson<ErrorBody>(app!, `/payment-orders/${created.body.id}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_state_transition');

    const noCompany = await getJson<ErrorBody>(app!, '/operations', {});
    expect(noCompany.status).toBe(400);
    expect(noCompany.body.error.code).toBe('validation_failed');
    expect(noCompany.body.error.details.company_id).toBeDefined();

    const badStatus = await getJson<ErrorBody>(app!, '/operations', { company_id: fx.companyId, status: 'settled' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('validation_failed');
  });
});
