import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { CompanyTotalsService } from '../src/company-totals/company-totals.service.js';
import { EventsService } from '../src/events/events.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service.js';
import { ProjectionService } from '../src/projection/projection.service.js';
import { WorkersService } from '../src/workers/workers.service.js';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  paymentOrders: PaymentOrdersService;
  events: EventsService;
  workers: WorkersService;
  operations: OperationsService;
  companyTotals: CompanyTotalsService;
  projection: ProjectionService;
}

/**
 * Behaviour-level suite: it needs a real Postgres at DATABASE_URL, the same
 * variable the application itself uses.
 */
export async function createTestContext(): Promise<TestContext> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the read-model test suite');
  }
  process.env.DRIFT_REPAIR_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    prisma: moduleRef.get(PrismaService),
    paymentOrders: moduleRef.get(PaymentOrdersService),
    events: moduleRef.get(EventsService),
    workers: moduleRef.get(WorkersService),
    operations: moduleRef.get(OperationsService),
    companyTotals: moduleRef.get(CompanyTotalsService),
    projection: moduleRef.get(ProjectionService),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.companyTotals.deleteMany();
  await prisma.operationRead.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.worker.deleteMany();
}

export function newId(): string {
  return randomUUID();
}

export function toMap<K, V>(items: readonly V[], key: (item: V) => K): Map<K, V> {
  const map = new Map<K, V>();
  for (const item of items) map.set(key(item), item);
  return map;
}
