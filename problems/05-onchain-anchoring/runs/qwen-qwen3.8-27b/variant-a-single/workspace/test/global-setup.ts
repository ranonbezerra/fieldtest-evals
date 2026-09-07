import { execFileSync } from 'node:child_process';

/**
 * Runs once, in the main process, before any test file is imported. The app
 * modules import the generated Prisma client at load time, so the client must
 * be generated and the schema migrated before that happens.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL instance to run the test suite.');
  }
  execFileSync('pnpm', ['exec', 'prisma', 'generate'], { stdio: 'inherit' });
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
