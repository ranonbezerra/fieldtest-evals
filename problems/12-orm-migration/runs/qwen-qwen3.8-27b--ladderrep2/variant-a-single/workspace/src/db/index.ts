import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema.js';

// Configuration comes from the environment only (project convention):
// DATABASE_URL points at Postgres. Nothing is hardcoded here.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Shared Drizzle database handle. Wire it up at the app entry point with
 * `new BillingRepository(new DrizzleBillingClient(db))`.
 */
export const db = drizzle(pool, { schema });
