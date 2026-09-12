import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Applies the shipped Prisma migrations to the DATABASE_URL database
 * (idempotent). Without this, a fresh test database would not have the schema
 * the suite asserts against.
 */
export function ensureDatabaseSchema(): void {
  const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  try {
    execSync(`node ${prismaCli} migrate deploy`, { stdio: 'pipe', timeout: 120_000 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not apply Prisma migrations. Ensure DATABASE_URL is set and reachable: ${detail}`);
  }
}
