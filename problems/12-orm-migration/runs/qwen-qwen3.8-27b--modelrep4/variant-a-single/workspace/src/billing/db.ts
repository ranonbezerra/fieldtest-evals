import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

// Configuration comes from the environment only.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must be set to run the billing service');
}

const client = postgres(url, { max: 10 });

/** Shared Drizzle client. Repositories take this (or a test double) via DI. */
export const db: Db = drizzle(client, { schema });
