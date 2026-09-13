import { PrismaClient } from '@prisma/client';
import { describe, it, expect } from 'vitest';

declare global {
  var __prisma: PrismaClient;
}

const prisma = global.__prisma;

import { OrderService } from '../src/order/order.service';
import { OrderRepository } from '../src/order/order.repository';
import { ProjectionService } from '../src/projection/projection.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { DashboardRepository } from '../src/dashboard/dashboard.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { RederiveService } from '../src/rederive/rederive.service';

function makeServices() {
  const prismaSvc = new PrismaService();
  const orderRepo = new OrderRepository(prismaSvc);
  const projection = new ProjectionService(prismaSvc);
  const orderSvc = new OrderService(prismaSvc, orderRepo, projection);
  const dashRepo = new DashboardRepository(prismaSvc);
  const dashSvc = new DashboardService(dashRepo, orderSvc);
  const rederiveSvc = new RederiveService(projection);
  return { orderSvc, dashSvc, projection, rederiveSvc };
}

describe('Drift repair', () => {
  it('detects and repairs injected drift in the projection', async () => {
    const { orderSvc, dashSvc, projection, rederiveSvc } = makeServices();

    const company = await prisma.company.create({ data: { name: 'Initech' } });
    const worker = await prisma.worker.create({ data: { name: 'Bill', companyId: company.id } });

    // Create and approve an order
    const order = await orderSvc.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: 500n,
    });
    await orderSvc.approveOrder(order.id);

    // Verify projection is in sync
    let dash = await dashSvc.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 100 });
    expect(dash.data.length).toBe(1);
    expect(dash.data[0].status).toBe('approved');

    // ── Inject drift: modify projection directly, breaking the sync ──
    await prisma.orderDashboard.update({
      where: { orderId: order.id },
      data: { status: 'pending' },
    });

    // Confirm drift exists now
    dash = await dashSvc.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 100 });
    expect(dash.data.length).toBe(0); // projection says pending, source says approved

    // ── Run drift repair ──
    const repairResult = await projection.repairDrift(7);
    expect(repairResult.repaired).toBeGreaterThanOrEqual(1);

    // ── Verify drift is gone ──
    dash = await dashSvc.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 100 });
    expect(dash.data.length).toBe(1);
    expect(dash.data[0].status).toBe('approved');
  });

  it('re-derivation is idempotent: running twice yields identical state', async () => {
    const { orderSvc, rederiveSvc } = makeServices();

    const company = await prisma.company.create({ data: { name: 'Soylent' } });
    const worker = await prisma.worker.create({ data: { name: 'Stanley', companyId: company.id } });

    const order = await orderSvc.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: 1234n,
    });
    await orderSvc.approveOrder(order.id);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    // Derive window twice
    await rederiveSvc.rederive(weekAgo, now);
    await rederiveSvc.rederive(weekAgo, now);

    // Projection still matches source
    const proj = await prisma.orderDashboard.findUnique({ where: { orderId: order.id } });
    expect(proj).not.toBeNull();
    expect(proj!.status).toBe('approved');
    expect(prisma.companyFinancialTotals).not.toBeNull();
    const totals = await prisma.companyFinancialTotals.findUnique({ where: { companyId: company.id } });
    expect(Number((totals as unknown as { approvedAmount: bigint }).approvedAmount)).toBe(1234);
    expect((totals as { approvedCount: number }).approvedCount).toBe(1);
  });
});
