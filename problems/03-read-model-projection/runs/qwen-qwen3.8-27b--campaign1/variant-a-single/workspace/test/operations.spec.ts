import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/common/prisma.service.js';
import { cleanupAll, createTestContext, seedCompany, seedEvents, seedWorkers, type TestContext } from './helpers.js';

describe('operations dashboard — read-your-own-writes and query behaviour', () => {
  let ctx: TestContext;
  let prisma: PrismaService;

  beforeAll(async () => {
    ctx = await createTestContext();
    prisma = ctx.prisma;
    await cleanupAll(prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await cleanupAll(prisma);
  });

  it('shows a newly created order on the very next dashboard request, with worker and event denormalized', async () => {
    const company = await seedCompany(prisma, 'Acme Logistics');
    const [worker] = await seedWorkers(prisma, 1, 'Ops');
    const [event] = await seedEvents(prisma, 1, 'Load');

    const order = await ctx.ordersService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amount: 150.75,
    });

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
    const row = page.data[0];
    expect(row.id).toBe(order.id);
    expect(row.status).toBe('pending');
    expect(row.workerId).toBe(worker.id);
    expect(row.workerName).toBe(worker.name);
    expect(row.eventId).toBe(event.id);
    expect(row.eventName).toBe(event.name);
    expect(row.eventStartedAt).toEqual(event.startedAt);
    expect(row.amount.toString()).toBe('150.75');
    expect(page.totals).toEqual({ orderCount: 1, approvedCount: 0, approvedAmount: '0.00', totalAmount: '150.75' });
  });

  it('reflects an approval (and a subsequent rejection) immediately in the list, the status filter and the exact totals', async () => {
    const company = await seedCompany(prisma, 'Globex');
    const first = await ctx.ordersService.createOrder({ companyId: company.id, amount: 100 });
    await ctx.ordersService.createOrder({ companyId: company.id, amount: 49.99 });

    await ctx.ordersService.transitionOrder(first.id, { status: 'approved' });

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.data.find((o) => o.id === first.id)?.status).toBe('approved');
    expect(page.totals.orderCount).toBe(2);
    expect(page.totals.approvedCount).toBe(1);
    expect(page.totals.approvedAmount).toBe('100.00');
    expect(page.totals.totalAmount).toBe('149.99');

    const approvedOnly = await ctx.operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      page: 1,
      pageSize: 20,
    });
    expect(approvedOnly.data.map((o) => o.id)).toEqual([first.id]);
    expect(approvedOnly.total).toBe(1);

    await ctx.ordersService.transitionOrder(first.id, { status: 'rejected' });
    const afterReject = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(afterReject.data.find((o) => o.id === first.id)?.status).toBe('rejected');
    expect(afterReject.totals.approvedCount).toBe(0);
    expect(afterReject.totals.approvedAmount).toBe('0.00');
    expect(afterReject.totals.totalAmount).toBe('149.99');
    expect(afterReject.totals.orderCount).toBe(2);
  });

  it('filters by date range, sorts by recency, and paginates stably per company', async () => {
    const company = await seedCompany(prisma, 'Initech');
    const at = (day: string) => new Date(`${day}T12:00:00.000Z`);
    for (const [day, amount] of [
      ['2025-05-01', 1],
      ['2025-05-02', 2],
      ['2025-05-03', 3],
      ['2025-05-04', 4],
      ['2025-05-05', 5],
      ['2025-05-06', 6],
    ] as const) {
      await ctx.ordersService.createOrder({ companyId: company.id, amount, createdAt: at(day).toISOString() });
    }

    const page1 = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 3 });
    expect(page1.total).toBe(6);
    expect(page1.data.map((o) => o.amount.toString())).toEqual(['6.00', '5.00', '4.00']);

    const page2 = await ctx.operationsService.listOperations({ companyId: company.id, page: 2, pageSize: 3 });
    expect(page2.data.map((o) => o.amount.toString())).toEqual(['3.00', '2.00', '1.00']);

    const ranged = await ctx.operationsService.listOperations({
      companyId: company.id,
      from: at('2025-05-02'),
      to: at('2025-05-05'),
      page: 1,
      pageSize: 20,
    });
    expect(ranged.total).toBe(3);
    expect(ranged.data.map((o) => o.amount.toString())).toEqual(['4.00', '3.00', '2.00']);

    const other = await seedCompany(prisma, 'Soylent');
    await ctx.ordersService.createOrder({ companyId: other.id, amount: 999 });
    const isolated = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(isolated.total).toBe(6);
  });

  it('returns an empty page with zero totals (not an error) for a company without operations', async () => {
    const company = await seedCompany(prisma, 'Empty Co');
    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.data).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.totals).toEqual({ orderCount: 0, approvedCount: 0, approvedAmount: '0.00', totalAmount: '0.00' });
  });
});
