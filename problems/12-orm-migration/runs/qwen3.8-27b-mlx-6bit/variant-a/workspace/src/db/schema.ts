import { pgTable, text, varchar, bigint, integer, timestamp, index, sql } from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey().notNull(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  credit_limit_cents: bigint('credit_limit_cents').notNull().default(0),
  balance_cents: bigint('balance_cents').notNull().default(0),
  total_invoiced_cents: bigint('total_invoiced_cents').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`),
});

export const invoices = pgTable(
  'invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    account_id: varchar('account_id', { length: 36 }).notNull().references(() => accounts.id),
    status: text('status').$type<'draft' | 'sent' | 'paid' | 'void'>().notNull().default('draft'),
    subtotal_cents: bigint('subtotal_cents').notNull().default(0),
    tax_cents: bigint('tax_cents').notNull().default(0),
    total_cents: bigint('total_cents').notNull().default(0),
    due_date: timestamp('due_date', { withTimezone: true, mode: 'date' }),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`),
  },
  (table) => [
    index('invoices_account_id_idx').on(table.account_id),
  ],
);

export const lineItems = pgTable(
  'line_items',
  {
    id: varchar('id', { length: 36 }).primaryKey().notNull(),
    invoice_id: varchar('invoice_id', { length: 36 }).notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    unit_price_cents: bigint('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    line_total_cents: bigint('line_total_cents').notNull(),
  },
  (table) => [
    index('line_items_invoice_id_idx').on(table.invoice_id),
  ],
);

export type AccountRow = InferSelectModel<typeof accounts>;
export type InvoiceRow = InferSelectModel<typeof invoices>;
export type LineItemRow = InferSelectModel<typeof lineItems>;

export type InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] };

export type AccountInsert = InferInsertModel<typeof accounts>;
export type InvoiceInsert = InferInsertModel<typeof invoices>;
export type LineItemInsert = InferInsertModel<typeof lineItems>;
