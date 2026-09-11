import type { AccountRow, InvoiceRow, LineItemRow } from './rows.js';

/**
 * The transactional subset of the data client: what a $transaction callback
 * receives. Kept structurally identical to the interface the old data client
 * exposed, so the existing (unmodifiable) test suite's in-memory fake remains
 * a valid implementation.
 */
export interface Tx {
  invoice: {
    create(a: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    createMany(a: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  account: {
    update(a: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow>;
  };
}

export interface BillingClient extends Tx {
  account: Tx['account'] & {
    findUnique(a: { where: { id: string } }): Promise<AccountRow | null>;
  };
  invoice: Tx['invoice'] & {
    findUnique(a: {
      where: { id: string };
      include?: { lineItems: boolean };
    }): Promise<(InvoiceRow & { lineItems?: LineItemRow[] }) | null>;
    findMany(a: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    update(a: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: Tx['invoiceLineItem'] & {
    findMany(a: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
  };
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
