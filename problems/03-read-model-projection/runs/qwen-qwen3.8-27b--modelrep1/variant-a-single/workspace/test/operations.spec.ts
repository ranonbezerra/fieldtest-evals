import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentOrder } from '@prisma/client';
import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';

describe('operations dashboard: read-your-own-writes', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    workerId = (await ctx.workers.create({ companyId, name: 'Ada' })).id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('shows a newly created order on the very next dashboard read', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1200 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta).toEqual({ page: 1, page_size: 50, total_count: 1 });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: order.id,
        company_id: companyId,
        worker_id: workerId,
        worker_name: 'Ada',
        status: 'pending',
        amount_cents: 1200,
        last_event_type: null,
        last_event_at: null,
      }),
    ]);
  });

  it('reflects an approval on the next read, and the status filter follows', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2500 });

    await ctx.paymentOrders.setStatus(order.id, 'approved');

    const approved = await ctx.operations.list({ companyId, status: 'approved', page: 1, pageSize: 50 });
    expect(approved.meta.total_count).toBe(1);
    expect(approved.items[0].id).toBe(order.id);
    expect(approved.items[0].status).toBe('approved');

    const pending = await ctx.operations.list({ companyId, status: 'pending', page: 1, pageSize: 50 });
    expect(pending.meta.total_count).toBe(0);
    expect(pending.items).toEqual([]);
  });

  it('reflects a recorded event as the operation\'s latest event', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const occurredAt = new Date('2025-06-01T12:00:00.000Z');

    await ctx.events.record({ orderId: order.id, type: 'payment.captured', occurredAt });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe(occurredAt.toISOString());
  });

  it('ignores an event whose occurred_at is older than the latest one', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    await ctx.events.record({
      orderId: order.id,
      type: 'payment.captured',
      occurredAt: new Date('2025-06-02T00:00:00.000Z'),
    });
    await ctx.events.record({
      orderId: order.id,
      type: 'recorded-late-but-earlier',
      occurredAt: new Date('2025-06-01T00:00:00.000Z'),
    });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe('2025-06-02T00:00:00.000Z');
  });

  it('never mixes in another company\'s operations', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'Bo' });
    await ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 999 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta.total_count).toBe(1);
    expect(page.items[0].amount_cents).toBe(100);
  });

  it('keeps the denormalised worker name in sync with renames', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });

    await ctx.workers.rename(workerId, 'Ada Lovelace');

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].worker_name).toBe('Ada Lovelace');
  });

  it('filters by date range and sorts by recency', async () => {
    const oldOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1 });
    const freshOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2 });

    // Backdate the first order (fixture manipulation) so the range is unambiguous.
    const past = new Date('2025-01-01T00:00:00.000Z');
    await ctx.prisma.paymentOrder.update({ where: { id: oldOrder.id }, data: { createdAt: past } });
    await ctx.prisma.operationRead.update({ where: { id: oldOrder.id }, data: { createdAt: past } });

    const all = await ctx.operations.list({ companyId, page: 1, pageSize: 10 });
    expect(all.items.map((item) => item.id)).toEqual([freshOrder.id, oldOrder.id]);

    const ranged = await ctx.operations.list({
      companyId,
      from: new Date(past.getTime() + 3_600_000),
      page: 1,
      pageSize: 10,
    });
    expect(ranged.meta.total_count).toBe(1);
    expect(ranged.items[0].id).toBe(freshOrder.id);
  });

  it('paginates with a stable order and no overlap between pages', async () => {
    const created: PaymentOrder[] = [];
    for (let i = 0; i < 5; i++) {
      created.push(await ctx.paymentOrders.create({ companyId, workerId, amountCents: i + 1 }));
    }

    // Backdate so each order lands on a distinct second, oldest first.
    const base = Date.parse('2025-03-01T00:00:00.000Z');
    for (let i = 0; i < created.length; i++) {
      const at = new Date(base + i * 1000);
      await ctx.prisma.paymentOrder.update({ where: { id: created[i].id }, data: { createdAt: at } });
      await ctx.prisma.operationRead.update({ where: { id: created[i].id }, data: { createdAt: at } });
    }

    const firstPage = await ctx.operations.list({ companyId, page: 1, pageSize: 2 });
    const secondPage = await ctx.operations.list({ companyId, page: 2, pageSize: 2 });

    expect(firstPage.meta.total_count).toBe(5);
    expect(firstPage.items.map((item) => item.id)).toEqual([created[4].id, created[3].id]);
    expect(secondPage.items.map((item) => item.id)).toEqual([created[2].id, created[1].id]);

    const seen = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
    expect(seen.size).toBe(4);
  });
});
