import {
  bigint,
  char,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of the former prisma/schema.prisma: same tables, columns,
 * and constraints, with the same snake_case mapping. The DDL in
 * drizzle/0000_initial.sql is what actually lands in Postgres.
 *
 * Column modes matter for byte-compatibility with the Prisma contract:
 *  - bigint with mode 'bigint'  -> JS bigint (what Prisma returned)
 *  - timestamp with mode 'date' -> JS Date (what Prisma returned)
 * Drizzle's default modes ('number' / 'string') would have silently changed
 * the serialized wire format.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, precision: 6, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('invoices_account_id_idx').on(t.accountId),
    foreignKey({ columns: [t.accountId], foreignColumns: [accounts.id] }),
  ],
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
  (t) => [
    index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;
