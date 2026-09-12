import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Drizzle replacement for prisma/schema.prisma. DDL ships in drizzle/0000_init.sql.
//
// Two value-level choices that keep the wire format byte-compatible with the
// Prisma client:
//   * bigint({ mode: 'bigint' }) — money stays a JS bigint, never a number.
//     The global serializer turns it into the decimal string the web client
//     parses (e.g. 9007199254740993n -> "9007199254740993").
//   * timestamp(..., { mode: 'date' }) — timestamptz comes back as a Date, so
//     the serializer still emits ISO strings (Drizzle's default is string mode).

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 6 })
    .notNull()
    .default(sql`now()`),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    number: text('number').notNull(),
    status: text('status').notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date', precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 6 })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('invoices_number_key').on(t.number),
    index('invoices_account_id_idx').on(t.accountId),
  ],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('invoice_line_items_invoice_id_idx').on(t.invoiceId)],
);

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;

export const schema = { accounts, invoices, invoiceLineItems };
