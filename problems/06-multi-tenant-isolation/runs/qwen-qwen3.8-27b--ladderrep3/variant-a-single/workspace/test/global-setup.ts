import { execFileSync } from 'node:child_process';

/**
 * Runs once, before any test file: verifies DATABASE_URL, generates the
 * Prisma client and applies the schema migrations so every spec file starts
 * against a fully provisioned database.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set to a test PostgreSQL instance, e.g. ' +
        'postgresql://postgres:postgres@localhost:5432/operator_platform_test',
    );
  }
  execFileSync('npx', ['--no-install', 'prisma', 'generate'], { stdio: 'inherit' });
  execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
