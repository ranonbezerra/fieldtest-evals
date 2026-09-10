import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = path.resolve(here, '../../prisma/migrations/20240101000000_init/migration.sql');

// The test database is provisioned out-of-band: a Postgres reachable via
// DATABASE_URL (see .env.example). When it is absent the suites skip rather
// than fail.
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export function connect(): PrismaClient {
  return new PrismaClient();
}

// Drop everything and re-apply the shipped migration verbatim, so the tests
// run against exactly the DDL the migration deploys.
export async function resetSchema(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TABLE IF EXISTS ops_rows, company_totals, payment_orders, workers, events, companies CASCADE',
  );
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  for (const statement of sql.split(';\n')) {
    const trimmed = statement.trim();
    if (trimmed) await prisma.$executeRawUnsafe(trimmed);
  }
}

export async function resetData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE ops_rows, company_totals, payment_orders, workers, events, companies',
  );
}
