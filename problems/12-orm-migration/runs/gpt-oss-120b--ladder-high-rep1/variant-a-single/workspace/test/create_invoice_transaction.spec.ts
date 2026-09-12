import { describe, expect, it } from 'vitest';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';
import { seed } from '../prisma/seed.js';

function createFakeClient(failOnCreateMany: boolean): PrismaClient {
  const accounts = seed.accounts.map((a) => ({
    ...a,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  })) as AccountRow[];
  const invoices: InvoiceRow[] = [];
  const lineItems: LineItemRow[] = [];

  const client: any = {
    account: {
      async findUnique({ where }) {
        return accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where, data }) {
        const a = accounts.find((x) => x.id === where.id)!;
        a.invoiceCount += data.invoiceCount.increment;
        return a;
      },
    },
    invoice: {
      async findUnique({ where }) {
        return invoices.find((i) => i.id === where.id) ?? null;
      },
      async findMany({ where }) {
        return invoices.filter((i) => i.accountId === where.accountId);
      },
      async create({ data }) {
        const row = { ...data, createdAt: new Date() } as InvoiceRow;
        invoices.push(row);
        return row;
      },
      async update({ where, data }) {
        const inv = invoices.find((i) => i.id === where.id);
        if (!inv) {
          const err: any = new Error('Not found');
          err.code = 'P2025';
          throw err;
        }
        Object.assign(inv, data);
        return inv;
      },
    },
    invoiceLineItem: {
      async findMany({ where }) {
        return lineItems.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }) {
        if (failOnCreateMany) {
          throw new Error('Injected failure');
        }
        lineItems.push(...data);
        return { count: data.length };
      },
    },
    async $transaction<T>(fn: (tx: any) => Promise<T>) {
      // Snapshot state for rollback
      const accountsCopy = accounts.map((a) => ({ ...a }));
      const invoicesCopy = invoices.map((i) => ({ ...i }));
      const lineItemsCopy = lineItems.map((li) => ({ ...li }));
      try {
        const result = await fn(client);
        return result;
      } catch (e) {
        // Roll back changes
        accounts.length = 0;
        accounts.push(...accountsCopy);
        invoices.length = 0;
        invoices.push(...invoicesCopy);
        lineItems.length = 0;
        lineItems.push(...lineItemsCopy);
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return client;
}

describe('BillingRepository.createInvoice transaction atomicity', () => {
  it('rolls back all changes if a failure occurs mid-transaction', async () => {
    const client = createFakeClient(true); // fail during line items creation
    const repo = new BillingRepository(client);
    const accountId = seed.accounts[0].id;
    const input = {
      invoice: {
        id: 'new-invoice-id',
        accountId,
        number: 'INV-2024-9999',
        status: 'draft',
        totalMinor: 1000n,
        issuedAt: null,
      } as Omit<InvoiceRow, 'createdAt'>,
      lineItems: [
        {
          id: 'new-line-item-1',
          invoiceId: 'new-invoice-id',
          position: 1,
          description: 'Test item',
          quantity: 1,
          unitPriceMinor: 1000n,
        },
      ] as LineItemRow[],
    };

    await expect(repo.createInvoice(input)).rejects.toThrow();

    // Verify nothing was persisted
    const storedInvoices = await client.invoice.findMany({ where: { accountId } });
    expect(storedInvoices).toHaveLength(0);
    const account = await client.account.findUnique({ where: { id: accountId } });
    // invoiceCount should be unchanged (seed value)
    const originalCount = seed.accounts.find((a) => a.id === accountId)!.invoiceCount;
    expect(account?.invoiceCount).toBe(originalCount);
  });
});
