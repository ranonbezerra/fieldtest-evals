import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { buildContext, cleanTables, seedCompany, type TestContext } from './helpers.js';

describe('concurrent updates to one company totals', () => {
  let prisma: PrismaService;
  let ctx: TestContext;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctx = buildContext(prisma);
    await cleanTables(prisma);
  }, 60000);

  afterEach(async () => {
    await cleanTables(prisma);
  });

  afterAll(async () => {
    await cleanTables(prisma);
    await prisma.$disconnect();
  });

  it('keeps the per-company total exact when approvals and creates race on the same company', async () => {
    const { company, event, worker } = await seedCompany(prisma, 'concurrent-co');

    // 6 pending orders, sum = 525.00.
    const pendingAmounts = ['25.00', '50.00', '75.00', '100.00', '125.00', '150.00'];
    const pending = [];
    for (const amount of pendingAmounts) {
      pending.push(
        await ctx.writes.createOrder({
          companyId: company.id,
          eventId: event.id,
          workerId: worker.id,
          amount,
        }),
      );
    }

    // Fire 6 approvals and 4 fresh creates (sum = 101.00) at the same time, all
    // racing on the same company totals row.
    const newAmounts = ['10.10', '20.20', '30.30', '40.40'];
    const jobs: Promise<unknown>[] = [
      ...pending.map((order) => ctx.writes.transitionStatus(order.id, 'approved')),
      ...newAmounts.map((amount) =>
        ctx.writes.createOrder({
          companyId: company.id,
          eventId: event.id,
          workerId: worker.id,
          amount,
        }),
      ),
    ];
    await Promise.all(jobs);

    // 10 operations, 626.00 total, 525.00 approved — no lost updates.
    const totals = await ctx.ops.getCompanyTotals(company.id);
    expect(totals.operationCount).toBe(10);
    expect(totals.totalAmount).toBe('626.00');
    expect(totals.approvedAmount).toBe('525.00');

    const page = await ctx.ops.listDashboard({ companyId: company.id, pageSize: 200 });
    expect(page.total).toBe(10);
  });
});
