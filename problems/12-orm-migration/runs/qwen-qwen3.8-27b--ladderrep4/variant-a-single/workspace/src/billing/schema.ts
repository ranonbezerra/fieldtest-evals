import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle source of truth for the billing schema (formerly
 * prisma/schema.prisma). Columns are snake_case in the database and
 * camelCase in TypeScript.
 *
 * Money columns use `{ mode: 'bigint' }` on purpose: Drizzle's default
 * bigint mode is 'number', which would silently lose precision (the seed
 * carries 9007199254740993n, past Number.MAX_SAFE_INTEGER) and would make
 * the global serializer emit a JSON number instead of a decimal string.
 * See MIGRATION_NOTES.md.
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
  (t) => [index('invoices_account_id_idx').on(t.accountId)],
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
  (t) => [index('invoice_line_items_invoice_id_idx').on(t.invoiceId)],
);
