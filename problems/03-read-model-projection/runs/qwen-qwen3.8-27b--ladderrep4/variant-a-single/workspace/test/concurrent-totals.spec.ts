import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderDto } from '../src/orders/orders.service.js';
import { buildServices, cleanup, prisma, seedCompany } from './setup.js';

const { orderService, operationsService } = buildServices();

describe('concurrent approvals of one company keep the totals exact', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('two concurrent approvals both move the same totals row; neither is lost', async () => {
    const { companyId, workerId } = await seedCompany();
    const first = await orderService.createOrder({ companyId, workerId, amountCents: 700n });
    const second = await orderService.createOrder({ companyId, workerId, amountCents: 300n });

    // two independent write transactions, started together
    await Promise.all([orderService.approveOrder(first.id), orderService.approveOrder(second.id)]);

    const totals = await operationsService.totals(companyId);
    expect(totals.ordersCount).toBe('2');
    expect(totals.approvedCount).toBe('2');
    expect(totals.approvedAmountCents).toBe('1000');
    expect(totals.pendingCount).toBe('0');
    expect(totals.pendingAmountCents).toBe('0');

    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items.map((row) => row.status).sort()).toEqual(['approved', 'approved']);
  });

  it('ten concurrent approvals still leave the exact total', async () => {
    const { companyId, workerId } = await seedCompany();
    const orders: OrderDto[] = [];
    for (let i = 0; i < 10; i += 1) {
      orders.push(await orderService.createOrder({ companyId, workerId, amountCents: 100n }));
    }

    await Promise.all(orders.map((order) => orderService.approveOrder(order.id)));

    const totals = await operationsService.totals(companyId);
    expect(totals.ordersCount).toBe('10');
    expect(totals.approvedCount).toBe('10');
    expect(totals.approvedAmountCents).toBe('1000');
    expect(totals.pendingCount).toBe('0');
  });
});
