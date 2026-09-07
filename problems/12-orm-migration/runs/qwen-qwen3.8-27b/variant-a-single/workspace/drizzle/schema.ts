import { pgTable, serial, text, timestamp, integer, bigint, doublePrecision, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const lineItems = pgTable('line_items', {
  id: serial('id').primaryKey(),
  invoice_id: integer('invoice_id').notNull(),
  description: text('description').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});
