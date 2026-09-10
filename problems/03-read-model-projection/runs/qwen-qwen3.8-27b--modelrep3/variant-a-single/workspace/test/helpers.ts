// Test helpers. The specs need a live Postgres reachable via DATABASE_URL with
// the migrations applied (`pnpm prisma:migrate`).
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/common/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';
import { OrderWritesRepository } from '../src/operations/order-writes.repository.js';
import { OrderWritesService } from '../src/operations/order-writes.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { ProjectionMaintenanceRepository } from '../src/operations/projection-maintenance.repository.js';
import { ProjectionMaintenanceService } from '../src/operations/projection-maintenance.service.js';
import { RederivationRepository } from '../src/operations/rederivation.repository.js';
import { RederivationService } from '../src/operations/rederivation.service.js';

export interface TestContext {
  prisma: PrismaService;
  writes: OrderWritesService;
  ops: OperationsService;
  rederivation: RederivationService;
  driftRepair: DriftRepairService;
}

// The production module wires these the same way; constructing them directly
// keeps the tests focused on behaviour instead of Nest DI.
export function buildContext(prisma: PrismaService): TestContext {
  const maintenance = new ProjectionMaintenanceService(new ProjectionMaintenanceRepository());
  const writes = new OrderWritesService(new OrderWritesRepository(prisma), maintenance);
  const ops = new OperationsService(new OperationsRepository(prisma));
  const rederivationRepo = new RederivationRepository(prisma);
  const rederivation = new RederivationService(rederivationRepo);
  const driftRepair = new DriftRepairService(rederivation, rederivationRepo);
  return { prisma, writes, ops, rederivation, driftRepair };
}

export async function seedCompany(prisma: PrismaClient, name: string) {
  const company = await prisma.company.create({ data: { name } });
  const event = await prisma.event.create({
    data: { name: 'Launch Night', companyId: company.id, startsAt: new Date('2025-06-01T18:00:00.000Z') },
  });
  const worker = await prisma.worker.create({
    data: { name: 'Robin Field', companyId: company.id },
  });
  return { company, event, worker };
}

export async function cleanTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "operation_read_models", "company_operation_totals", "payment_orders", "events", "workers", "companies" RESTART IDENTITY CASCADE',
  );
}
