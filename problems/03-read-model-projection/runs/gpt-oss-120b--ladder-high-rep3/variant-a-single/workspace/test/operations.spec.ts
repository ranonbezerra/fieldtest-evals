import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PaymentOrderService } from '../src/payment-order/payment-order.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let moduleRef: TestingModule;
let paymentOrderService: PaymentOrderService;
let operationsService: OperationsService;
let operationsRepo: OperationsRepository;
let prisma: PrismaService;

describe('Operations Dashboard Projection', () => {
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    paymentOrderService = moduleRef.get(PaymentOrderService);
    operationsService = moduleRef.get(OperationsService);
    operationsRepo = moduleRef.get(OperationsRepository);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean all tables before each test
    await prisma.operationProjection.deleteMany({});
    await prisma.operationCompanyTotal.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.worker.deleteMany({});

    // Seed a worker (placeholder)
    await prisma.worker.create({
      data: { name: 'Test Worker' },
    });
  });

  it('read‑your‑own‑writes: approving an order appears immediately in dashboard', async () => {
    // 1️⃣ Create a pending order
    const order = await prisma.paymentOrder.create({
      data: {
        companyId: 'comp-xyz',
        status: 'PENDING',
        amount: new Decimal(100),
        // createdAt defaults to now()
      },
    });

    // 2️⃣ Approve the order via the write service
    await paymentOrderService.approveOrder(order.id);

    // 3️⃣ Query the dashboard
    const dashboard = await operationsService.getDashboard({
      companyId: 'comp-xyz',
      status: 'APPROVED',
    });

    // 4️⃣ Expect the order to be present with APPROVED status
    expect(dashboard.total).toBe(1);
    expect(dashboard.items[0].orderId).toBe(order.id);
    expect(dashboard.items[0].status).toBe('APPROVED');
  });

  it('concurrent approvals for same company result in exact totals', async () => {
    // Create two orders for the same company
    const [orderA, orderB] = await Promise.all([
      prisma.paymentOrder.create({
        data: {
          companyId: 'comp-abc',
          status: 'PENDING',
          amount: new Decimal(50),
        },
      }),
      prisma.paymentOrder.create({
        data: {
          companyId: 'comp-abc',
          status: 'PENDING',
          amount: new Decimal(75),
        },
      }),
    ]);

    // Approve both concurrently
    await Promise.all([
      paymentOrderService.approveOrder(orderA.id),
      paymentOrderService.approveOrder(orderB.id),
    ]);

    // Verify the per‑company total is the sum of both amounts
    const total = await operationsRepo.getCompanyTotal('comp-abc');
    expect(total.equals(new Decimal(125))).toBe(true);
  });

  it('drift‑repair job fixes injected inconsistencies', async () => {
    // Create and approve an order (this also updates totals)
    const order = await prisma.paymentOrder.create({
      data: {
        companyId: 'comp-drift',
        status: 'PENDING',
        amount: new Decimal(200),
      },
    });

    await paymentOrderService.approveOrder(order.id);

    // Manually corrupt the total in the projection table
    await prisma.$executeRawUnsafe(
      `UPDATE operation_company_total SET total_amount = 0 WHERE company_id = $1`,
      'comp-drift',
    );

    // Ensure the corruption is present
    const corruptedTotal = await operationsRepo.getCompanyTotal('comp-drift');
    expect(corruptedTotal.equals(new Decimal(0))).toBe(true);

    // Run the drift‑repair routine (as the scheduled job would)
    await operationsService.repairDrift();

    // Verify the total is repaired to the correct value
    const repairedTotal = await operationsRepo.getCompanyTotal('comp-drift');
    expect(repairedTotal.equals(new Decimal(200))).toBe(true);
  });
});
