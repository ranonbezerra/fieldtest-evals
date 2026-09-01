import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: WritesService.createOrder returns { id: string; status: OrderStatus } per PLAN.md.
// ASSUMPTION: The source tables (payment_orders, events, workers) are managed via Prisma;
//   company_id is a plain string column (no dedicated companies table in schema).

import { ProjectionsRepository } from '../src/projections/projections.repository';
import { ProjectionsService } from '../src/projections/projections.service';
import { OperationsRepository } from '../src/operations/operations.repository';
import { OperationsService } from '../src/operations/operations.service';
import { WritesService } from '../src/writes/writes.service';
import type {
  CreateOrderInput,
  OperationQueryParams,
  OperationRow,
} from '../src/projections/projections.types';

let prisma: PrismaClient;
let projectionsRepo: ProjectionsRepository;
let projectionsService: ProjectionsService;
let operationsRepo: OperationsRepository;
let operationsService: OperationsService;
let writesService: WritesService;

beforeAll(async () => {
  prisma = new PrismaClient();
  projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
  writesService = new WritesService(prisma, projectionsService);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Creates a worker and event for the given company; returns their IDs. */
async function createFixtures(companyId: string): Promise<{ workerId: string; eventId: string }> {
  const worker = await prisma.worker.create({
    data: { name: `Worker ${companyId}`, companyId },
  });
  const event = await prisma.event.create({
    data: { title: `Event ${companyId}`, location: `Location ${companyId}` },
  });
  return { workerId: worker.id, eventId: event.id };
}

/** Cleans up all data belonging to the given company across source and projection tables. */
async function cleanup(companyId: string): Promise<void> {
  await prisma.operationReadModel.deleteMany({ where: { companyId } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId } });
  await prisma.worker.deleteMany({ where: { companyId } });
}

function makeOrderInput(companyId: string, workerId: string, eventId: string, amountCents: number): CreateOrderInput {
  return { companyId, workerId, eventId, amountCents };
}

describe('Read-your-own-writes', () => {
  it('a newly created order is immediately visible in the dashboard query', async () => {
    const companyId = 'ryw-create-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 5000),
    );

    const page = await operationsService.query({
      companyId,
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    const row = page.items[0];
    expect(row.id).toBe(order.id);
    expect(row.status).toBe('pending');
    expect(row.amountCents).toBe(5000);
    expect(row.workerId).toBe(workerId);
    expect(row.eventId).toBe(eventId);

    await cleanup(companyId);
  });

  it('an approved order immediately reflects the status change in a filtered dashboard query', async () => {
    const companyId = 'ryw-approve-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 7500),
    );
    await writesService.approveOrder(order.id);

    const page = await operationsService.query({
      companyId,
      status: 'approved',
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(order.id);
    expect(page.items[0].status).toBe('approved');

    await cleanup(companyId);
  });
});

describe('Concurrent updates to one company totals', () => {
  it('concurrent approvals on different orders preserve exact totals', async () => {
    const companyId = 'conc-approve-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const amounts = [1000, 2000, 3000, 4000, 5000];
    const orders = await Promise.all(
      amounts.map((a) =>
        writesService.createOrder(makeOrderInput(companyId, workerId, eventId, a)),
      ),
    );

    // Approve all orders concurrently
    await Promise.all(orders.map((o) => writesService.approveOrder(o.id)));

    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(15000n);
    expect(totals.rejectedTotalCents).toBe(0n);
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });

  it('mixed concurrent create and approve preserves the final invariant', async () => {
    const companyId = 'conc-mixed-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Create 5 orders sequentially first
    const orders = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        writesService.createOrder(makeOrderInput(companyId, workerId, eventId, (i + 1) * 1000)),
      ),
    );

    // Now concurrently: approve 3, reject 2
    const [toApprove, toReject] = [orders.slice(0, 3), orders.slice(3, 5)];
    await Promise.all([
      ...toApprove.map((o) => writesService.approveOrder(o.id)),
      ...toReject.map((o) => writesService.rejectOrder(o.id)),
    ]);

    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(6000n); // 1000+2000+3000
    expect(totals.rejectedTotalCents).toBe(7000n); // 4000+5000
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });
});

describe('Drift repair', () => {
  it('detects and fixes a corrupted projection row (wrong status)', async () => {
    const companyId = 'drift-status-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 9000),
    );
    await writesService.approveOrder(order.id);

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    // Corrupt: set projection status back to 'pending'
    await prisma.operationReadModel.update({
      where: { id: order.id },
      data: { status: 'pending' as any },
    });

    const report = await projectionsService.repairDrift(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Verify projection now matches source
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].status).toBe('approved');

    // Verify totals are corrected
    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(9000n);
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });

  it('restores a deleted projection row and corrects totals', async () => {
    const companyId = 'drift-delete-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 4200),
    );

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    // Delete the projection row
    await prisma.operationReadModel.delete({ where: { id: order.id } });

    const report = await projectionsService.repairDrift(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Row should be restored
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(order.id);

    // Totals should reflect the pending order
    const totals = await projectionsService.getTotals(companyId);
    expect(totals.pendingCount).toBe(1);

    await cleanup(companyId);
  });
});

describe('Re-derivation', () => {
  it('rebuilds the projection from source regardless of prior corruption', async () => {
    const companyId = 'rederive-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const amounts = [100, 200, 300];
    const orders = await Promise.all(
      amounts.map((a) => writesService.createOrder(makeOrderInput(companyId, workerId, eventId, a))),
    );

    // Corrupt all projection rows
    for (const o of orders) {
      await prisma.operationReadModel.update({
        where: { id: o.id },
        data: { amountCents: 99999, status: 'rejected' as any },
      });
    }

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    const report = await projectionsService.rederive(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(3);

    // Verify all rows are correct
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.total).toBe(3);
    for (const row of page.items) {
      expect(row.status).toBe('pending');
      const sourceOrder = orders.find((o) => o.id === row.id)!;
      expect(row.amountCents).toBe(amounts[orders.indexOf(sourceOrder)]);
    }

    await cleanup(companyId);
  });
});

describe('Dashboard pagination and filtering', () => {
  it('pagination returns correct item count and total across pages', async () => {
    const companyId = 'paging-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Insert 25 orders
    for (let i = 0; i < 25; i++) {
      await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, (i + 1) * 100));
    }

    const page1 = await operationsService.query({ companyId, page: 1, pageSize: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(10);

    const page3 = await operationsService.query({ companyId, page: 3, pageSize: 10 });
    expect(page3.items).toHaveLength(5);
    expect(page3.total).toBe(25);
    expect(page3.page).toBe(3);

    await cleanup(companyId);
  });

  it('date range filter returns only rows within the specified window', async () => {
    const companyId = 'datefilter-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Create an "old" order, then pause briefly, then a "new" order
    await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, 100));

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 50));

    const from = new Date();
    await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, 200));

    // Query with a window that only includes the second order
    const page = await operationsService.query({
      companyId,
      from,
      to: new Date(Date.now() + 60_000),
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items[0].amountCents).toBe(200);

    await cleanup(companyId);
  });
});
