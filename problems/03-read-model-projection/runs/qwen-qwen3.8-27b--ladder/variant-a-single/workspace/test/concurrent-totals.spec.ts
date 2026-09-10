import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderView } from '../src/order/order.service';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
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

  it('keeps totals exact when 20 orders of the same company are approved concurrently', async () => {
    const { company } = await seedLookup(prisma);
    const orders: OrderView[] = [];
    for (let i = 0; i < 20; i += 1) {
      orders.push(await app.orderService.createOrder({ companyId: company.id, amountCents: 7777 }));
    }

    // All 20 approvals target the same company_totals row and run in
    // parallel, each inside its own transaction - this is the race a
    // read-modify-write would lose.
    await Promise.all(orders.map((order) => app.orderService.approveOrder(order.id)));

    const totals = await app.operationsService.getCompanyTotals(company.id);
    const expected = 20 * 7777;
    expect(totals.orderCount).toBe(20);
    expect(totals.totalCents).toBe(expected);
    expect(totals.approvedCents).toBe(expected);
    expect(totals.rejectedCents).toBe(0);

    // Cross-check the projection against the source: it must equal the truth.
    const source = await prisma.paymentOrder.aggregate({
      where: { companyId: company.id },
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    expect(Number(source._sum.amountCents ?? 0n)).toBe(totals.totalCents);
    expect(source._count._all).toBe(totals.orderCount);
  });

  it('keeps totals exact when approve and reject race on the same totals row', async () => {
    const { company } = await seedLookup(prisma);
    const toApprove = await app.orderService.createOrder({ companyId: company.id, amountCents: 1111 });
    const toReject = await app.orderService.createOrder({ companyId: company.id, amountCents: 2222 });

    await Promise.all([
      app.orderService.approveOrder(toApprove.id),
      app.orderService.rejectOrder(toReject.id),
    ]);

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3333);
    expect(totals.approvedCents).toBe(1111);
    expect(totals.rejectedCents).toBe(2222);
    expect(totals.orderCount).toBe(2);
  });
});
