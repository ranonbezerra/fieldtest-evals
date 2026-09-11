import pg from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DrizzleBillingStore } from './drizzle-store.js';
import { schema, type BillingDb } from './schema.js';

// ASSUMPTION: the fixture ships no bootstrap (no main.ts), so no file in the
// repo reads process.env; the host passes process.env.DATABASE_URL in here.
// That keeps the only configuration source an environment variable, as required.

/** Builds the typed Drizzle database handle for a Postgres connection string. */
export function connectBillingDb(dsn: string): BillingDb {
  return drizzle(pg(dsn), { schema });
}

/** Production wiring: the Drizzle-backed implementation of the billing store. */
export function createBillingStore(dsn: string): DrizzleBillingStore {
  if (!dsn) {
    throw new Error('A Postgres connection string (DATABASE_URL) is required');
  }
  return new DrizzleBillingStore(connectBillingDb(dsn));
}
