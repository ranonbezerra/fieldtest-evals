import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY = '22222222-2222-4222-8222-222222222222';

describe('concurrent updates to one company totals', () => {
  const services: Services = buildServices(createPrisma());

  beforeAll(async () => {
    await services.prisma.$connect();
  });
  afterEach(async () => {
    await cleanAllTables(services.prisma);
  });
  afterAll(async () => {
    await services.prisma.$disconnect();
  });

  it('keeps company totals exact when many orders are approved in parallel', async () => {
    const worker = await services.prisma.worker.create({
      data: { companyId: COMPANY, name: 'Katherine Johnson' },
    });

    const orders = [];
    for (let i = 1; i <= 16; i++) {
      orders.push(
        await services.paymentOrdersService.create({
          companyId: COMPANY,
          workerId: worker.id,
          amount: new Prisma.Decimal(`${i * 7}.25`),
          currency: 'USD',
        }),
      );
    }
    const expectedTotal = orders.reduce(
      (sum, order) => sum.plus(new Prisma.Decimal(order.amount)),
      new Prisma.Decimal(0),
    );

    // 16 parallel transitions all hit the same two (company, status) total rows.
    await Promise.all(orders.map(order => services.paymentOrdersService.changeStatus(order.id, OrderStatus.CAPTURED)));

    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total.order_count).toBe(16);
    expect(totals.total.total_amount).toBe(expectedTotal.toFixed(4));
    expect(totals.by_status).toContainEqual({
      status: OrderStatus.CAPTURED,
      order_count: 16,
      total_amount: expectedTotal.toFixed(4),
    });
    const pending = totals.by_status.find(row => row.status === OrderStatus.PENDING);
    expect(pending?.order_count ?? 0).toBe(0);
    expect(pending?.total_amount ?? '0.0000').toBe('0.0000');

    // The projection rows agree with the totals: every order is CAPTURED.
    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 100 });
    expect(page.total_count).toBe(16);
    expect(page.items.every(item => item.status === OrderStatus.CAPTURED)).toBe(true);
  }, 120_000);
});
