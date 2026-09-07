import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// Accounts table ------------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    invoiceCount: integer('invoice_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // No extra indexes required – primary key already indexed
  })
);

// Invoices table ------------------------------------------------------------
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    number: varchar('number', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index('invoice_account_idx').on(t.accountId),
  })
);

// Invoice line items table --------------------------------------------------
export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => ({
    invoiceIdx: index('line_item_invoice_idx').on(t.invoiceId),
  })
);
