import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServices, cleanup, prisma, recentWindow, seedCompany, snapshotProjection } from './setup.js';

const { orderService, eventService, operationsService, projectionService } = buildServices();

describe('re-derivation and drift repair', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('re-derives a window from source and yields the same result on a second run', async () => {
    const { companyId, workerId } = await seedCompany();
    const approved = await orderService.createOrder({ companyId, workerId, amountCents: 100n });
    const pending = await orderService.createOrder({ companyId, workerId, amountCents: 200n });
    await orderService.approveOrder(approved.id);

    // inject drift into the projection
    await prisma.$executeRawUnsafe(`UPDATE op_operations SET status = 'approved' WHERE id = '${pending.id}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM op_operations WHERE id = '${approved.id}'`);
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_count = approved_count - 1 WHERE company_id = '${companyId}'`);

    const { from, to } = recentWindow();
    await projectionService.rederive(from, to);

    // the projection now matches the source
    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items.find((row) => row.id === approved.id)?.status).toBe('approved');
    expect(page.items.find((row) => row.id === pending.id)?.status).toBe('pending');
    const totals = await operationsService.totals(companyId);
    expect(totals.approvedCount).toBe('1');
    expect(totals.approvedAmountCents).toBe('100');
    expect(totals.pendingCount).toBe('1');
    expect(totals.pendingAmountCents).toBe('200');

    // running the same window again must leave the same result
    const first = await snapshotProjection();
    await projectionService.rederive(from, to);
    const second = await snapshotProjection();
    expect(second).toEqual(first);
  });

  it('the drift-repair job finds injected drift, fixes it, then finds nothing', async () => {
    const { companyId, workerId } = await seedCompany();
    const order = await orderService.createOrder({ companyId, workerId, amountCents: 400n });
    await eventService.logEvent({ companyId, workerId, type: 'incident_reported' });

    await prisma.$executeRawUnsafe(`UPDATE op_operations SET amount_cents = 999, last_event_type = 'wrong' WHERE id = '${order.id}'`);
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET pending_amount_cents = pending_amount_cents + 999 WHERE company_id = '${companyId}'`);

    const { from, to } = recentWindow();
    const report = await projectionService.repairDrift(from, to);
    expect(report.discrepancies.operationsStale).toBeGreaterThanOrEqual(1);
    expect(report.discrepancies.totalsCompanies).toBe(1);
    expect(report.repaired).toBe(true);

    // the repair fixed everything
    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].amountCents).toBe('400');
    expect(page.items[0].lastEventType).toBe('incident_reported');
    const totals = await operationsService.totals(companyId);
    expect(totals.pendingAmountCents).toBe('400');

    // a second run finds nothing to do
    const second = await projectionService.repairDrift(from, to);
    expect(second.repaired).toBe(false);
    expect(second.discrepancies.operationsStale).toBe(0);
    expect(second.discrepancies.operationsOrphan).toBe(0);
    expect(second.discrepancies.totalsCompanies).toBe(0);
  });

  it('repairs orphan projection rows left behind by a manual source deletion', async () => {
    const { companyId, workerId } = await seedCompany();
    const order = await orderService.createOrder({ companyId, workerId, amountCents: 150n });

    // an operator deletes the source order manually, orphaning the projection row
    await prisma.$executeRawUnsafe(`DELETE FROM payment_orders WHERE id = '${order.id}'`);

    const { from, to } = recentWindow();
    const report = await projectionService.repairDrift(from, to);
    expect(report.discrepancies.operationsOrphan).toBe(1);
    expect(report.repaired).toBe(true);

    const page = await operationsService.list({ companyId, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(0);
    const totals = await operationsService.totals(companyId);
    expect(totals.ordersCount).toBe('0');
    expect(totals.pendingCount).toBe('0');
    expect(totals.pendingAmountCents).toBe('0');
  });
});
