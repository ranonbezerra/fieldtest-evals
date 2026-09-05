import { pgTable, uuid, text, bigint, timestamp, index } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  balance_cents: bigint('balance_cents', { mode: 'string' }).notNull().default(0),
  total_invoiced_cents: bigint('total_invoiced_cents', { mode: 'string' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account_id: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoices_account_id_idx').on(table.account_id),
    index('invoices_status_idx').on(table.status),
  ],
);

export const line_items = pgTable(
  'line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoice_id: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('line_items_invoice_id_idx').on(table.invoice_id),
  ],
);
