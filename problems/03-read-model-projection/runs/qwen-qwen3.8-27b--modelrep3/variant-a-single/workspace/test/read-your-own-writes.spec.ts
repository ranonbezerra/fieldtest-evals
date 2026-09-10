import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { buildContext, cleanTables, seedCompany, type TestContext } from './helpers.js';

describe('read-your-own-writes (operations dashboard)', () => {
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

  it('an approved order is visible on the very next dashboard request', async () => {
    const { company, event, worker } = await seedCompany(prisma, 'ryw-co');

    const order = await ctx.writes.createOrder({
      companyId: company.id,
      eventId: event.id,
      workerId: worker.id,
      amount: '1250.00',
    });

    const first = await ctx.ops.listDashboard({ companyId: company.id });
    expect(first.total).toBe(1);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      orderId: order.id,
      status: 'pending',
      amount: '1250.00',
      eventName: 'Launch Night',
      workerName: 'Robin Field',
    });

    // Operator approves the order.
    await ctx.writes.transitionStatus(order.id, 'approved');

    // The very next request must already show the approval.
    const second = await ctx.ops.listDashboard({ companyId: company.id });
    expect(second.items[0]).toMatchObject({ orderId: order.id, status: 'approved' });

    // And the exact per-company financial total reflects the approval immediately.
    const totals = await ctx.ops.getCompanyTotals(company.id);
    expect(totals).toMatchObject({
      companyId: company.id,
      operationCount: 1,
      totalAmount: '1250.00',
      approvedAmount: '1250.00',
    });
  });

  it('a worker rename is visible on the next request', async () => {
    const { company, event, worker } = await seedCompany(prisma, 'ryw-co-2');

    const order = await ctx.writes.createOrder({
      companyId: company.id,
      eventId: event.id,
      workerId: worker.id,
      amount: '10.00',
    });
    await ctx.writes.renameWorker(worker.id, 'Sasha Vex');

    const page = await ctx.ops.listDashboard({ companyId: company.id });
    expect(page.items[0]).toMatchObject({ orderId: order.id, workerName: 'Sasha Vex' });
  });
});
