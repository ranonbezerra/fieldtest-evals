import { PGLite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/db/db.client.js';
import { accounts, invoices, invoiceLineItems } from '../src/db/db.schema.js';
import { seed } from './seed.js';

/**
 * Test database: a real in-process Postgres (Pglite, WASM) brought up by the
 * same migration SQL that production applies, so the suite exercises real
 * SQL, constraints and transactions with no external server and no
 * DATABASE_URL.
 *
 * The repository is typed against the production node-postgres client (`Db`).
 * Pglite's Drizzle client is structurally compatible for every query the
 * repository issues, so the single cast below is safe.
 */
export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

export async function openTestDb(): Promise<TestDb> {
  const pglite = new PGLite(':memory:');
  await pglite.ready;
  const rawDb = drizzlePglite(pglite);
  await migrate(rawDb, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  const db = rawDb as unknown as Db;
  await resetAndSeed(db);
  return {
    db,
    close: () => pglite.close(),
  };
}

/** Wipe and re-seed in the same order the seed file declares. */
export async function resetAndSeed(db: Db): Promise<void> {
  await db.delete(invoiceLineItems);
  await db.delete(invoices);
  await db.delete(accounts);

  for (const account of seed.accounts) {
    await db.insert(accounts).values({ ...account, createdAt: new Date('2024-01-01T00:00:00Z') });
  }
  for (const invoice of seed.invoices) {
    await db.insert(invoices).values({ ...invoice, createdAt: new Date('2024-04-01T00:00:00Z') });
  }
  // Inserted out of positional order on purpose: rows 3, 1, 2 -- the same
  // physical order the old fixture's fake client produced.
  for (const lineItem of seed.lineItems) {
    await db.insert(invoiceLineItems).values(lineItem);
  }
}
