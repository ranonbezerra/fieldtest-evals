import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ResourceNotFoundError } from '../src/common/errors.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('read-your-own-writes (orders → operations dashboard)', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'ryw');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows a created order immediately, and its approval on the very next request', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 5_000,
      currency: 'USD',
    });

    const afterCreate = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const created = afterCreate.items.find((row) => row.paymentOrderId === order.id);
    expect(created).toBeDefined();
    expect(created!.status).toBe('pending');
    expect(created!.workerName).toBe(seed.workerName);
    expect(created!.amountCents).toBe(5_000);

    await orders.approve(order.id);

    // No waiting, no refresh job: the very next read shows the approval.
    const afterApprove = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const approved = afterApprove.items.find((row) => row.paymentOrderId === order.id);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('approved');
    expect(approved!.latestEventType).toBe('approved');

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved).toEqual({ amountCents: 5_000, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('a worker reassignment is visible on the next request without moving totals', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 700,
      currency: 'USD',
    });

    const totalsBefore = await operations.totals(seed.companyId);
    await orders.assignWorker(order.id, seed.otherWorkerId);

    const row = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(row!.workerName).toBe(seed.otherWorkerName);
    expect(row!.latestEventType).toBe('worker_assigned');
    expect(row!.amountCents).toBe(700);

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter.pending.amountCents).toBe(totalsBefore.pending.amountCents);
    expect(totalsAfter.pending.count).toBe(totalsBefore.pending.count);
  });

  it('a failed write rolls back: neither source nor projection changes', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 1_200,
      currency: 'USD',
    });
    await orders.cancel(order.id);

    const totalsBefore = await operations.totals(seed.companyId);
    const rowBefore = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);

    // The second cancel must conflict and leave everything untouched.
    await expect(orders.cancel(order.id)).rejects.toThrow(ConflictError);

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter).toEqual(totalsBefore);
    const rowAfter = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(rowAfter).toEqual(rowBefore);
    const source = await app.prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(source.status).toBe('cancelled');
  });

  it('rejects operations on unknown orders with resource_not_found', async () => {
    await expect(orders.approve(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });

  it('the dashboard reads only the projection, not the source tables', async () => {
    // A source row written without the maintenance hook must not appear on the dashboard.
    const raw = await app.prisma.paymentOrder.create({
      data: { companyId: seed.companyId, workerId: seed.workerId, amountCents: 777, currency: 'USD' },
    });
    const list = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 100 });
    expect(list.items.map((row) => row.paymentOrderId)).not.toContain(raw.id);
    // Clean up so this source-only row cannot show up as drift for other tests.
    await app.prisma.paymentOrder.delete({ where: { id: raw.id } });
  });
});
