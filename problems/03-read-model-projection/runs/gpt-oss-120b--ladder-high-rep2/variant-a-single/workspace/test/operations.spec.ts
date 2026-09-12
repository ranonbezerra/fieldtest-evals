import { Test, TestingModule } from '@nestjs/testing';
import { OperationsModule } from '../src/operations/operations.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OperationsProjectionService } from '../src/operations/operations-projection.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsDriftRepairService } from '../src/operations/operations-drift-repair.service.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Operations Dashboard Projection', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let projectionService: OperationsProjectionService;
  let operationsService: OperationsService;
  let driftRepairService: OperationsDriftRepairService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, OperationsModule],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    projectionService = moduleRef.get<OperationsProjectionService>(OperationsProjectionService);
    operationsService = moduleRef.get<OperationsService>(OperationsService);
    driftRepairService = moduleRef.get<OperationsDriftRepairService>(OperationsDriftRepairService);

    // Clean tables before tests
    await prisma.companyFinancialTotal.deleteMany();
    await prisma.operationProjection.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.company.deleteMany();
    await prisma.worker.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should see own writes immediately', async () => {
    // Arrange: create company, worker, order
    const company = await prisma.company.create({
      data: { name: 'Acme Corp' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'John Doe' },
    });
    const order = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 100,
      },
    });

    // Act: approve order inside a transaction and sync projection
    await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'approved' },
      });
      await projectionService.syncOrder(tx, updatedOrder);
    });

    // Assert: dashboard query reflects approved order
    const result = await operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      skip: 0,
      take: 10,
    });

    expect(result.total).toBe(1);
    expect(result.data[0].order_id).toBe(order.id);
    expect(result.data[0].status).toBe('approved');
  });

  it('should handle concurrent approvals with exact totals', async () => {
    // Arrange
    const company = await prisma.company.create({
      data: { name: 'Beta Ltd' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'Jane Smith' },
    });
    const order1 = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 150,
      },
    });
    const order2 = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 250,
      },
    });

    // Helper to approve an order
    const approve = async (orderId: number) => {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.paymentOrder.update({
          where: { id: orderId },
          data: { status: 'approved' },
        });
        await projectionService.syncOrder(tx, updated);
      });
    };

    // Act: run approvals concurrently
    await Promise.all([approve(order1.id), approve(order2.id)]);

    // Assert: company total equals sum of both amounts
    const total = await prisma.companyFinancialTotal.findUnique({
      where: { company_id: company.id },
    });
    expect(total).toBeDefined();
    expect(total!.total_amount.toNumber()).toBeCloseTo(400);
  });

  it('should detect and repair drift', async () => {
    // Arrange: create a company and an approved order via write path
    const company = await prisma.company.create({
      data: { name: 'Gamma Inc' },
    });
    const worker = await prisma.worker.create({
      data: { name: 'Alice' },
    });
    const order = await prisma.paymentOrder.create({
      data: {
        company_id: company.id,
        worker_id: worker.id,
        status: 'pending',
        amount: 300,
      },
    });

    // Approve order via transaction (writes projection)
    await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'approved' },
      });
      await projectionService.syncOrder(tx, updated);
    });

    // Inject drift: modify projection amount and total
    await prisma.operationProjection.update({
      where: { order_id: order.id },
      data: { amount: 200 }, // wrong amount
    });
    await prisma.companyFinancialTotal.update({
      where: { company_id: company.id },
      data: { total_amount: 0 }, // wrong total
    });

    // Act: run drift repair for a recent window
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await driftRepairService.repairWindow(past, now);

    // Assert: projection corrected
    const proj = await prisma.operationProjection.findUnique({
      where: { order_id: order.id },
    });
    expect(proj).toBeDefined();
    expect(proj!.amount.toNumber()).toBeCloseTo(300);
    expect(proj!.status).toBe('approved');

    // Assert: total corrected
    const total = await prisma.companyFinancialTotal.findUnique({
      where: { company_id: company.id },
    });
    expect(total).toBeDefined();
    expect(total!.total_amount.toNumber()).toBeCloseTo(300);
  });
});
