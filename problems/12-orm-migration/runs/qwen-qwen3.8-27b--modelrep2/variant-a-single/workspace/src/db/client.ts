import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

declare const process: { env: Record<string, string | undefined> };

// Configuration comes from the environment only: the connection string is
// read from DATABASE_URL. postgres() is lazy, so importing this module never
// opens a connection.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const db = drizzle(postgres(connectionString), { schema });
