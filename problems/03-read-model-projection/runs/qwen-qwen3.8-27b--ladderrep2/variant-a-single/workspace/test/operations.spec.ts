// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { ReprojectionService } from '../src/operations/reprojection.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('operations read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;
  let reproject: ReprojectionService;
  let drift: DriftRepairJob;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
    reproject = app.get(ReprojectionService);
    drift = app.get(DriftRepairJob);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedWorker(companyId: string, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
  }

  const windowTo = () => new Date(Date.now() + 60_000);

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker('10', 'A');
    const w11 = await seedWorker('11', 'B');
    const a = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 100 });
    const b = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 200 });
    const c = await orders.create({ companyId: '10', workerId: w10.id, amountCents: 300 });
    const d = await orders.create({ companyId: '11', workerId: w11.id, amountCents: 500 });
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(d.id), orders.reject(c.id)]);

    // Backdate one order in the source, then re-derive so the projection carries it.
    await prisma.$executeRawUnsafe(
      `UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`,
    );
    await reproject.rederive(new Date(0), windowTo());

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]);

    const approvedOnly = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await ops.listOperations({ companyId: 10, from: oneHourAgo, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: oneHourAgo, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    const page1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(page1.items.map((i) => i.orderId)).toEqual([c.id, b.id]);
    expect(page1.total).toBe(3);
    const page2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(page2.items.map((i) => i.orderId)).toEqual([a.id]);

    const otherCompany = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(otherCompany.items.map((i) => i.orderId)).toEqual([d.id]);
  });

  it('the dashboard reads only the projection: a source-only change is invisible until re-derivation', async () => {
    const worker = await seedWorker('20', 'Old Name');
    const order = await orders.create({ companyId: '20', workerId: worker.id, amountCents: 10 });
    await orders.approve(order.id);

    // No worker write path exists: this source change happens outside the hooks.
    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${worker.id}`);

    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // hot path does not join workers

    await reproject.rederive(new Date(0), windowTo());
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window from the source and is idempotent', async () => {
    const worker = await seedWorker('30', 'D');
    const o1 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: '30', workerId: worker.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`,
    );
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);

    const first = await reproject.rederive(new Date(0), windowTo());
    expect(first.orders).toBe(2);

    const snapshot = async () => ({
      rows: await prisma.$queryRawUnsafe(
        `SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
         FROM operations_read_model WHERE company_id = 30 ORDER BY order_id`,
      ),
      totals: await prisma.$queryRawUnsafe(
        `SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
                rejected_count, rejected_amount, refunded_count, refunded_amount
         FROM company_totals WHERE company_id = 30`,
      ),
    });

    const afterFirst = await snapshot();
    expect(afterFirst.rows).toHaveLength(2);
    for (const row of afterFirst.rows as Array<{ status: string }>) {
      expect(row.status).toBe('approved');
    }
    const totalsRow = (afterFirst.totals as Array<Record<string, unknown>>)[0];
    expect(Number(totalsRow.approved_count)).toBe(2);
    expect(Number(totalsRow.approved_amount)).toBe(333);
    expect(Number(totalsRow.pending_count)).toBe(0);

    await reproject.rederive(new Date(0), windowTo());
    const afterSecond = await snapshot();
    expect(afterSecond).toEqual(afterFirst);
  });

  it('the drift-repair job detects injected drift and repairs it', async () => {
    const worker = await seedWorker('40', 'E');
    const o1 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: '40', workerId: worker.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    // Inject drift: one row wrong, one row missing, totals off.
    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(
      `UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`,
    );

    const report = await drift.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();

    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.status).toBe('approved');
      expect(item.lastEventKind).toBe('approved');
    }
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);

    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
    expect(clean.repaired).toBeNull();
  });
});
