import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma.service.js';
import { buildContext, cleanTables, seedCompany, type TestContext } from './helpers.js';

describe('drift repair', () => {
  let prisma: PrismaService;
  let ctx: TestContext;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctx = buildContext(prisma);
    await cleanTables(prisma);
  }, 60000);

  afterEach(async () => {
    await cleanTables(prisma);
  });

  afterAll(async () => {
    await cleanTables(prisma);
    await prisma.$disconnect();
  });

  it('detects drifted rows and repairs the projection and totals for the window', async () => {
    const { company, event, worker } = await seedCompany(prisma, 'drift-co');

    const o1 = await ctx.writes.createOrder({ companyId: company.id, eventId: event.id, workerId: worker.id, amount: '100.00' });
    const o2 = await ctx.writes.createOrder({ companyId: company.id, eventId: event.id, workerId: worker.id, amount: '200.00' });
    const o3 = await ctx.writes.createOrder({ companyId: company.id, eventId: event.id, workerId: worker.id, amount: '300.00' });
    await ctx.writes.transitionStatus(o1.id, 'approved');

    // Simulate drift, as if a maintenance hook had been bypassed:
    // one stale row, one missing row, and the company totals row lost.
    await prisma.operationReadModel.update({
      where: { orderId: o2.id },
      data: { status: 'rejected', amount: new Prisma.Decimal('9999.99') },
    });
    await prisma.operationReadModel.delete({ where: { orderId: o3.id } });
    await prisma.companyOperationTotal.delete({ where: { companyId: company.id } });

    const report = await ctx.driftRepair.run();
    expect(report.missingRows).toBe(1);
    expect(report.staleRows).toBe(1);
    expect(report.ordersRedriven).toBe(3);

    // The dashboard is back in sync with the source tables.
    const page = await ctx.ops.listDashboard({ companyId: company.id });
    expect(page.total).toBe(3);
    const byId = new Map(page.items.map((item) => [item.orderId, item]));
    expect(byId.get(o1.id)).toMatchObject({ status: 'approved', amount: '100.00' });
    expect(byId.get(o2.id)).toMatchObject({ status: 'pending', amount: '200.00' });
    expect(byId.get(o3.id)).toMatchObject({ status: 'pending', amount: '300.00' });

    // And the totals are exact again, re-derived from source.
    const totals = await ctx.ops.getCompanyTotals(company.id);
    expect(totals).toMatchObject({
      operationCount: 3,
      totalAmount: '600.00',
      approvedAmount: '100.00',
    });
  });

  it('re-derives an arbitrary window idempotently and keeps totals exact', async () => {
    const { company, event, worker } = await seedCompany(prisma, 'rederive-co');
    await ctx.writes.createOrder({ companyId: company.id, eventId: event.id, workerId: worker.id, amount: '42.00' });

    const now = Date.now();
    const from = new Date(now - 3600_000);
    const to = new Date(now + 60_000);

    const first = await ctx.rederivation.rederive(from, to);
    expect(first.ordersRedriven).toBe(1);
    expect(first.companiesRecounted).toBe(1);

    const again = await ctx.rederivation.rederive(from, to);
    expect(again.ordersRedriven).toBe(1);
    expect(again.companiesRecounted).toBe(1);

    const totals = await ctx.ops.getCompanyTotals(company.id);
    expect(totals).toMatchObject({ operationCount: 1, totalAmount: '42.00', approvedAmount: '0.00' });
  });
});
