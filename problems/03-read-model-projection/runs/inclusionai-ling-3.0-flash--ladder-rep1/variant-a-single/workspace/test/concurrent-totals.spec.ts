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

function makeServices() {
  const prismaSvc = new PrismaService();
  const orderRepo = new OrderRepository(prismaSvc);
  const projection = new ProjectionService(prismaSvc);
  const orderSvc = new OrderService(prismaSvc, orderRepo, projection);
  const dashRepo = new DashboardRepository(prismaSvc);
  const dashSvc = new DashboardService(dashRepo, orderSvc);
  return { orderSvc, dashSvc };
}

describe('Concurrent totals', () => {
  it('two concurrent approvals for the same company produce exact totals', async () => {
    const { orderSvc, dashSvc } = makeServices();

    // Setup: company + two workers
    const company = await prisma.company.create({ data: { name: 'Globex' } });
    const worker1 = await prisma.worker.create({ data: { name: 'Alice', companyId: company.id } });
    const worker2 = await prisma.worker.create({ data: { name: 'Charlie', companyId: company.id } });

    // Create two orders for the same company concurrently
    const [order1, order2] = await Promise.all([
      orderSvc.createOrder({ companyId: company.id, workerId: worker1.id, amount: 250n }),
      orderSvc.createOrder({ companyId: company.id, workerId: worker2.id, amount: 350n }),
    ]);

    // Approve both concurrently (the key test for atomic increment)
    await Promise.all([
      orderSvc.approveOrder(order1.id),
      orderSvc.approveOrder(order2.id),
    ]);

    // Check projection row for order1 is approved
    const row1 = await prisma.orderDashboard.findUnique({ where: { orderId: order1.id } });
    const row2 = await prisma.orderDashboard.findUnique({ where: { orderId: order2.id } });
    expect(row1?.status).toBe('approved');
    expect(row2?.status).toBe('approved');

    // Check company totals are exact: 250 + 350 = 600 approved, 2 orders approved
    const totals = await prisma.companyFinancialTotals.findUnique({ where: { companyId: company.id } });
    expect(totals).not.toBeNull();
    // ASSUMPTION: BigInt columns return BigInt in Prisma client
    expect(Number((totals as unknown as { approvedAmount: bigint }).approvedAmount)).toBe(600);
    expect(totals?.approvedCount).toBe(2);
    expect(Number((totals as unknown as { totalAmount: bigint }).totalAmount)).toBe(600);
    expect(totals?.totalOrders).toBe(2);

    // Dashboard query should also reflect exact totals
    const dash = await dashSvc.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 100 });
    expect(dash.data.length).toBe(2);
    expect(dash.companyTotals?.approvedAmount).toBeDefined();
    expect(Number((dash.companyTotals?.approvedAmount as bigint))).toBe(600);
  });
});
