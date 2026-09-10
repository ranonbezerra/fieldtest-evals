// Test bootstrap. Requires DATABASE_URL pointing at a throwaway Postgres
// database; the checked-in migration DDL is applied idempotently.
import 'reflect-metadata';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter';
import { PrismaService } from '../src/prisma/prisma.service';

// The scheduled drift-repair job must not fire mid-suite. DriftRepairJob
// reads this in onApplicationBootstrap, which runs in the specs' beforeAll,
// so setting it at module load is safe.
process.env.DRIFT_REPAIR_ENABLED = 'false';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Apply the checked-in migration DDL (fully idempotent) so specs can run against a fresh database. */
export async function ensureSchema(prisma: PrismaService): Promise<void> {
  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  const entries = (await readdir(migrationsDir)).filter((e) => e !== 'migration_lock.toml').sort();
  for (const entry of entries) {
    const sql = await readFile(join(migrationsDir, entry, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/;\r?\n/)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await prisma.$executeRawUnsafe(trimmed);
    }
  }
}

export async function resetTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE order_events, operations_read_model, company_totals, payment_orders, workers RESTART IDENTITY CASCADE',
  );
}
