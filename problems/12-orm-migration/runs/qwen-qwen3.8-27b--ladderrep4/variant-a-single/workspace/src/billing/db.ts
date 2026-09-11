import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DrizzleBillingClient, type BillingDb } from './drizzle-client.js';
import type { PrismaClient } from './prisma.js';
import * as schema from './schema.js';

/**
 * Production wiring. Configuration comes from the environment only:
 * DATABASE_URL points at the Postgres instance.
 */
export function createBillingDb(): BillingDb {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url), { schema });
}

export function createBillingClient(): PrismaClient {
  return new DrizzleBillingClient(createBillingDb());
}
