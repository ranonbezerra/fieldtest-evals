import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Production driver. Configuration comes from the environment only.
 * The test suite uses an in-memory pglite engine instead (see test/billing.spec.ts).
 */
export function createDb(connectionString?: string): Db {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return drizzle(new Pool({ connectionString: url }), { schema });
}
