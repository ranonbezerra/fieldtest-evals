import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle translation of the former Prisma schema (prisma/schema.prisma).
 * Same tables, columns, constraints and index names. Prisma's camelCase
 * model fields are kept as the JS property names, so row shapes -- and with
 * them the public API -- are unchanged.
 */

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => [index('invoices_account_id_idx').on(table.accountId)],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (table) => [index('invoice_line_items_invoice_id_idx').on(table.invoiceId)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;
