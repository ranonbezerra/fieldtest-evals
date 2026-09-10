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
import { OperationsDriftRepairJob } from '../src/operations/operations-drift-repair.job.js';

const DAY_MS = 86_400_000;

describe('drift repair and re-derivation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('repairs a stale operation view and wrong totals after a lost write hook', async () => {
    const company = await withClient((c) => createCompanyFixture(c));
    try {
      const created = await app.inject('POST', '/payment-orders', {
        companyId: company.companyId,
        workerId: company.workerId,
        eventId: company.eventId,
        amountCents: 500,
      });
      expect(created.statusCode).toBe(201);
      const id = (created.body as { id: string }).id;

      // The source row moved on but the read-model hook was lost (simulated by
      // writing the source directly, bypassing the write path).
      await withClient((c) => c.paymentOrder.update({ where: { id }, data: { status: 'approved' } }));

      let body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items[0]).toMatchObject({ id, status: 'pending' }); // the drift is visible to the operator

      const result = await app.get(OperationsDriftRepairJob).runOnce();
      expect(result.companiesRepaired).toContain(company.companyId);
      expect(result.windowsRepaired).toBeGreaterThanOrEqual(1);

      body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items[0]).toMatchObject({ id, status: 'approved' });
      expect(body.totals.approved).toEqual({ amountCents: 500, count: 1 });
      expect(body.totals.pending).toEqual({ amountCents: 0, count: 0 });
    } finally {
      await withClient((c) => deleteCompanyFixture(c, company));
    }
  });

  it('restores a missing projection row', async () => {
    const company = await withClient((c) => createCompanyFixture(c));
    try {
      const created = await app.inject('POST', '/payment-orders', {
        companyId: company.companyId,
        workerId: company.workerId,
        amountCents: 300,
      });
      const id = (created.body as { id: string }).id;

      // The view row vanished (the create hook was lost after commit).
      await withClient((c) => c.operationView.delete({ where: { id } }));

      let body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items).toHaveLength(0);

      await app.get(OperationsDriftRepairJob).runOnce();

      body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ id, status: 'pending', amountCents: 300, workerName: company.workerName });
      expect(body.totals.pending).toEqual({ amountCents: 300, count: 1 });
    } finally {
      await withClient((c) => deleteCompanyFixture(c, company));
    }
  });

  it('repairs drift older than the lookback window via the totals backstop', async () => {
    const company = await withClient((c) => createCompanyFixture(c));
    try {
      const oldDate = new Date(Date.now() - 20 * DAY_MS);
      const id = randomUUID();

      // A 20-day-old order with a consistent read model.
      await withClient(
        (c) =>
          c.$transaction([
            c.paymentOrder.create({
              data: {
                id,
                companyId: company.companyId,
                workerId: company.workerId,
                eventId: company.eventId,
                status: 'pending',
                amountCents: 100,
                currency: 'USD',
                createdAt: oldDate,
                updatedAt: oldDate,
              },
            }),
            c.operationView.create({
              data: {
                id,
                companyId: company.companyId,
                workerId: company.workerId,
                workerName: company.workerName,
                eventId: company.eventId,
                eventTitle: company.eventTitle,
                eventVenue: 'Grand Hall',
                eventStartsAt: new Date('2025-06-01T18:00:00.000Z'),
                status: 'pending',
                amountCents: 100,
                currency: 'USD',
                createdAt: oldDate,
                updatedAt: oldDate,
              },
            }),
            c.companyOperationTotals.create({
              data: { companyId: company.companyId, pendingCents: 100, pendingCount: 1 },
            }),
          ]),
      );

      // The old order is reprocessed to rejected and the hook is lost. It is
      // outside the day-digest lookback, so only the totals backstop sees it.
      await withClient((c) => c.paymentOrder.update({ where: { id }, data: { status: 'rejected', updatedAt: new Date() } }));

      await app.get(OperationsDriftRepairJob).runOnce();

      const body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items[0]).toMatchObject({ id, status: 'rejected' });
      expect(body.totals.rejected).toEqual({ amountCents: 100, count: 1 });
      expect(body.totals.pending).toEqual({ amountCents: 0, count: 0 });
    } finally {
      await withClient((c) => deleteCompanyFixture(c, company));
    }
  });

  it('re-derives an arbitrary date window on demand', async () => {
    const company = await withClient((c) => createCompanyFixture(c));
    try {
      const a = await app.inject('POST', '/payment-orders', { companyId: company.companyId, amountCents: 111 });
      const b = await app.inject('POST', '/payment-orders', {
        companyId: company.companyId,
        workerId: company.workerId,
        amountCents: 222,
      });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      const idA = (a.body as { id: string }).id;
      const idB = (b.body as { id: string }).id;

      // Corrupt the projection for this company (a lost batch of hooks).
      await withClient((c) => c.operationView.updateMany({ where: { companyId: company.companyId }, data: { status: 'cancelled' } }));
      await withClient((c) =>
        c.companyOperationTotals.update({
          where: { companyId: company.companyId },
          data: { pendingCents: 0, pendingCount: 0, cancelledCents: 333, cancelledCount: 2 },
        }),
      );

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const windowEnd = new Date(todayStart.getTime() + DAY_MS);
      const res = await app.inject('POST', '/operations/rederive', {
        from: todayStart.toISOString(),
        to: windowEnd.toISOString(),
        companyId: company.companyId,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ derived: true, companyId: company.companyId });

      const body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
      expect(body.items).toHaveLength(2);
      expect(body.items.map((i) => i.status).sort()).toEqual(['pending', 'pending']);
      expect(body.items.map((i) => i.id).sort()).toEqual([idA, idB].sort());
      expect(body.totals.pending).toEqual({ amountCents: 333, count: 2 });
      expect(body.totals.cancelled).toEqual({ amountCents: 0, count: 0 });
    } finally {
      await withClient((c) => deleteCompanyFixture(c, company));
    }
  });
});
