// Trimmed to what this service uses, so the fixture typechecks without the
// generated client. The real client is `@prisma/client`.
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

export interface PrismaClient extends Tx {
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
