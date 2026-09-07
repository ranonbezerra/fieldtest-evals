import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/common/prisma.service.js';
import { cleanupAll, createTestContext, seedCompany, seedWorkers, type TestContext } from './helpers.js';

describe('re-derivation and drift repair', () => {
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

  it('detects and repairs deleted and corrupted projection rows and corrupted totals', async () => {
    const company = await seedCompany(prisma, 'Drifty');
    const [worker] = await seedWorkers(prisma, 1, 'Ops');
    const o1 = await ctx.ordersService.createOrder({ companyId: company.id, amount: 10, workerId: worker.id, status: 'approved' });
    const o2 = await ctx.ordersService.createOrder({ companyId: company.id, amount: 20, workerId: worker.id });
    const o3 = await ctx.ordersService.createOrder({ companyId: company.id, amount: 30, workerId: worker.id });

    // Introduce drift in the projection only (simulates out-of-band damage).
    await prisma.operationReadModel.delete({ where: { paymentOrderId: o2.id } });
    await prisma.operationReadModel.update({
      where: { paymentOrderId: o1.id },
      data: { status: 'rejected', amount: 99 },
    });
    await prisma.operationReadModel.update({
      where: { paymentOrderId: o3.id },
      data: { workerName: 'GHOST' },
    });
    await prisma.companyOrderTotals.update({
      where: { companyId: company.id },
      data: { orderCount: 99, approvedAmount: 1, totalAmount: 1 },
    });

    const report = await ctx.driftRepairProcessor.run();
    expect(report.missingRows).toBe(1);
    expect(report.staleRows).toBe(2);
    expect(report.orphanRows).toBe(0);
    expect(report.rebuiltRows).toBeGreaterThanOrEqual(3);
    expect(report.companiesRepaired).toBe(1);

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.data).toHaveLength(3);
    const byId = new Map(page.data.map((o) => [o.id, o] as const));
    expect(byId.get(o1.id)?.status).toBe('approved');
    expect(byId.get(o1.id)?.amount.toString()).toBe('10.00');
    expect(byId.get(o2.id)?.amount.toString()).toBe('20.00');
    expect(byId.get(o3.id)?.workerName).toBe(worker.name);
    expect(page.totals).toEqual({ orderCount: 3, approvedCount: 1, approvedAmount: '10.00', totalAmount: '60.00' });
  });

  it('removes orphan read-model rows whose source order no longer exists', async () => {
    const company = await seedCompany(prisma, 'Orphan Co');
    await prisma.operationReadModel.create({
      data: {
        paymentOrderId: 'ghost-order-1',
        companyId: company.id,
        status: 'pending',
        amount: 5,
        currency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const report = await ctx.driftRepairProcessor.run();
    expect(report.orphanRows).toBe(1);

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.totals.orderCount).toBe(0);
  });

  it('re-derives an arbitrary historical window and leaves rows outside the window untouched', async () => {
    const company = await seedCompany(prisma, 'Historical');
    const pastA = await ctx.ordersService.createOrder({ companyId: company.id, amount: 5, createdAt: '2024-03-01T08:00:00.000Z' });
    const pastB = await ctx.ordersService.createOrder({ companyId: company.id, amount: 7, createdAt: '2024-03-02T08:00:00.000Z' });
    const outside = await ctx.ordersService.createOrder({ companyId: company.id, amount: 11, createdAt: '2024-07-01T08:00:00.000Z' });

    // Corrupt the in-window rows only.
    await prisma.operationReadModel.update({
      where: { paymentOrderId: pastA.id },
      data: { amount: 1, status: 'rejected' },
    });
    await prisma.operationReadModel.delete({ where: { paymentOrderId: pastB.id } });

    const result = await ctx.operationsService.rederiveWindow(
      new Date('2024-03-01T00:00:00.000Z'),
      new Date('2024-06-01T00:00:00.000Z'),
    );
    expect(result.rebuiltRows).toBe(2);
    expect(result.companiesRepaired).toBe(1);

    const page = await ctx.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    const byId = new Map(page.data.map((o) => [o.id, o] as const));
    expect(byId.get(pastA.id)?.amount.toString()).toBe('5.00');
    expect(byId.get(pastA.id)?.status).toBe('pending');
    expect(byId.get(pastB.id)?.amount.toString()).toBe('7.00');
    expect(byId.get(outside.id)?.amount.toString()).toBe('11.00');
    expect(page.totals).toEqual({ orderCount: 3, approvedCount: 0, approvedAmount: '0.00', totalAmount: '23.00' });
  });
});
