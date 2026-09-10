import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('concurrent updates to one company totals', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'conc');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('two concurrent approvals for the same company are both reflected in the totals', async () => {
    const a = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 1_000,
      currency: 'USD',
    });
    const b = await orders.create({
      companyId: seed.companyId,
      workerId: seed.otherWorkerId,
      amountCents: 2_500,
      currency: 'USD',
    });

    // Concurrent, not sequential: two separate transactions race on the same totals row.
    // A read-modify-write would lose one of these; an in-place increment loses none.
    await Promise.all([orders.approve(a.id), orders.approve(b.id)]);

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved.amountCents).toBe(3_500);
    expect(totals.approved.count).toBe(2);
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('eight concurrent approvals sum exactly (no lost update at higher contention)', async () => {
    const amounts = [101, 202, 303, 404, 505, 606, 707, 808];
    const created = await Promise.all(
      amounts.map((amountCents, i) =>
        orders.create({
          companyId: seed.companyId,
          workerId: i % 2 === 0 ? seed.workerId : seed.otherWorkerId,
          amountCents,
          currency: 'USD',
        }),
      ),
    );

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await operations.totals(seed.companyId);
    // The first test already approved 3_500 for this company.
    const expected = 3_500 + amounts.reduce((sum, x) => sum + x, 0);
    expect(totals.approved.amountCents).toBe(expected);
    expect(totals.approved.count).toBe(2 + amounts.length);

    const rows = (
      await operations.list({ companyId: seed.companyId, status: 'approved', page: 1, pageSize: 100 })
    ).items;
    expect(rows.filter((row) => created.some((o) => o.id === row.paymentOrderId))).toHaveLength(amounts.length);
  });
});
