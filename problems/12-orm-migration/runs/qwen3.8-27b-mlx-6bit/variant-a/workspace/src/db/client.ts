import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, lineItems } from './schema.js';

const schema = { accounts, invoices, lineItems };

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
