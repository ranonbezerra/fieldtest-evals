import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
