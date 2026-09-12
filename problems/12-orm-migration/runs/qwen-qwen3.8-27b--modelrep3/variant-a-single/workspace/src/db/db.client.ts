import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db.schema.js';

/**
 * Runtime database wiring. The connection string comes from the environment
 * only (DATABASE_URL); nothing is hardcoded.
 */
export function createPool(connectionString: string = process.env.DATABASE_URL ?? ''): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set');
  }
  return new Pool({ connectionString });
}

/** Drizzle client over the production node-postgres driver. */
export function createDb(pool: Pool) {
  return drizzleNodePg(pool, { schema });
}

/** The client type the repository is built against. */
export type Db = ReturnType<typeof createDb>;
