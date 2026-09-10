import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, newId, resetDatabase, toMap, type TestContext } from './test-utils.js';

describe('drift repair: re-derivation over an arbitrary window', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;
  let outsiderCompany: string;
  let outsiderWorkerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    outsiderCompany = newId();
    workerId = (await ctx.workers.create({ companyId, name: 'In-window' })).id;
    outsiderWorkerId = (await ctx.workers.create({ companyId: outsiderCompany, name: 'Outsider' })).id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('repairs missed writes, tampered rows and corrupted totals inside the window — and only there', async () => {
    const a = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1000 });
    const b = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2000 });
    const c = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 3000 });
    const outsider = await ctx.paymentOrders.create({
      companyId: outsiderCompany,
      workerId: outsiderWorkerId,
      amountCents: 7777,
    });

    // Simulate the four kinds of drift the repair has to heal.
    // 1) A source write that bypassed the hook (direct update of the order).
    await ctx.prisma.paymentOrder.update({ where: { id: a.id }, data: { status: 'approved' } });
    // 2) A projection row tampered with directly.
    await ctx.prisma.operationRead.update({
      where: { id: b.id },
      data: { workerName: 'Ghost', amountCents: 999999, status: 'rejected' },
    });
    // 3) An event written straight to the source table.
    await ctx.prisma.event.create({ data: { orderId: c.id, type: 'direct', occurredAt: new Date() } });
    // 4) A maintained totals row corrupted.
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId, status: 'pending' } },
      data: { orderCount: 99, totalCents: 1n },
    });

    // Push the outsider's order 30 days in the past, outside the window below,
    // and corrupt its row and totals too: none of it should be touched.
    await ctx.prisma.paymentOrder.update({
      where: { id: outsider.id },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await ctx.prisma.operationRead.update({ where: { id: outsider.id }, data: { workerName: 'ShouldStay' } });
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId: outsiderCompany, status: 'pending' } },
      data: { totalCents: 42n },
    });

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);

    const result = await ctx.projection.rederiveWindow(from, to);
    expect(result.ordersRederived).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    // The in-window company is fully repaired: rows, names, events, totals.
    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    const byId = toMap(page.items, (item) => item.id);
    expect(byId.get(a.id)!.status).toBe('approved');
    expect(byId.get(b.id)!.worker_name).toBe('In-window');
    expect(byId.get(b.id)!.amount_cents).toBe(2000);
    expect(byId.get(b.id)!.status).toBe('pending');
    expect(byId.get(c.id)!.last_event_type).toBe('direct');

    const byStatus = toMap(await ctx.companyTotals.forCompany(companyId), (row) => row.status);
    expect(byStatus.get('approved')!.order_count).toBe(1);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(1000n);
    expect(byStatus.get('pending')!.order_count).toBe(2);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(5000n);
    expect(byStatus.get('rejected')!.order_count).toBe(0);
    expect(byStatus.get('rejected')!.total_cents).toBe('0');

    // The window is honoured: the 30-day-old order is not re-derived, and the
    // outsider's corrupted totals are left alone too.
    const outsiderPage = await ctx.operations.list({ companyId: outsiderCompany, page: 1, pageSize: 50 });
    expect(outsiderPage.items[0].worker_name).toBe('ShouldStay');
    const outsiderRows = await ctx.companyTotals.forCompany(outsiderCompany);
    expect(BigInt(toMap(outsiderRows, (row) => row.status).get('pending')!.total_cents)).toBe(42n);

    // The repair is idempotent: a second run changes nothing.
    const totalsBefore = await ctx.companyTotals.forCompany(companyId);
    const pageBefore = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    await ctx.projection.rederiveWindow(from, to);
    expect(await ctx.companyTotals.forCompany(companyId)).toEqual(totalsBefore);
    expect((await ctx.operations.list({ companyId, page: 1, pageSize: 50 })).items).toEqual(pageBefore.items);
  });
});
