import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Applies the shipped migration so the schema exists before any test
 * connects. Idempotent: already applied migrations are skipped.
 */
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to a PostgreSQL database used for tests.');
  }
  // ASSUMPTION: tests run against a dedicated test database; a published
  // methodology version left by unrelated data would change which version
  // `classify` treats as active and break the assertions.
  const cliEntry = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  if (existsSync(cliEntry)) {
    execFileSync(process.execPath, [cliEntry, 'migrate', 'deploy'], { stdio: 'inherit' });
  } else {
    execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  }
}
