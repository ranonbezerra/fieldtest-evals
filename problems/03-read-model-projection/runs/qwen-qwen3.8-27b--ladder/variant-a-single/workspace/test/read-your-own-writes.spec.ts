import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('read your own writes', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('shows a new order on the very next dashboard request, with the denormalized names', async () => {
    const { company, worker, event } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 12345,
    });

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: order.id,
      companyId: company.id,
      status: 'pending',
      amountCents: 12345,
      workerName: 'Wendy',
      eventName: 'Launch',
    });
  });

  it('shows an approval immediately, in the list and behind the status filter', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 5000 });
    await app.orderService.approveOrder(order.id);

    const approved = await app.operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      page: 1,
      pageSize: 20,
    });
    const pending = await app.operationsService.listOperations({
      companyId: company.id,
      status: 'pending',
      page: 1,
      pageSize: 20,
    });

    expect(approved.items.map((row) => row.id)).toEqual([order.id]);
    expect(approved.items[0].status).toBe('approved');
    expect(pending.items).toEqual([]);
  });

  it('keeps the projection consistent when a duplicate approval rolls back', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 7500 });
    await app.orderService.approveOrder(order.id);

    // The second approval hits the status guard, rolls back its transaction,
    // and must leave both the list and the totals exactly as before.
    await expect(app.orderService.approveOrder(order.id)).rejects.toBeInstanceOf(ConflictException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('approved');

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals).toEqual({
      companyId: company.id,
      totalCents: 7500,
      approvedCents: 7500,
      rejectedCents: 0,
      orderCount: 1,
    });
  });

  it('rejects a write for a missing order and leaves the projection untouched', async () => {
    const { company } = await seedLookup(prisma);

    await expect(app.orderService.approveOrder('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(page.items).toEqual([]);
    expect(totals.totalCents).toBe(0);
    expect(totals.orderCount).toBe(0);
  });
});
