import 'reflect-metadata';
import { PrismaService } from '../src/common/prisma.service.js';
import { EventRepository } from '../src/events/events.repository.js';
import { EventService } from '../src/events/events.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OrderRepository } from '../src/orders/orders.repository.js';
import { OrderService } from '../src/orders/orders.service.js';
import { ProjectionRepository } from '../src/projection/projection.repository.js';
import { ProjectionService } from '../src/projection/projection.service.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the test suite (point it at the test database).');
}

/** One shared client for the whole test run; specs run sequentially. */
export const prisma = new PrismaService();

export interface TestServices {
  orderService: OrderService;
  eventService: EventService;
  operationsService: OperationsService;
  projectionService: ProjectionService;
}

export function buildServices(): TestServices {
  const projectionRepository = new ProjectionRepository(prisma);
  return {
    orderService: new OrderService(new OrderRepository(prisma, projectionRepository)),
    eventService: new EventService(new EventRepository(prisma, projectionRepository)),
    operationsService: new OperationsService(new OperationsRepository(prisma)),
    projectionService: new ProjectionService(projectionRepository),
  };
}

export async function cleanup(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE op_operations, company_totals, payment_orders, events, workers, companies RESTART IDENTITY CASCADE',
  );
}

export async function seedCompany(): Promise<{ companyId: string; workerId: string; workerName: string }> {
  const company = await prisma.company.create({ data: { name: `Co ${Date.now()}` } });
  const worker = await prisma.worker.create({ data: { companyId: company.id, name: 'Rana Bezerra' } });
  return { companyId: company.id, workerId: worker.id, workerName: worker.name };
}

/** A window that safely contains "now" (when the test writes happen). */
export function recentWindow(): { from: Date; to: Date } {
  const now = Date.now();
  return { from: new Date(now - 3_600_000), to: new Date(now + 3_600_000) };
}

/** Business fields of the projection (wall-clock updated_at excluded). */
export async function snapshotProjection(): Promise<unknown> {
  const operations = await prisma.operationsReadModel.findMany({ orderBy: { id: 'asc' } });
  return {
    operations: operations.map(({ updatedAt: _updatedAt, ...rest }) => ({
      ...rest,
      amount: rest.amount.toString(),
    })),
  };
}
