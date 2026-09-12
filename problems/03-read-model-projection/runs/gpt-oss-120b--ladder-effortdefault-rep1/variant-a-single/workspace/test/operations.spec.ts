import { Test, TestingModule } from '@nestjs/testing';
import { OperationsService } from '../src/operations/operations.service';
import { OperationsRepository } from '../src/operations/operations.repository';
import { PrismaService } from '../src/prisma.service';
import { Prisma, Decimal } from '@prisma/client';
import { expect, test, describe, beforeAll, afterAll } from 'vitest';

let module: TestingModule;
let service: OperationsService;
let repo: OperationsRepository;
let prisma: PrismaService;

beforeAll(async () => {
  module = await Test.createTestingModule({
    providers: [OperationsService, OperationsRepository, PrismaService],
  }).compile();

  service = module.get(OperationsService);
  repo = module.get(OperationsRepository);
  prisma = module.get(PrismaService);
  await prisma.$connect();

  // Clean tables before tests.
  await prisma.operationProjection.deleteMany({});
  await prisma.companyFinancialTotals.deleteMany({});
  await prisma.paymentOrder.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Helper to create a payment order directly in the source table.
 */
async function createSourceOrder(data: {
  companyId: number;
  status: string;
  amount: Decimal;
  createdAt?: Date;
  approvedAt?: Date | null;
}) {
  const now = new Date();
  return prisma.paymentOrder.create({
    data: {
      companyId: data.companyId,
      workerId: null,
      eventId: null,
      status: data.status,
      amount: data.amount,
      createdAt: data.createdAt ?? now,
      approvedAt: data.approvedAt ?? null,
    },
  });
}

describe('Read‑your‑own‑writes', () => {
  test('approving an order is visible immediately', async () => {
    const order = await createSourceOrder({
      companyId: 1,
      status: 'PENDING',
      amount: new Decimal('123.45'),
    });

    // Simulate the write path: update status & run the sync hook in one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      // Call the projection hook with the new state.
      await service.handleOrderApproved({
        id: order.id,
        companyId: order.companyId,
        workerId: null,
        eventId: null,
        status: 'APPROVED',
        amount: order.amount,
        createdAt: order.createdAt,
        approvedAt: new Date(),
      });
    });

    // Dashboard request should now see the approved row.
    const result = await service.getOperations(
      { companyId: 1, status: 'APPROVED' },
      1,
      10,
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('APPROVED');
    expect(result[0].amount.equals(new Decimal('123.45'))).toBe(true);
  });
});

describe('Concurrent totals', () => {
  test('two approvals for same company result in exact total', async () => {
    // Create two pending orders for the same company.
    const orderA = await createSourceOrder({
      companyId: 2,
      status: 'PENDING',
      amount: new Decimal('50.00'),
    });
    const orderB = await createSourceOrder({
      companyId: 2,
      status: 'PENDING',
      amount: new Decimal('75.00'),
    });

    // Run two approvals concurrently.
    await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.paymentOrder.update({
          where: { id: orderA.id },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        await service.handleOrderApproved({
          id: orderA.id,
          companyId: orderA.companyId,
          workerId: null,
          eventId: null,
          status: 'APPROVED',
          amount: orderA.amount,
          createdAt: orderA.createdAt,
          approvedAt: new Date(),
        });
      }),
      prisma.$transaction(async (tx) => {
        await tx.paymentOrder.update({
          where: { id: orderB.id },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        await service.handleOrderApproved({
          id: orderB.id,
          companyId: orderB.companyId,
          workerId: null,
          eventId: null,
          status: 'APPROVED',
          amount: orderB.amount,
          createdAt: orderB.createdAt,
          approvedAt: new Date(),
        });
      }),
    ]);

    const totals = await prisma.companyFinancialTotals.findUnique({
      where: { companyId: 2 },
    });

    expect(totals).toBeDefined();
    const expected = new Decimal('125.00');
    expect(totals!.totalApprovedAmount.equals(expected)).toBe(true);
  });
});

describe('Drift repair', () => {
  test('repair job fixes injected drift', async () => {
    // Create and approve an order normally.
    const order = await createSourceOrder({
      companyId: 3,
      status: 'PENDING',
      amount: new Decimal('200.00'),
    });

    await prisma.$transaction(async (tx) => {
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      await service.handleOrderApproved({
        id: order.id,
        companyId: order.companyId,
        workerId: null,
        eventId: null,
        status: 'APPROVED',
        amount: order.amount,
        createdAt: order.createdAt,
        approvedAt: new Date(),
      });
    });

    // Inject drift: manually modify the projection row amount.
    await prisma.operationProjection.update({
      where: { orderId: order.id },
      data: { amount: new Decimal('0') },
    });

    // Totals now diverge (should be 200 but projection says 0).
    const beforeTotals = await prisma.companyFinancialTotals.findUnique({
      where: { companyId: 3 },
    });
    expect(beforeTotals!.totalApprovedAmount.equals(new Decimal('200.00'))).toBe(
      true,
    );

    // Run the repair job.
    await repo.repairDrift(24 * 60 * 60 * 1000); // 24h window to be safe.

    // Verify projection corrected.
    const proj = await prisma.operationProjection.findUnique({
      where: { orderId: order.id },
    });
    expect(proj!.amount.equals(new Decimal('200.00'))).toBe(true);

    // Totals remain correct (repair should not double‑add).
    const afterTotals = await prisma.companyFinancialTotals.findUnique({
      where: { companyId: 3 },
    });
    expect(afterTotals!.totalApprovedAmount.equals(new Decimal('200.00'))).toBe(
      true,
    );
  });
});
