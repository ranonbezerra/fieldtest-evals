import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServices, cleanup, prisma, recentWindow, seedCompany } from './setup.js';

const { orderService, eventService, operationsService, projectionService } = buildServices();

describe('operations dashboard — read your own writes', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('shows an order as pending, then approved, on the very next request', async () => {
    const { companyId, workerId } = await seedCompany();
    const created = await orderService.createOrder({ companyId, workerId, amountCents: 1500n });

    let page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('pending');

    await orderService.approveOrder(created.id);

    // the next dashboard request reflects the approval — no delay
    page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].id).toBe(created.id);
    expect(page.items[0].status).toBe('approved');
    expect(page.items[0].amountCents).toBe('1500');

    // the financial total reflects the approval immediately and exactly
    const totals = await operationsService.totals(companyId);
    expect(totals.approvedCount).toBe('1');
    expect(totals.approvedAmountCents).toBe('1500');
    expect(totals.pendingCount).toBe('0');
  });

  it('does not change the projection when a write is rejected and rolls back', async () => {
    const { companyId, workerId } = await seedCompany();
    const created = await orderService.createOrder({ companyId, workerId, amountCents: 700n });
    await orderService.approveOrder(created.id);

    // approving an already-approved order must fail...
    await expect(orderService.approveOrder(created.id)).rejects.toMatchObject({ status: 409, code: 'invalid_state' });

    // ...and the projection must be untouched by the failed write
    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].status).toBe('approved');
    const totals = await operationsService.totals(companyId);
    expect(totals.approvedCount).toBe('1');
    expect(totals.approvedAmountCents).toBe('700');
  });

  it('serves the projection, not the source tables', async () => {
    const { companyId, workerId } = await seedCompany();
    const created = await orderService.createOrder({ companyId, workerId, amountCents: 900n });

    // a rogue manual fix mutates the source behind the write path's back
    await prisma.paymentOrder.update({ where: { id: created.id }, data: { status: 'approved' } });

    // the dashboard still shows the projection's value: no join back to source
    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].status).toBe('pending');

    // and the drift-repair routine reconciles source into the projection
    const { from, to } = recentWindow();
    await projectionService.repairDrift(from, to);

    const after = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(after.items[0].status).toBe('approved');
    const totals = await operationsService.totals(companyId);
    expect(totals.approvedCount).toBe('1');
    expect(totals.approvedAmountCents).toBe('900');
    expect(totals.pendingCount).toBe('0');
  });

  it('projects the worker name and the latest event immediately', async () => {
    const { companyId, workerId, workerName } = await seedCompany();
    const created = await orderService.createOrder({ companyId, workerId, amountCents: 500n });

    await eventService.logEvent({ companyId, workerId, type: 'shift_started' });

    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].id).toBe(created.id);
    expect(page.items[0].workerName).toBe(workerName);
    expect(page.items[0].lastEventType).toBe('shift_started');
    expect(page.items[0].lastEventAt).toBeInstanceOf(Date);
  });
});
