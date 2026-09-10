import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/common/prisma.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { DriftRepairProcessor } from '../src/operations/drift-repair.processor.js';
import { OperationsModule } from '../src/operations/operations.module.js';
import { OperationsService } from '../src/operations/operations.service.js';

export interface TestContext {
  ordersService: OrdersService;
  operationsService: OperationsService;
  driftRepairProcessor: DriftRepairProcessor;
  prisma: PrismaService;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, cache: true }),
      PrismaModule,
      OrdersModule,
      OperationsModule,
    ],
  }).compile();

  return {
    ordersService: moduleRef.get(OrdersService),
    operationsService: moduleRef.get(OperationsService),
    driftRepairProcessor: moduleRef.get(DriftRepairProcessor),
    prisma: moduleRef.get(PrismaService),
    close: async () => {
      await moduleRef.close();
    },
  };
}

export async function cleanupAll(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.operationReadModel.deleteMany(),
    prisma.companyOrderTotals.deleteMany(),
    prisma.paymentOrder.deleteMany(),
    prisma.worker.deleteMany(),
    prisma.event.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

export function seedCompany(prisma: PrismaService, name: string) {
  return prisma.company.create({ data: { name } });
}

export async function seedWorkers(prisma: PrismaService, count: number, prefix = 'Worker') {
  await prisma.worker.createMany({
    data: Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${String(i + 1).padStart(3, '0')}` })),
  });
  return prisma.worker.findMany({ orderBy: { name: 'asc' } });
}

export async function seedEvents(prisma: PrismaService, count: number, prefix = 'Event') {
  const base = Date.UTC(2025, 0, 1, 10, 0, 0);
  await prisma.event.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      name: `${prefix} ${String(i + 1).padStart(3, '0')}`,
      startedAt: new Date(base + i * 86_400_000),
    })),
  });
  return prisma.event.findMany({ orderBy: { startedAt: 'asc' } });
}
