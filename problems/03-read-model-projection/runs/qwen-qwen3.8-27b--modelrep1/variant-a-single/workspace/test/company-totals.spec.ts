import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import { createTestContext, newId, resetDatabase, toMap, type TestContext } from './test-utils.js';

describe('company totals: exact under concurrent updates', () => {
  let ctx: TestContext;
  let companyId: string;
  const workerIds: string[] = [];

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    workerIds.length = 0;
    for (const name of ['W1', 'W2', 'W3', 'W4']) {
      workerIds.push((await ctx.workers.create({ companyId, name })).id);
    }
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  const finalStatusOf = (index: number): OrderStatus =>
    index % 2 === 0 ? 'approved' : index % 5 === 1 ? 'rejected' : 'pending';

  it('keeps totals exact while 60 creates and 30 status changes race on one company', async () => {
    const N = 60;
    const created = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.paymentOrders.create({
          companyId,
          workerId: workerIds[i % workerIds.length],
          amountCents: 100 + i * 7,
        }),
      ),
    );

    // Flips interleave with each other and with the creates' tail; each order
    // is flipped exactly once, so the final state is deterministic.
    await Promise.all(
      created.map((order, i) =>
        finalStatusOf(i) === 'pending' ? Promise.resolve() : ctx.paymentOrders.setStatus(order.id, finalStatusOf(i)),
      ),
    );

    const rows = await ctx.companyTotals.forCompany(companyId);
    const byStatus = toMap(rows, (row) => row.status);

    const expected: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    created.forEach((order, i) => {
      const status = finalStatusOf(i);
      expected[status].count += 1;
      expected[status].cents += BigInt(order.amountCents);
    });

    for (const status of ['pending', 'approved', 'rejected'] as const) {
      const row = byStatus.get(status);
      expect(row).toBeDefined();
      expect(row!.order_count).toBe(expected[status].count);
      expect(BigInt(row!.total_cents)).toBe(expected[status].cents);
    }

    // Global invariants: nothing lost or double-counted across the buckets.
    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(N);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(
      created.reduce((sum, order) => sum + BigInt(order.amountCents), 0n),
    );
  });

  it('never mixes one company\'s totals into another\'s under concurrency', async () => {
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'X' });

    await Promise.all([
      ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 111 }),
      ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 222 }),
    ]);

    const rows = await ctx.companyTotals.forCompany(companyId);
    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(1);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(111n);
  });

  it('moves the amount between buckets as the status changes repeatedly', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 500 });

    const buckets = async () => toMap(await ctx.companyTotals.forCompany(companyId), (row) => row.status);

    await ctx.paymentOrders.setStatus(order.id, 'approved');
    let byStatus = await buckets();
    expect(byStatus.get('pending')!.order_count).toBe(0);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'rejected');
    byStatus = await buckets();
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'pending');
    byStatus = await buckets();
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(500n);
    expect(byStatus.get('pending')!.order_count).toBe(1);
  });
});
