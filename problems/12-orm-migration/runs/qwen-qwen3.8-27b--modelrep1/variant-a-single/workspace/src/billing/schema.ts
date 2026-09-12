// Drizzle recreation of prisma/schema.prisma. Table, column and constraint
// names match the original DDL (snake_case via the column-name argument).

import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    // Required relation: Prisma's default is ON DELETE RESTRICT ON UPDATE CASCADE.
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    // mode 'bigint' is deliberate: Prisma returned JS bigint for @db.BigInt and
    // the serializer ships money as decimal strings. The default mode 'number'
    // would silently round amounts past Number.MAX_SAFE_INTEGER.
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
    // onDelete: Cascade — explicit in the Prisma schema.
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('invoice_line_items_invoice_id_idx').on(t.invoiceId)],
);

// Row shapes the service/repository expose (camelCase, like the old Prisma rows).
export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;
