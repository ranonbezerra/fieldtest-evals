// Types and interfaces that replace the former Prisma definitions.
// All code in the service/repository imports from this module (or from
// ./prisma.ts which re‑exports these symbols for backward compatibility).

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

/**
 * Transaction‑only interface used by `BillingRepository.createInvoice`.
 * Mirrors the subset of methods required inside a transaction.
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

/**
 * Public client interface used by the repository.  It purposefully mimics the
 * Prisma client shape so that the existing test suite (which builds a fake
 * Prisma client) continues to work unchanged.
 */
export interface PrismaClient {
  account: {
    findUnique(a: { where: { id: string } }): Promise<AccountRow | null>;
    update(a: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow>;
  };
  invoice: {
    findUnique(a: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(a: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    create(a: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
    update(a: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    findMany(a: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
    createMany(a: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
