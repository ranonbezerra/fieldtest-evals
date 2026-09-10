// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const created = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    expect(asPending.items).toHaveLength(1);
    expect(asPending.items[0].status).toBe('pending');
    expect(asPending.items[0].lastEventKind).toBe('created');
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(12000);

    await orders.approve(created.id);

    const asApproved = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    const item = asApproved.items.find((i) => (i.orderId as string) === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    expect(item!.amountCents).toBe(12000);
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '1', name: 'Ana' } });
    const order = await orders.create({ companyId: '1', workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);

    await expect(orders.approve(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.reject(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.refund(order.id)).resolves.toBe(order.id);
    await expect(orders.refund(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.approve('999999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'resource_not_found',
    });
    await expect(orders.create({ companyId: '1', workerId: '9999', amountCents: 1 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '2', name: 'Bo' } });
    const order = await orders.create({ companyId: '2', workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);

    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2',
        );
        throw new Error('simulate a failure after the source update');
      }),
    ).rejects.toThrow('simulate a failure after the source update');

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: '7', name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const amountCents of amounts) {
      created.push(await orders.create({ companyId: '7', workerId: worker.id, amountCents }));
    }
    const totalsBefore = await ops.getCompanyTotals(7);
    expect(totalsBefore.pendingCount).toBe(4);
    expect(totalsBefore.pendingAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.amountCents).sort((a, b) => b - a)).toEqual([4000, 2500, 1000, 555]);
  });
});
