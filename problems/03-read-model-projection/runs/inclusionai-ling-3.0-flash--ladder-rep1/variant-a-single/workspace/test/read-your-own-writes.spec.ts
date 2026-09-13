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

import { OrderModule } from '../src/order/order.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { ProjectionModule } from '../src/projection/projection.module';

// We create the services manually so tests work without NestJS DI bootstrap.
function makeServices() {
  const prismaSvc = new PrismaService();
  const orderRepo = new OrderRepository(prismaSvc);
  const projection = new ProjectionService(prismaSvc);
  const orderSvc = new OrderService(prismaSvc, orderRepo, projection);

  const dashRepo = new DashboardRepository(prismaSvc);
  const dashSvc = new DashboardService(dashRepo, orderSvc);
  return { orderSvc, dashSvc };
}

describe('Read-your-own-writes', () => {
  it('approved order appears on the dashboard immediately', async () => {
    const { orderSvc, dashSvc } = makeServices();

    // Setup: company + worker
    const company = await prisma.company.create({ data: { name: 'Acme' } });
    const worker = await prisma.worker.create({ data: { name: 'Bob', companyId: company.id } });

    // Create an order (status = pending)
    const order = await orderSvc.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: 100n,
    });

    // Dashboard before approval should NOT show it as approved
    let result = await dashSvc.getDashboard({ companyId: company.id, page: 1, pageSize: 100 });
    let approvedRows = result.data.filter((r: { status: string }) => r.status === 'approved');
    expect(approvedRows.length).toBe(0);

    // Approve the order
    await orderSvc.approveOrder(order.id);

    // Dashboard AFTER approval SHOULD show it as approved (immediately, no delay)
    result = await dashSvc.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 100 });
    approvedRows = result.data.filter((r: { status: string; orderId: string }) => r.orderId === order.id);
    expect(approvedRows.length).toBe(1);
    expect(approvedRows[0].status).toBe('approved');
  });
});
