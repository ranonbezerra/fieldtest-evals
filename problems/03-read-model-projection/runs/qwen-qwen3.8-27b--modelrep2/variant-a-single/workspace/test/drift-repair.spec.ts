import { OrderStatus, Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, cleanAllTables, createPrisma, Services } from './helpers.js';

const COMPANY_IN = '33333333-3333-4333-8333-333333333333';
const COMPANY_OUT = '44444444-4444-4444-8444-444444444444';

describe('drift repair and windowed re-derivation', () => {
  const services: Services = buildServices(createPrisma());

  beforeAll(async () => {
    await services.prisma.$connect();
  });
  afterEach(async () => {
    await cleanAllTables(services.prisma);
  });
  afterAll(async () => {
    await services.prisma.$disconnect();
  });

  it('repairs only the projection inside the window, exactly, and reports drift', async () => {
    const { prisma, paymentOrdersService, driftRepairService, financialTotalsService, operationsService } = services;

    const workerIn = await prisma.worker.create({ data: { companyId: COMPANY_IN, name: 'Mary Jackson' } });
    const workerOut = await prisma.worker.create({ data: { companyId: COMPANY_OUT, name: 'Chien-Shiung Wu' } });
    const oldCreated = new Date('2020-01-01T00:00:00.000Z');

    const first = await paymentOrdersService.create({
      companyId: COMPANY_IN,
      workerId: workerIn.id,
      amount: new Prisma.Decimal('100.00'),
      currency: 'USD',
    });
    const second = await paymentOrdersService.create({
      companyId: COMPANY_IN,
      workerId: workerIn.id,
      amount: new Prisma.Decimal('200.00'),
      currency: 'USD',
    });
    await paymentOrdersService.changeStatus(first.id, OrderStatus.CAPTURED);

    // A legacy order written before hooks existed: only in the source, no projection rows.
    const legacy = await prisma.paymentOrder.create({
      data: {
        companyId: COMPANY_OUT,
        workerId: workerOut.id,
        amount: new Prisma.Decimal('55.00'),
        currency: 'USD',
        status: OrderStatus.CAPTURED,
        createdAt: oldCreated,
      },
    });

    // Simulate drift: corrupt the projection rows the hooks wrote.
    await prisma.operation.update({
      where: { id: first.id },
      data: { status: OrderStatus.PENDING, amount: new Prisma.Decimal('1.00'), workerName: 'Corrupted' },
    });
    await prisma.companyFinancialTotal.update({
      where: { companyId_status: { companyId: COMPANY_IN, status: OrderStatus.CAPTURED } },
      data: { orderCount: 9, totalAmount: new Prisma.Decimal('1.23') },
    });

    const windowFrom = new Date(Date.now() - 60 * 60 * 1000);
    const windowTo = new Date(Date.now() + 60 * 60 * 1000);

    const report = await driftRepairService.rederive(windowFrom, windowTo);
    expect(report.ordersInWindow).toBe(2);
    expect(report.companiesRebuilt).toBe(1);
    expect(report.driftDetected).toBe(true);
    expect(report.operationsCorrected).toBe(1);
    expect(report.totalsCorrected).toBe(1);

    // The in-window projection is repaired exactly from the source of truth.
    const page = await operationsService.list({ companyId: COMPANY_IN, page: 1, pageSize: 50 });
    const firstRow = page.items.find(item => item.id === first.id);
    expect(firstRow).toMatchObject({
      status: OrderStatus.CAPTURED,
      amount: '100.0000',
      worker_name: 'Mary Jackson',
    });
    const totals = await financialTotalsService.forCompany(COMPANY_IN);
    expect(totals.total).toEqual({ order_count: 2, total_amount: '300.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.CAPTURED, order_count: 1, total_amount: '100.0000' });
    expect(totals.by_status).toContainEqual({ status: OrderStatus.PENDING, order_count: 1, total_amount: '200.0000' });

    // Out of the window: the legacy order must not be touched by this run.
    expect(await prisma.operation.findUnique({ where: { id: legacy.id } })).toBeNull();
    expect(await prisma.companyFinancialTotal.count({ where: { companyId: COMPANY_OUT } })).toBe(0);

    // Idempotent: a second run over the same window finds no drift.
    const clean = await driftRepairService.rederive(windowFrom, windowTo);
    expect(clean.driftDetected).toBe(false);
    expect(clean.operationsCorrected).toBe(0);
    expect(clean.totalsCorrected).toBe(0);

    // A wider window pulls the legacy order into scope and repairs it from source.
    const wide = await driftRepairService.rederive(new Date('2019-01-01T00:00:00.000Z'), windowTo);
    expect(wide.driftDetected).toBe(true);
    expect(wide.ordersInWindow).toBe(3);
    expect(wide.companiesRebuilt).toBe(2);

    const legacyRow = await prisma.operation.findUnique({ where: { id: legacy.id } });
    expect(legacyRow).not.toBeNull();
    expect(legacyRow).toMatchObject({
      status: OrderStatus.CAPTURED,
      worker_name: 'Chien-Shiung Wu',
      worker_id: workerOut.id,
    });
    expect(legacyRow?.amount.toFixed(4)).toBe('55.0000');
    expect(legacyRow?.lastEventAt.toISOString()).toBe(oldCreated.toISOString());

    const legacyTotals = await financialTotalsService.forCompany(COMPANY_OUT);
    expect(legacyTotals.total).toEqual({ order_count: 1, total_amount: '55.0000' });
    expect(legacyTotals.by_status).toContainEqual({
      status: OrderStatus.CAPTURED,
      order_count: 1,
      total_amount: '55.0000',
    });
  }, 120_000);
});
