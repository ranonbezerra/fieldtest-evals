import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Applies the Prisma migrations for DATABASE_URL (idempotent). Lets the test
 * suite run against a fresh database however it is invoked; `pnpm test`
 * performs the same step via its scripts.
 */
export function ensureMigrated(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at the PostgreSQL test database');
  }
  execFileSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
}
