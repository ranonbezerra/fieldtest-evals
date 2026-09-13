import { Test } from '../nestjs-testing.js';
import { PrismaService } from '../src/prisma.service.js';
import { PaymentOrderModule } from '../src/payment-order/payment-order.module.js';
import { OperationsModule } from '../src/operations/operations.module.js';
import { CompanyTotalsModule } from '../src/company-totals/company-totals.module.js';
import { PaymentOrderService } from '../src/payment-order/payment-order.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanyTotalsRepository } from '../src/company-totals/company-totals.repository.js';
import { Prisma, Decimal } from '@prisma/client';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let prisma: PrismaService;
let paymentOrderService: PaymentOrderService;
let operationsService: OperationsService;
let totalsRepo: CompanyTotalsRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [PaymentOrderModule, OperationsModule, CompanyTotalsModule],
  }).compile();

  prisma = moduleRef.get<PrismaService>(PrismaService);
  paymentOrderService = moduleRef.get<PaymentOrderService>(PaymentOrderService);
  operationsService = moduleRef.get<OperationsService>(OperationsService);
  totalsRepo = moduleRef.get<CompanyTotalsRepository>(CompanyTotalsRepository);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.operationProjection.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.companyFinancialTotal.deleteMany();
  await prisma.company.deleteMany();
  await prisma.worker.deleteMany();
});

describe('Operations Dashboard Projection', () => {
  it('should reflect own writes immediately (read‑your‑own‑writes)', async () => {
    const company = await prisma.company.create({ data: { name: 'Acme Corp' } });
    const worker = await prisma.worker.create({ data: { name: 'John Doe' } });

    const order = await paymentOrderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: new Decimal(100),
    });

    await paymentOrderService.approveOrder(order.id);

    const result = await operationsService.getOperations({
      companyId: company.id,
      status: 'APPROVED',
      startDate: undefined,
      endDate: undefined,
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items[0].orderId).toBe(order.id);
    expect(result.items[0].status).toBe('APPROVED');
  });

  it('should handle concurrent approvals without losing totals', async () => {
    const company = await prisma.company.create({ data: { name: 'Beta Ltd' } });
    const worker = await prisma.worker.create({ data: { name: 'Alice' } });

    const order1 = await paymentOrderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: new Decimal(150),
    });
    const order2 = await paymentOrderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: new Decimal(250),
    });

    await Promise.all([
      paymentOrderService.approveOrder(order1.id),
      paymentOrderService.approveOrder(order2.id),
    ]);

    const totals = await totalsRepo.findByCompanyId(company.id);
    expect(totals).toBeDefined();
    expect(totals!.totalAmount.toNumber()).toBe(400);
    expect(totals!.approvedAmount.toNumber()).toBe(400);
  });

  it('should repair drift between source and projection', async () => {
    const company = await prisma.company.create({ data: { name: 'Gamma Inc' } });
    const worker = await prisma.worker.create({ data: { name: 'Bob' } });

    const order = await paymentOrderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      amount: new Decimal(300),
    });

    await paymentOrderService.approveOrder(order.id);

    // Inject drift: corrupt the projection status
    await prisma.operationProjection.update({
      where: { orderId: order.id },
      data: { status: 'PENDING' },
    });

    const drifted = await prisma.operationProjection.findUnique({
      where: { orderId: order.id },
    });
    expect(drifted!.status).toBe('PENDING');

    // Run drift‑repair job
    await operationsService.repairDrift(2); // covers the order

    const corrected = await prisma.operationProjection.findUnique({
      where: { orderId: order.id },
    });
    expect(corrected!.status).toBe('APPROVED');
  });
});
