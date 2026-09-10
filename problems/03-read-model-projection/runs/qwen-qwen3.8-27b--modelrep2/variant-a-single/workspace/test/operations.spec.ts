import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('operations dashboard — read-your-own-writes', () => {
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

  async function seedWorker(name: string) {
    return services.prisma.worker.create({ data: { companyId: COMPANY, name } });
  }

  it('shows a new order on the very next dashboard request', async () => {
    const worker = await seedWorker('Ada Lovelace');
    const created = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('42.50'),
      currency: 'USD',
    });

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });

    expect(page.total_count).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: created.id,
      company_id: COMPANY,
      worker_id: worker.id,
      worker_name: 'Ada Lovelace',
      status: OrderStatus.PENDING,
      amount: '42.5000',
      currency: 'USD',
    });

    // The exact per-company total reflects the write immediately as well.
    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total).toEqual({ order_count: 1, total_amount: '42.5000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '42.5000' });
  }, 60_000);

  it('reflects an approval immediately in the list and in the exact company totals', async () => {
    const worker = await seedWorker('Grace Hopper');
    const first = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('10.00'),
      currency: 'USD',
    });
    const second = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('20.00'),
      currency: 'USD',
    });
    await sleep(5);

    await services.paymentOrdersService.changeStatus(first.id, OrderStatus.CAPTURED);

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });
    // The approved order is the most recent activity and sorts first.
    expect(page.items.map(item => item.id)).toEqual([first.id, second.id]);
    expect(page.items[0].status).toBe(OrderStatus.CAPTURED);
    expect(page.items[1].status).toBe(OrderStatus.PENDING);

    const totals = await services.financialTotalsService.forCompany(COMPANY);
    expect(totals.total).toEqual({ order_count: 2, total_amount: '30.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.CAPTURED, order_count: 1, total_amount: '10.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '20.0000' });
  }, 60_000);

  it('reorders the list by event recency as soon as an event is recorded', async () => {
    const worker = await seedWorker('Alan Turing');
    const first = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('5.00'),
      currency: 'USD',
    });
    await sleep(20);
    const second = await services.paymentOrdersService.create({
      companyId: COMPANY,
      workerId: worker.id,
      amount: new Prisma.Decimal('6.00'),
      currency: 'USD',
    });
    await sleep(5);

    // A late event on the older order moves it to the front on the next request.
    await services.orderEventsService.record({
      orderId: first.id,
      type: 'callback:success',
      occurredAt: new Date(),
    });

    const page = await services.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });
    expect(page.items.map(item => item.id)).toEqual([first.id, second.id]);
  }, 60_000);

  it('reports unknown orders with the resource_not_found error contract', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    await expect(services.paymentOrdersService.changeStatus(missing, OrderStatus.CAPTURED)).rejects.toMatchObject({
      code: 'resource_not_found',
      httpStatus: 404,
    });
  }, 60_000);
});
