import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

async function snapshot(prisma: PrismaClient, companyId: string) {
  const [rows, totals] = await Promise.all([
    prisma.opsRow.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    prisma.companyTotal.findUnique({ where: { companyId } }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      amountCents: Number(row.amountCents),
      occurredAt: row.occurredAt,
      workerName: row.workerName,
      eventName: row.eventName,
    })),
    totals: totals
      ? {
          totalCents: Number(totals.totalCents),
          approvedCents: Number(totals.approvedCents),
          rejectedCents: Number(totals.rejectedCents),
          orderCount: totals.orderCount,
        }
      : null,
  };
}

describe.skipIf(!hasDatabase)('windowed re-derivation', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rebuilds the projection for a window from the source tables', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company, worker, event } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 100,
    });
    const b = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 200,
    });
    const c = await app.orderService.createOrder({ companyId: company.id, amountCents: 300 });
    await app.orderService.approveOrder(a.id);
    await app.orderService.rejectOrder(b.id);
    const after = new Date();

    // Wipe the projection so the re-derivation has to rebuild it.
    await prisma.$executeRaw`TRUNCATE ops_rows, company_totals`;

    const result = await app.projectionService.rederiveWindow(before, after);

    expect(result.rowsRebuilt).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    const rows = await prisma.opsRow.findMany({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => ({ id: row.id, status: row.status, amountCents: Number(row.amountCents) }))).toEqual([
      { id: a.id, status: 'approved', amountCents: 100 },
      { id: b.id, status: 'rejected', amountCents: 200 },
      { id: c.id, status: 'pending', amountCents: 300 },
    ]);
    // Denormalized names survive the rebuild (and stay null where the source has none).
    expect(rows[0].workerName).toBe('Wendy');
    expect(rows[0].eventName).toBe('Launch');
    expect(rows[2].workerName).toBeNull();

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(600);
    expect(totals.approvedCents).toBe(100);
    expect(totals.rejectedCents).toBe(200);
    expect(totals.orderCount).toBe(3);
  });

  it('leaves the same result when run twice over the same window', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({ companyId: company.id, amountCents: 111 });
    await app.orderService.approveOrder(a.id);
    const after = new Date();

    await app.projectionService.rederiveWindow(before, after);
    const first = await snapshot(prisma, company.id);
    await app.projectionService.rederiveWindow(before, after);
    const second = await snapshot(prisma, company.id);

    expect(second).toEqual(first);
  });
});
