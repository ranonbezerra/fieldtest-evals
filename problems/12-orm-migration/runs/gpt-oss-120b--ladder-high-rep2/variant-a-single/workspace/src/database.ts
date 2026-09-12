import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, invoiceLineItems } from './db/schema.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, {
  schema: {
    accounts,
    invoices,
    invoiceLineItems,
  },
});
