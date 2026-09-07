import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import type { PrismaService } from '../src/common/prisma.service.js';
import { cleanupAll, createTestContext, seedCompany, seedWorkers, type TestContext } from './helpers.js';

describe('company totals under concurrent writes', () => {
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

  it('applies 24 concurrent order creations for one company with no lost updates', async () => {
    const company = await seedCompany(prisma, 'Concurrent Co');
    const workers = await seedWorkers(prisma, 3, 'Ops');
    const amounts = Array.from({ length: 24 }, (_, i) => i * 10 + 0.5); // 0.50 .. 230.50 → 252.00

    await Promise.all(
      amounts.map((amount, i) =>
        ctx.ordersService.createOrder({ companyId: company.id, workerId: workers[i % 3].id, amount }),
      ),
    );

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 100 });
    expect(page.data).toHaveLength(24);
    expect(page.total).toBe(24);
    expect(page.totals.orderCount).toBe(24);
    expect(page.totals.totalAmount).toBe('252.00');
    expect(page.totals.approvedAmount).toBe('0.00');

    // Approve all 24 in parallel: the approved total must end up exact as well.
    await Promise.all(page.data.map((o) => ctx.ordersService.transitionOrder(o.id, { status: 'approved' })));
    const after = await ctx.operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      page: 1,
      pageSize: 100,
    });
    expect(after.data).toHaveLength(24);
    expect(after.totals.approvedCount).toBe(24);
    expect(after.totals.approvedAmount).toBe('252.00');
    expect(after.totals.totalAmount).toBe('252.00');
  });

  it('resolves two concurrent approvals of one order to exactly one success, one conflict, and exact totals', async () => {
    const company = await seedCompany(prisma, 'Race Co');
    const order = await ctx.ordersService.createOrder({ companyId: company.id, amount: 75 });

    const results = await Promise.allSettled([
      ctx.ordersService.transitionOrder(order.id, { status: 'approved' }),
      ctx.ordersService.transitionOrder(order.id, { status: 'approved' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ApiError);
    expect(failure.reason.code).toBe('conflict');

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.data[0].status).toBe('approved');
    expect(page.totals).toEqual({ orderCount: 1, approvedCount: 1, approvedAmount: '75.00', totalAmount: '75.00' });
  });

  it('keeps two companies exact when their orders are written concurrently (no cross-company bleed)', async () => {
    const alpha = await seedCompany(prisma, 'Alpha');
    const beta = await seedCompany(prisma, 'Beta');

    await Promise.all([
      ...Array.from({ length: 10 }, () =>
        ctx.ordersService.createOrder({ companyId: alpha.id, amount: 10, status: 'approved' as const }),
      ),
      ...Array.from({ length: 10 }, () => ctx.ordersService.createOrder({ companyId: beta.id, amount: 20 })),
    ]);

    const a = await ctx.operationsService.listOperations({ companyId: alpha.id, page: 1, pageSize: 50 });
    const b = await ctx.operationsService.listOperations({ companyId: beta.id, page: 1, pageSize: 50 });
    expect(a.totals).toEqual({ orderCount: 10, approvedCount: 10, approvedAmount: '100.00', totalAmount: '100.00' });
    expect(b.totals).toEqual({ orderCount: 10, approvedCount: 0, approvedAmount: '0.00', totalAmount: '200.00' });
  });
});
