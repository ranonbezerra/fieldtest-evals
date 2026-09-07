import { execFileSync } from 'node:child_process';

/**
 * Vitest global setup: make sure the database schema matches the migrations
 * before any test file opens a connection. Non-destructive and idempotent.
 */
export default function setup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to run the test suite (PostgreSQL required).');
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}
