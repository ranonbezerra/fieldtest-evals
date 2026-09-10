import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Applies the Prisma migrations once, before any test file runs. Tracks
 * applied migrations in a marker table so re-runs are a no-op.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to a Postgres connection string to run the tests');
  }

  const client = new PrismaClient();
  try {
    await client.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS _schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const appliedRows = await client.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM _schema_migrations`);
    const applied = new Set(appliedRows.map((r) => r.name));

    const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
    for (const dir of readdirSync(migrationsDir).sort()) {
      if (applied.has(dir)) continue;
      const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
      // The migration DDL contains no semicolons inside string literals, so
      // statement splitting is safe.
      for (const statement of sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.$executeRawUnsafe(statement);
      }
      await client.$executeRawUnsafe(`INSERT INTO _schema_migrations (name) VALUES (${JSON.stringify(dir)})`);
    }
  } finally {
    await client.$disconnect();
  }
}
