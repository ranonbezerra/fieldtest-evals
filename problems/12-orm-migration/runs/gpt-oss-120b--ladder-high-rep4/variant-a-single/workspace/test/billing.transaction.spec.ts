import { describe, expect, it } from 'vitest';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';

function transactionalFakeClient(): PrismaClient {
  const invoices: InvoiceRow[] = [];
  const lineItems: LineItemRow[] = [];
  const accounts: AccountRow[] = [
    {
      id: 'account‑1',
      name: 'TestCo',
      currency: 'USD',
      invoiceCount: 0,
      createdAt: new Date(),
    },
  ];

  const client = {
    account: {
      async findUnique({ where }) {
        return accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where, data }) {
        const a = accounts.find((a) => a.id === where.id)!;
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
        const i = invoices.find((x) => x.id === where.id)!;
        Object.assign(i, data);
        return i;
      },
    },
    invoiceLineItem: {
      async findMany({ where }) {
        return lineItems.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }) {
        lineItems.push(...data);
        return { count: data.length };
      },
    },

    // Transaction implementation that rolls back on error.
    async $transaction(fn) {
      // Deep‑clone mutable state.
      const invoicesCopy = invoices.map((i) => ({ ...i }));
      const lineItemsCopy = lineItems.map((li) => ({ ...li }));
      const accountsCopy = accounts.map((a) => ({ ...a }));

      // Transaction client that operates on the clones.
      const tx: any = {
        account: {
          async update({ where, data }) {
            const a = accountsCopy.find((a) => a.id === where.id)!;
            a.invoiceCount += data.invoiceCount.increment;
            return a;
          },
        },
        invoice: {
          async create({ data }) {
            const row = { ...data, createdAt: new Date() } as InvoiceRow;
            invoicesCopy.push(row);
            return row;
          },
        },
        invoiceLineItem: {
          async createMany({ data }) {
            lineItemsCopy.push(...data);
            return { count: data.length };
          },
        },
      };

      try {
        const result = await fn(tx);
        // Commit: replace original data with the cloned, mutated versions.
        invoices.length = 0;
        invoices.push(...invoicesCopy);
        lineItems.length = 0;
        lineItems.push(...lineItemsCopy);
        accounts.length = 0;
        accounts.push(...accountsCopy);
        return result;
      } catch (e) {
        // Rollback: discard cloned changes.
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return client;
}

describe('BillingRepository – transaction atomicity', () => {
  it('rolls back when a failure occurs mid‑transaction', async () => {
    const client = transactionalFakeClient();

    // Force a failure in the account update step.
    const originalUpdate = client.account.update;
    (client.account.update as any) = async () => {
      const err = new Error('mid‑transaction failure') as any;
      err.code = 'P2025';
      throw err;
    };

    const repo = new BillingRepository(client);
    const input = {
      invoice: {
        id: 'inv‑fail',
        accountId: 'account‑1',
        number: 'INV‑FAIL',
        status: 'draft',
        totalMinor: 12345n,
        issuedAt: null,
      },
      lineItems: [
        {
          id: 'li‑fail',
          invoiceId: 'inv‑fail',
          position: 1,
          description: 'Test item',
          quantity: 1,
          unitPriceMinor: 12345n,
        },
      ],
    };

    await expect(repo.createInvoice(input)).rejects.toThrow();

    // Verify that nothing was persisted.
    const storedInv = await client.invoice.findUnique({ where: { id: 'inv‑fail' } });
    expect(storedInv).toBeNull();

    const storedItems = await client.invoiceLineItem.findMany({ where: { invoiceId: 'inv‑fail' } });
    expect(storedItems).toHaveLength(0);

    const account = await client.account.findUnique({ where: { id: 'account‑1' } });
    expect(account?.invoiceCount).toBe(0);
  });
});
