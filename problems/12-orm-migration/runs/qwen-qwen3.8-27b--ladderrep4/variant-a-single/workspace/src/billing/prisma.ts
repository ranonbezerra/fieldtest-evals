/**
 * Data-access seam for the billing service.
 *
 * Kept at this historical path, and under the historical `PrismaClient`
 * name, because the existing suite (test/billing.spec.ts) imports these
 * types from here and must not be modified. Nothing in this file is
 * Prisma: it defines no Prisma types and imports no Prisma module. In
 * production the client is implemented by `DrizzleBillingClient`
 * (./drizzle-client.ts); in tests, by the suite's in-memory fake.
 */

export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  invoiceCount: number;
  createdAt: Date;
}

export interface InvoiceRow {
  id: string;
  accountId: string;
  number: string;
  status: string;
  totalMinor: bigint;
  issuedAt: Date | null;
  createdAt: Date;
}

export interface LineItemRow {
  id: string;
  invoiceId: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceMinor: bigint;
}

/** Write operations available inside a transaction. */
export interface BillingTx {
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

export interface PrismaClient extends BillingTx {
  account: BillingTx['account'] & {
    findUnique(a: { where: { id: string } }): Promise<AccountRow | null>;
  };
  invoice: BillingTx['invoice'] & {
    findUnique(a: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(a: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    /** Resolves to null when no row matched, so callers can return 404. */
    update(a: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow | null>;
  };
  invoiceLineItem: BillingTx['invoiceLineItem'] & {
    findMany(a: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
  };
  $transaction<T>(fn: (tx: BillingTx) => Promise<T>): Promise<T>;
}
