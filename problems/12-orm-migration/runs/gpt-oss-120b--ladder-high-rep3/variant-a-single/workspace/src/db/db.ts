import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

let dbInstance: any;

/**
 * Initialise the Drizzle client on first use.
 * In test environments the client is overridden via `setDbInstance`.
 */
export function initDb() {
  if (!dbInstance) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL!,
    });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

/**
 * Override the global DB instance – used by the test suite to inject an
 * in‑memory PostgreSQL database (pg‑mem).
 */
export function setDbInstance(instance: any) {
  dbInstance = instance;
}
