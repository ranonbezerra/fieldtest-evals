import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

// Accounts table
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'timestamptz' }).notNull().defaultNow(),
});

// Invoices table
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    number: varchar('number', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { mode: 'timestamptz' }),
    createdAt: timestamp('created_at', { mode: 'timestamptz' }).notNull().defaultNow(),
  },
  (t) => ({
    numberIdx: unique('invoices_number_key').on(t.number),
    accountIdx: index('invoices_account_id_idx').on(t.accountId),
  }),
);

// Invoice line items table
export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => ({
    invoiceIdx: index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
  }),
);
