import { pgTable, uuid, varchar, text, integer, bigint, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// accounts
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// invoices
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  status: text('status').notNull().default('draft'),
  totalMinor: bigint('total_minor').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  numberUnique: uniqueIndex('invoices_number_key').on(table.number),
  accountIdx: index('invoices_account_id_idx').on(table.accountId),
}));

// invoice line items
export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceMinor: bigint('unit_price_minor').notNull(),
}, (table) => ({
  invoiceIdx: index('invoice_line_items_invoice_id_idx').on(table.invoiceId),
}));
