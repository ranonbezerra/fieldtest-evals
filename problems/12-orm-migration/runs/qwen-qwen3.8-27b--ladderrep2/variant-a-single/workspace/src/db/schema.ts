import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Recreated from prisma/schema.prisma (deleted): same tables, columns and
// constraints. Snake_case database columns keep the camelCase property names the
// service has always used, so row shapes are unchanged.

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  // Prisma declared @db.Char(3) — fixed width, NOT varchar. Keep it exactly.
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().default(sql`now()`),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    // Deliberate: Drizzle returns pg bigint as a *string* by default. The contract
    // is bigint in memory, decimal string on the wire (MIGRATION_NOTES.md §1).
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().default(sql`now()`),
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

export const schema = { accounts, invoices, invoiceLineItems };

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;
