import { pgTable, text, varchar, bigint, integer, timestamp, index } from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  creditLimitCents: bigint('credit_limit_cents').$type<bigint>().notNull().default(0n),
  balanceCents: bigint('balance_cents').$type<bigint>().notNull().default(0n),
  totalInvoicedCents: bigint('total_invoiced_cents').$type<bigint>().notNull().default(0n),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    accountId: varchar('account_id', { length: 36 })
      .notNull()
      .references(() => accounts.id),
    status: text('status')
      .notNull()
      .default('draft')
      .check("status IN ('draft','sent','paid','void')"),
    subtotalCents: bigint('subtotal_cents').$type<bigint>().notNull().default(0n),
    taxCents: bigint('tax_cents').$type<bigint>().notNull().default(0n),
    totalCents: bigint('total_cents').$type<bigint>().notNull().default(0n),
    dueDate: timestamp('due_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invoices_account_id_idx').on(table.accountId)],
);

export const lineItems = pgTable(
  'line_items',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    unitPriceCents: bigint('unit_price_cents').$type<bigint>().notNull(),
    quantity: integer('quantity').notNull().check('quantity > 0'),
    lineTotalCents: bigint('line_total_cents').$type<bigint>().notNull(),
  },
  (table) => [index('line_items_invoice_id_idx').on(table.invoiceId)],
);

export type AccountRow = InferSelectModel<typeof accounts>;
export type InvoiceRow = InferSelectModel<typeof invoices>;
export type LineItemRow = InferSelectModel<typeof lineItems>;

export type AccountInsert = InferInsertModel<typeof accounts>;
export type InvoiceInsert = InferInsertModel<typeof invoices>;
export type LineItemInsert = InferInsertModel<typeof lineItems>;

export type InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] };
