// ASSUMPTION: DATABASE_URL points to a dedicated Postgres test database
// (the only environment configuration the tests rely on).
import { DriftRepairRepository } from '../src/drift-repair/drift-repair.repository.js';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { FinancialTotalsRepository } from '../src/financial-totals/financial-totals.repository.js';
import { FinancialTotalsService } from '../src/financial-totals/financial-totals.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OrderEventsRepository } from '../src/order-events/order-events.repository.js';
import { OrderEventsService } from '../src/order-events/order-events.service.js';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository.js';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export interface Services {
  prisma: PrismaService;
  paymentOrdersService: PaymentOrdersService;
  orderEventsService: OrderEventsService;
  operationsService: OperationsService;
  financialTotalsService: FinancialTotalsService;
  driftRepairService: DriftRepairService;
}

export function createPrisma(): PrismaService {
  return new PrismaService();
}

export function buildServices(prisma: PrismaService): Services {
  const operationsRepository = new OperationsRepository(prisma);
  const totalsRepository = new FinancialTotalsRepository(prisma);
  const eventsRepository = new OrderEventsRepository(prisma);
  const ordersRepository = new PaymentOrdersRepository(prisma);
  const driftRepairRepository = new DriftRepairRepository(prisma);
  return {
    prisma,
    paymentOrdersService: new PaymentOrdersService(
      ordersRepository,
      eventsRepository,
      operationsRepository,
      totalsRepository,
    ),
    orderEventsService: new OrderEventsService(eventsRepository, operationsRepository),
    operationsService: new OperationsService(operationsRepository),
    financialTotalsService: new FinancialTotalsService(totalsRepository),
    driftRepairService: new DriftRepairService(driftRepairRepository, operationsRepository, totalsRepository),
  };
}

/** Delete in FK-safe order so each test starts from an empty database. */
export async function cleanAllTables(prisma: PrismaService): Promise<void> {
  await prisma.orderEvent.deleteMany({});
  await prisma.operation.deleteMany({});
  await prisma.companyFinancialTotal.deleteMany({});
  await prisma.paymentOrder.deleteMany({});
  await prisma.worker.deleteMany({});
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
