import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a PostgreSQL database in order to run the test suite.');
}

// Apply the committed migrations so the schema exists. The tests use unique
// random emails, so no destructive reset is needed.
execFileSync(join(rootDir, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
  cwd: rootDir,
  stdio: 'inherit',
});
