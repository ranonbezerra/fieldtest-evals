import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResourceNotFoundError } from '../src/common/errors.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { ProjectionRepository } from '../src/operations/projection.repository.js';
import { createTestApp, snapshotOperationRows, TestApp, windowAroundNow } from './helpers.js';

describe('re-derivation and drift repair', () => {
  let app: TestApp;
  let operations: OperationsService;
  let drift: DriftRepairService;

  beforeAll(async () => {
    app = await createTestApp();
    operations = app.moduleRef.get(OperationsService);
    // The DI-provided job is stubbed (no cron in tests); drive the real class directly.
    drift = new DriftRepairService(
      app.moduleRef.get(PrismaService),
      app.moduleRef.get(ProjectionRepository),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedSourceState() {
    // Direct source seed: the projection is built purely by the re-derivation routine,
    // not by the hooks, so this proves the routine reproduces the join result.
    const company = await app.prisma.company.create({ data: { name: `rederive-${randomUUID()}` } });
    const workerA = await app.prisma.worker.create({
      data: { name: `RD worker A ${randomUUID().slice(0, 8)}`, companyId: company.id },
    });
    const workerB = await app.prisma.worker.create({
      data: { name: `RD worker B ${randomUUID().slice(0, 8)}`, companyId: company.id },
    });

    const t1 = new Date(Date.now() - 5 * 60_000);
    const t2 = new Date(Date.now() - 3 * 60_000);
    const t3 = new Date(Date.now() - 1 * 60_000);

    const approvedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'approved', amountCents: 100, currency: 'USD' },
    });
    const pendingOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerB.id, status: 'pending', amountCents: 200, currency: 'USD' },
    });
    const disputedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'disputed', amountCents: 300, currency: 'USD' },
    });

    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'field_visit', occurredAt: t1 } });
    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'approved', occurredAt: t2 } });
    await app.prisma.event.create({ data: { paymentOrderId: pendingOrder.id, eventType: 'created', occurredAt: t3 } });

    return { company, workerA, workerB, approvedOrder, pendingOrder, disputedOrder, t1, t2, t3 };
  }

  it('rebuilding a window reproduces the join result, and a second run leaves the same result', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();

    const first = await operations.rederive(window.from, window.to);
    expect(first.rowsRebuilt).toBeGreaterThanOrEqual(3);

    const rows = await snapshotOperationRows(app.prisma, s.company.id);
    expect(rows).toHaveLength(3);

    const byId = new Map(rows.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      amountCents: 100,
      latestEventType: 'approved',
      latestEventAt: s.t2.toISOString(),
    });
    expect(byId.get(s.pendingOrder.id)).toMatchObject({
      status: 'pending',
      workerName: s.workerB.name,
      amountCents: 200,
      latestEventType: 'created',
    });
    expect(byId.get(s.disputedOrder.id)).toMatchObject({
      status: 'disputed',
      amountCents: 300,
      latestEventType: null,
      latestEventAt: null,
    });

    // Totals recomputed from the source, exactly.
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A second run over the same window must leave the same result (idempotent, safe while live).
    const second = await operations.rederive(window.from, window.to);
    const rowsAfterSecond = await snapshotOperationRows(app.prisma, s.company.id);
    expect(second.rowsRebuilt).toBeGreaterThanOrEqual(3);
    expect(rowsAfterSecond).toEqual(rows);
  });

  it('the drift repair job finds and fixes injected drift in rows and totals', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();
    await operations.rederive(window.from, window.to); // baseline: projection == source

    // Inject drift the way a deploy mid-transaction or a manual data fix would.
    await app.prisma.operationRow.update({
      where: { paymentOrderId: s.approvedOrder.id },
      data: {
        status: 'pending',
        workerName: 'corrupted',
        latestEventType: null,
        latestEventAt: null,
        latestEventId: null,
      },
    });
    await app.prisma.companyFinancialTotals.update({
      where: { companyId: s.company.id },
      data: { approvedAmountCents: { decrement: 100 }, approvedCount: { decrement: 1 } },
    });

    // Sanity: the drift is actually present before the repair.
    const drifted = await snapshotOperationRows(app.prisma, s.company.id);
    expect(drifted.find((row) => row.paymentOrderId === s.approvedOrder.id)).toMatchObject({
      status: 'pending',
      workerName: 'corrupted',
    });
    const corruptedTotals = await operations.totals(s.company.id);
    expect(corruptedTotals.approved).toEqual({ amountCents: 0, count: 0 });

    const report = await drift.run();
    expect(report.driftedOrders).toBeGreaterThanOrEqual(1);
    expect(report.totalsRecomputed).toBe(true);

    // The projection matches the source again.
    const repaired = await snapshotOperationRows(app.prisma, s.company.id);
    const byId = new Map(repaired.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      latestEventType: 'approved',
    });
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A follow-up run finds nothing to repair.
    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedTotalsCompanies).toBe(0);
    expect(clean.totalsRecomputed).toBe(false);
  });

  it('returns resource_not_found for a totals lookup of an unknown company', async () => {
    await expect(operations.totals(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });
});
