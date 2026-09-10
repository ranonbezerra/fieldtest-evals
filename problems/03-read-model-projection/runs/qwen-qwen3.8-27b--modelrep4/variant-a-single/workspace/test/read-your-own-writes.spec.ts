import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  createApp,
  createCompanyFixture,
  deleteCompanyFixture,
  withClient,
  type CompanyFixture,
  type DashboardBody,
} from './helpers.js';

describe('read-your-own-writes: operations dashboard', () => {
  let app: INestApplication;
  let company: CompanyFixture;

  beforeAll(async () => {
    app = await createApp();
    company = await withClient((c) => createCompanyFixture(c));
  });

  afterAll(async () => {
    await withClient((c) => deleteCompanyFixture(c, company));
    await app.close();
  });

  it('shows each write on the very next request, with exact per-company totals', async () => {
    const created = await app.inject('POST', '/payment-orders', {
      companyId: company.companyId,
      workerId: company.workerId,
      eventId: company.eventId,
      amountCents: 1250,
    });
    expect(created.statusCode).toBe(201);
    const order1 = (created.body as { id: string }).id;

    let body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: order1,
      status: 'pending',
      amountCents: 1250,
      workerName: company.workerName,
      eventTitle: company.eventTitle,
      eventVenue: 'Grand Hall',
    });
    expect(body.totals.pending).toEqual({ amountCents: 1250, count: 1 });

    const approved = await app.inject('POST', `/payment-orders/${order1}/status`, { status: 'approved' });
    expect(approved.statusCode).toBe(200);
    body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
    expect(body.items[0]).toMatchObject({ id: order1, status: 'approved' });
    expect(body.totals.approved).toEqual({ amountCents: 1250, count: 1 });
    expect(body.totals.pending).toEqual({ amountCents: 0, count: 0 });

    const completed = await app.inject('POST', `/payment-orders/${order1}/status`, { status: 'completed' });
    expect(completed.statusCode).toBe(200);

    const created2 = await app.inject('POST', '/payment-orders', {
      companyId: company.companyId,
      workerId: company.workerId,
      amountCents: 300,
    });
    const order2 = (created2.body as { id: string }).id;
    const rejected = await app.inject('POST', `/payment-orders/${order2}/status`, { status: 'rejected' });
    expect(rejected.statusCode).toBe(200);

    const created3 = await app.inject('POST', '/payment-orders', {
      companyId: company.companyId,
      amountCents: 400,
    });
    expect(created3.statusCode).toBe(201);

    body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
    expect(body.pagination.totalItems).toBe(3);
    expect(body.totals.completed).toEqual({ amountCents: 1250, count: 1 });
    expect(body.totals.rejected).toEqual({ amountCents: 300, count: 1 });
    expect(body.totals.pending).toEqual({ amountCents: 400, count: 1 });
    expect(body.totals.approved).toEqual({ amountCents: 0, count: 0 });
  });

  it('filters by status and date range without changing row content', async () => {
    const completed = (await app.inject('GET', `/operations?companyId=${company.companyId}&status=completed`)).body as DashboardBody;
    expect(completed.items).toHaveLength(1);
    expect(completed.items[0].status).toBe('completed');

    const none = (await app.inject('GET', `/operations?companyId=${company.companyId}&status=cancelled`)).body as DashboardBody;
    expect(none.items).toHaveLength(0);
    expect(none.pagination.totalItems).toBe(0);

    const inRange = (
      await app.inject(
        'GET',
        `/operations?companyId=${company.companyId}` +
          `&from=${new Date(Date.now() - 3_600_000).toISOString()}` +
          `&to=${new Date(Date.now() + 3_600_000).toISOString()}`,
      )
    ).body as DashboardBody;
    expect(inRange.pagination.totalItems).toBe(3);

    const future = (
      await app.inject(
        'GET',
        `/operations?companyId=${company.companyId}` +
          `&from=${new Date(Date.now() + 3_600_000).toISOString()}` +
          `&to=${new Date(Date.now() + 7_200_000).toISOString()}`,
      )
    ).body as DashboardBody;
    expect(future.pagination.totalItems).toBe(0);
  });

  it('paginates without overlap or gaps', async () => {
    const page1 = (await app.inject('GET', `/operations?companyId=${company.companyId}&pageSize=2&page=1`)).body as DashboardBody;
    const page2 = (await app.inject('GET', `/operations?companyId=${company.companyId}&pageSize=2&page=2`)).body as DashboardBody;
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(page1.pagination.totalItems).toBe(3);
    expect(page1.pagination.totalPages).toBe(2);
    const seen = new Set([...page1.items, ...page2.items].map((i) => i.id));
    expect(seen.size).toBe(3);
  });

  it('rejects invalid writes with the single error envelope', async () => {
    const body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
    const completedId = body.items.find((i) => i.status === 'completed')!.id;

    const invalidTransition = await app.inject('POST', `/payment-orders/${completedId}/status`, { status: 'approved' });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.body).toMatchObject({
      error: { code: 'invalid_transition', details: { from: 'completed', to: 'approved' } },
    });
    expect(typeof invalidTransition.body.error.message).toBe('string');
    expect(invalidTransition.body.error.details).toBeTypeOf('object');

    const notFound = await app.inject('POST', `/payment-orders/${randomUUID()}/status`, { status: 'approved' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.body.error.code).toBe('resource_not_found');

    const unknownStatus = await app.inject('POST', `/payment-orders/${completedId}/status`, { status: 'shipped' });
    expect(unknownStatus.statusCode).toBe(400);
    expect(unknownStatus.body.error.code).toBe('validation_error');
  });

  it('serves a 5000-row company dashboard in p95 < 50ms', async () => {
    const latencyCompany = await withClient((c) => createCompanyFixture(c));
    try {
      const now = Date.now();
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        id: randomUUID(),
        companyId: latencyCompany.companyId,
        workerId: latencyCompany.workerId,
        eventId: i % 2 === 0 ? latencyCompany.eventId : null,
        status: 'pending',
        amountCents: 100 + (i % 997),
        currency: 'USD',
        createdAt: new Date(now - i * 5 * 60 * 1000),
        updatedAt: new Date(now - i * 5 * 60 * 1000),
      }));
      await withClient((c) => c.paymentOrder.createMany({ data: rows }));

      // Build the read model for the seeded window via the re-derivation routine.
      const oldest = new Date(now - (rows.length - 1) * 5 * 60 * 1000).toISOString();
      const newest = new Date(now + 60 * 1000).toISOString();
      const rederived = await app.inject('POST', '/operations/rederive', { from: oldest, to: newest });
      expect(rederived.statusCode).toBe(200);
      expect(rederived.body).toMatchObject({ derived: true });

      const listed = (await app.inject('GET', `/operations?companyId=${latencyCompany.companyId}`)).body as DashboardBody;
      expect(listed.pagination.totalItems).toBe(5000);
      expect(listed.totals.pending.count).toBe(5000);

      const latencies: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = process.hrtime.bigint();
        const res = await app.inject('GET', `/operations?companyId=${latencyCompany.companyId}`);
        latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
        expect(res.statusCode).toBe(200);
      }
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.ceil(0.95 * latencies.length) - 1];
      expect(p95).toBeLessThan(50);
    } finally {
      await withClient((c) => deleteCompanyFixture(c, latencyCompany));
    }
  });
});
