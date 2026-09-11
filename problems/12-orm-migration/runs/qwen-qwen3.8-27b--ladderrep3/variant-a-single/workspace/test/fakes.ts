import type { BillingClient, Tx } from '../src/billing/client.js';
import type { AccountRow, InvoiceRow, LineItemRow } from '../src/billing/rows.js';
import { RowNotFoundError } from '../src/common/errors.js';
import { seed } from '../prisma/seed.js';

export interface FakeClientOptions {
  /** Fail the named step inside $transaction to simulate a database error. */
  failAt?: 'lineItems' | 'account';
}

export interface FakeClient extends BillingClient {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
}

/**
 * In-memory client with the observable semantics of the Drizzle client:
 * findUnique returns null (no throw) for a missing row, update on a missing
 * row raises RowNotFoundError (the zero-row-update case Drizzle must surface),
 * and $transaction rolls the store back on error.
 */
export function makeFakeClient(options: FakeClientOptions = {}): FakeClient {
  const accounts: AccountRow[] = seed.accounts.map((a) => ({
    ...a,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  }));
  const invoices: InvoiceRow[] = seed.invoices.map((i) => ({
    ...i,
    createdAt: new Date('2024-04-01T00:00:00Z'),
  }));
  const lineItems: LineItemRow[] = seed.lineItems.map((li) => ({ ...li }));

  const createInvoice = async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> => {
    const row: InvoiceRow = { ...data, createdAt: new Date() };
    invoices.push(row);
    return row;
  };

  const createLineItems = async ({ data }: { data: LineItemRow[] }): Promise<{ count: number }> => {
    lineItems.push(...data);
    return { count: data.length };
  };

  const updateAccount = async ({
    where,
    data,
  }: {
    where: { id: string };
    data: { invoiceCount: { increment: number } };
  }): Promise<AccountRow> => {
    const a = accounts.find((x) => x.id === where.id);
    if (!a) throw new RowNotFoundError('account');
    a.invoiceCount += data.invoiceCount.increment;
    return a;
  };

  const updateInvoice = async ({
    where,
    data,
  }: {
    where: { id: string };
    data: Partial<InvoiceRow>;
  }): Promise<InvoiceRow> => {
    const i = invoices.find((x) => x.id === where.id);
    if (!i) throw new RowNotFoundError('invoice');
    Object.assign(i, data);
    return i;
  };

  const tx: Tx = {
    invoice: { create: createInvoice },
    invoiceLineItem: {
      createMany: async (a) => {
        if (options.failAt === 'lineItems') throw new Error('simulated failure: line-item insert');
        return createLineItems(a);
      },
    },
    account: {
      update: async (a) => {
        if (options.failAt === 'account') throw new Error('simulated failure: account counter update');
        return updateAccount(a);
      },
    },
  };

  return {
    accounts,
    invoices,
    lineItems,
    account: {
      findUnique: async ({ where }) => accounts.find((a) => a.id === where.id) ?? null,
      update: updateAccount,
    },
    invoice: {
      findUnique: async ({ where }) => invoices.find((i) => i.id === where.id) ?? null,
      findMany: async ({ where }) => invoices.filter((i) => i.accountId === where.accountId),
      create: createInvoice,
      update: updateInvoice,
    },
    invoiceLineItem: {
      findMany: async ({ where }) => lineItems.filter((li) => li.invoiceId === where.invoiceId),
      createMany: createLineItems,
    },
    $transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const before = {
        accounts: accounts.map((a) => ({ ...a })),
        invoices: invoices.map((i) => ({ ...i })),
        lineItems: lineItems.map((li) => ({ ...li })),
      };
      try {
        return await fn(tx);
      } catch (e) {
        accounts.splice(0, accounts.length, ...before.accounts);
        invoices.splice(0, invoices.length, ...before.invoices);
        lineItems.splice(0, lineItems.length, ...before.lineItems);
        throw e;
      }
    },
  };
}
