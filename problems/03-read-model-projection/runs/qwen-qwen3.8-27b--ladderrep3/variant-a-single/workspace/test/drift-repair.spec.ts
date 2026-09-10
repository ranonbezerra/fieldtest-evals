import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('scheduled drift repair', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('detects drifted rows and totals in the recent window and repairs them', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = [500, 501, 502];
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<OrderBody>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    const repairService = app!.app.get(DriftRepairService);
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Baseline: everything agrees, nothing is repaired.
    const clean = await repairService.repairWindow(from, now);
    expect(clean.repaired).toBe(false);
    expect(clean.drifted_row_count).toBe(0);
    expect(clean.drifted_company_count).toBe(0);

    // Inject drift: one row with a wrong status/timestamp, one row missing,
    // one inflated totals row.
    const [a, b] = ids;
    await prisma!.$executeRaw`
      UPDATE "operation_read_model"
      SET "status" = 'approved', "updated_at" = "updated_at" + interval '1 hour'
      WHERE "payment_order_id" = ${a}
    `;
    await prisma!.$executeRaw`
      DELETE FROM "operation_read_model" WHERE "payment_order_id" = ${b}
    `;
    await prisma!.$executeRaw`
      UPDATE "company_financial_totals"
      SET "approved_amount_cents" = "approved_amount_cents" + 9999
      WHERE "company_id" = ${fx.companyId}
    `;

    const report = await repairService.repairWindow(from, now);
    expect(report.repaired).toBe(true);
    expect(report.drifted_row_count).toBe(2);
    expect(report.drifted_company_count).toBe(1);

    // The projection agrees with the source again.
    const rows = await prisma!.operationReadModel.findMany({
      where: { paymentOrderId: { in: ids } },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      const source = await prisma!.paymentOrder.findUniqueOrThrow({ where: { id: row.paymentOrderId } });
      expect(row.updatedAt.getTime()).toBe(source.updatedAt.getTime());
    }

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body.approved_amount_cents).toBe('0');
    expect(totals.body.pending_amount_cents).toBe(String(amounts.reduce((sum, value) => sum + value, 0)));
  });
});
