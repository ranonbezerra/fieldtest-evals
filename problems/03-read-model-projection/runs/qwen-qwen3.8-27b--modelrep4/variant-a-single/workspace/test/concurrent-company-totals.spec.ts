import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  createApp,
  createCompanyFixture,
  deleteCompanyFixture,
  withClient,
  type CompanyFixture,
  type DashboardBody,
} from './helpers.js';

const N_APPROVE = 30;
const N_REJECT = 15;
const N_KEEP = 15;

describe('concurrent updates to one company totals', () => {
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

  it('keeps per-company totals exact when status changes land concurrently', async () => {
    const total = N_APPROVE + N_REJECT + N_KEEP;
    const ids: string[] = [];
    const amounts: number[] = [];

    for (let i = 0; i < total; i++) {
      const amountCents = 1000 + i * 7;
      const res = await app.inject('POST', '/payment-orders', {
        companyId: company.companyId,
        workerId: company.workerId,
        amountCents,
      });
      expect(res.statusCode).toBe(201);
      ids.push((res.body as { id: string }).id);
      amounts.push(amountCents);
    }

    const approveIds = ids.slice(0, N_APPROVE);
    const rejectIds = ids.slice(N_APPROVE, N_APPROVE + N_REJECT);

    const results = await Promise.all([
      ...approveIds.map((id) => app.inject('POST', `/payment-orders/${id}/status`, { status: 'approved' })),
      ...rejectIds.map((id) => app.inject('POST', `/payment-orders/${id}/status`, { status: 'rejected' })),
    ]);
    for (const res of results) {
      expect(res.statusCode).toBe(200);
    }

    const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
    const expected = {
      approvedCents: sum(amounts.slice(0, N_APPROVE)),
      rejectedCents: sum(amounts.slice(N_APPROVE, N_APPROVE + N_REJECT)),
      pendingCents: sum(amounts.slice(N_APPROVE + N_REJECT)),
    };

    const body = (await app.inject('GET', `/operations?companyId=${company.companyId}`)).body as DashboardBody;
    expect(body.totals.approved).toEqual({ amountCents: expected.approvedCents, count: N_APPROVE });
    expect(body.totals.rejected).toEqual({ amountCents: expected.rejectedCents, count: N_REJECT });
    expect(body.totals.pending).toEqual({ amountCents: expected.pendingCents, count: N_KEEP });
    expect(body.totals.completed).toEqual({ amountCents: 0, count: 0 });
    expect(body.pagination.totalItems).toBe(total);

    // The per-status lists agree with the aggregates: both the projection rows
    // and the counters moved, consistently.
    const approvedList = (
      await app.inject('GET', `/operations?companyId=${company.companyId}&status=approved&pageSize=100`)
    ).body as DashboardBody;
    expect(approvedList.pagination.totalItems).toBe(N_APPROVE);
    expect(sum(approvedList.items.map((i) => i.amountCents))).toBe(expected.approvedCents);

    const rejectedList = (
      await app.inject('GET', `/operations?companyId=${company.companyId}&status=rejected&pageSize=100`)
    ).body as DashboardBody;
    expect(rejectedList.pagination.totalItems).toBe(N_REJECT);
    expect(sum(rejectedList.items.map((i) => i.amountCents))).toBe(expected.rejectedCents);
  });
});
