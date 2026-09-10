import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';

export interface TestApp {
  moduleRef: TestingModule;
  prisma: PrismaService;
  close(): Promise<void>;
}

/**
 * Builds the real application (real Nest wiring, real Postgres via DATABASE_URL).
 * The scheduled drift-repair job is stubbed out so tests control every projection mutation.
 */
export async function createTestApp(): Promise<TestApp> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to a PostgreSQL database with the migrations applied');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DriftRepairService)
    .useValue({ run: () => { throw new Error('the scheduled drift repair is disabled in tests'); } })
    .compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  return {
    moduleRef,
    prisma,
    close: async () => {
      await moduleRef.close();
    },
  };
}

export interface CompanySeed {
  companyId: string;
  workerId: string;
  workerName: string;
  otherWorkerId: string;
  otherWorkerName: string;
}

/** A fresh company with two workers, so each test is isolated from every other test. */
export async function seedCompany(prisma: PrismaClient, label: string): Promise<CompanySeed> {
  const company = await prisma.company.create({ data: { name: `${label}-${randomUUID()}` } });
  const worker = await prisma.worker.create({
    data: { name: `${label} worker A ${randomUUID().slice(0, 8)}`, companyId: company.id },
  });
  const otherWorker = await prisma.worker.create({
    data: { name: `${label} worker B ${randomUUID().slice(0, 8)}`, companyId: company.id },
  });
  return {
    companyId: company.id,
    workerId: worker.id,
    workerName: worker.name,
    otherWorkerId: otherWorker.id,
    otherWorkerName: otherWorker.name,
  };
}

export function windowAroundNow(): { from: Date; to: Date } {
  return { from: new Date(Date.now() - 5 * 60_000), to: new Date(Date.now() + 5 * 60_000) };
}

export async function snapshotOperationRows(prisma: PrismaClient, companyId: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.operationRow.findMany({ where: { companyId }, orderBy: { paymentOrderId: 'asc' } });
  return rows.map((row) => ({
    paymentOrderId: row.paymentOrderId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
