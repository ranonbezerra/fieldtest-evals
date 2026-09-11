import type { account, invoice, invoiceLineItem } from './schema.js';

/**
 * The data-access contract for the billing layer. The repository depends on
 * this interface, never on an ORM. The production implementation is
 * DrizzleBillingStore (drizzle-store.ts); the untouchable original suite
 * (test/billing.spec.ts) injects its own in-memory object of the same shape,
 * so the shape is pinned by that suite.
 *
 * Row types are inferred from the Drizzle schema, so a column drift breaks
 * typechecking instead of silently changing the wire.
 */
export type AccountRow = typeof account.$inferSelect;
export type InvoiceRow = typeof invoice.$inferSelect;
export type LineItemRow = typeof invoiceLineItem.$inferSelect;

export interface BillingStore {
  account: {
    /** Returns null when the account does not exist. Callers branch on that. */
    findUnique(args: { where: { id: string } }): Promise<AccountRow | null>;
    update(args: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow>;
  };
  invoice: {
    /** Returns null when the invoice does not exist. Callers branch on that. */
    findUnique(args: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(args: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    create(args: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
    update(args: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    findMany(args: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
    createMany(args: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  /**
   * Runs fn atomically: if fn throws, nothing fn wrote is visible. fn receives
   * a handle of the same shape, bound to the transaction.
   */
  $transaction<T>(fn: (tx: BillingStore) => Promise<T>): Promise<T>;
}
