import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { Decimal } from '@prisma/client';

describe('Operations Dashboard Projection', () => {
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let operationsService: OperationsService;
  let driftRepairService: DriftRepairService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    ordersService = module.get<OrdersService>(OrdersService);
    operationsService = module.get<OperationsService>(OperationsService);
    driftRepairService = module.get<DriftRepairService>(DriftRepairService);

    // Clean database tables before tests
    await prisma.companyFinancialTotal.deleteMany({});
    await prisma.operationDashboard.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('read‑your‑own‑writes: approving an order is reflected immediately', async () => {
    // Arrange
    const companyId = 1;
    const workerId = await prisma.worker
      .create({ data: { name: 'Alice' } })
      .then((w) => w.id);

    const order = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: new Decimal(100),
        createdAt: new Date(),
      },
    });

    // Act
    await ordersService.approveOrder(order.id, workerId);

    // Assert
    const ops = await operationsService.listOperations({
      companyId,
      status: 'approved',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].orderId).toBe(order.id);
    expect(ops[0].status).toBe('approved');
  });

  it('concurrent approvals for same company result in exact financial totals', async () => {
    // Arrange
    const companyId = 2;
    const workerId1 = await prisma.worker
      .create({ data: { name: 'Bob' } })
      .then((w) => w.id);
    const workerId2 = await prisma.worker
      .create({ data: { name: 'Carol' } })
      .then((w) => w.id);

    const amount1 = new Decimal(150);
    const amount2 = new Decimal(250);

    const order1 = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: amount1,
        createdAt: new Date(),
      },
    });

    const order2 = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: amount2,
        createdAt: new Date(),
      },
    });

    // Act: approve both orders concurrently
    await Promise.all([
      ordersService.approveOrder(order1.id, workerId1),
      ordersService.approveOrder(order2.id, workerId2),
    ]);

    // Assert
    const totalRow = await prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });
    expect(totalRow).toBeDefined();
    const expectedTotal = amount1.plus(amount2);
    expect(totalRow!.totalAmount.equals(expectedTotal)).toBe(true);
  });

  it('drift repair fixes injected inconsistency', async () => {
    // Arrange
    const companyId = 3;
    const workerId = await prisma.worker
      .create({ data: { name: 'Dave' } })
      .then((w) => w.id);

    const order = await prisma.paymentOrder.create({
      data: {
        companyId,
        status: 'pending',
        amount: new Decimal(300),
        createdAt: new Date(),
      },
    });

    await ordersService.approveOrder(order.id, workerId);

    // Inject drift: corrupt the projection row
    await prisma.operationDashboard.updateMany({
      where: { orderId: order.id },
      data: { status: 'pending' },
    });

    // Verify drift exists
    const corrupted = await prisma.operationDashboard.findUnique({
      where: { orderId: order.id },
    });
    expect(corrupted?.status).toBe('pending');

    // Act: run drift repair
    await driftRepairService.repairDrift();

    // Assert: projection now matches source
    const fixed = await prisma.operationDashboard.findUnique({
      where: { orderId: order.id },
    });
    expect(fixed?.status).toBe('approved');
  });
});
