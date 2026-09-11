import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle port of the removed prisma/schema.prisma. Table names, column names,
 * nullability, defaults and constraints are kept one-to-one with the Prisma
 * models. Money columns use `mode: 'bigint'` on purpose: they must surface as
 * JS bigint so the global serializer keeps shipping them as decimal strings.
 */
export const account = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
});

export const invoice = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    // ASSUMPTION: Prisma's default referential action for a required relation
    // is Restrict; Drizzle applies no Prisma defaults, so it is stated here.
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => [index('invoices_account_id_idx').on(table.accountId)],
);

export const invoiceLineItem = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade', onUpdate: 'restrict' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (table) => [index('invoice_line_items_invoice_id_idx').on(table.invoiceId)],
);

/** Schema map for drizzle's typed API. */
export const schema = { account, invoice, invoiceLineItem };

/** The Drizzle database handle the data layer is built on. */
export type BillingDb = PostgresJsDatabase<typeof schema>;
