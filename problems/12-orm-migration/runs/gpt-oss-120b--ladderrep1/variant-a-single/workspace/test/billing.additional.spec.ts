import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type {
  AccountRow,
  InvoiceRow,
  LineItemRow,
  PrismaClient,
} from '../src/billing/prisma.js';
import { NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';

/**
 * Helper: creates a fresh fake Prisma client that mimics the behavior of the
 * in‑memory store used by the original tests.
 */
function makeFakePrisma(): {
  prisma: PrismaClient;
  state: {
    accounts: AccountRow[];
    invoices: InvoiceRow[];
    items: LineItemRow[];
  };
} {
  const invoices = [] as InvoiceRow[];
  const items = [] as LineItemRow[];
  const accounts = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Northwind',
      currency: 'EUR',
      invoiceCount: 2,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
  ] as AccountRow[];

  const prisma: PrismaClient = {
    account: {
      async findUnique({ where }: { where: { id: string } }) {
        return accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where }: { where: { id: string } }) {
        const a = accounts.find((x) => x.id === where.id)!;
        a.invoiceCount += 1;
        return a;
      },
    },
    invoice: {
      async findUnique({ where }: { where: { id: string } }) {
        return invoices.find((i) => i.id === where.id) ?? null;
      },
      async findMany({ where }: { where: { accountId: string } }) {
        return invoices.filter((i) => i.accountId === where.accountId);
      },
      async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) {
        const row = { ...data, createdAt: new Date() } as InvoiceRow;
        invoices.push(row);
        return row;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<InvoiceRow>;
      }) {
        const inv = invoices.find((i) => i.id === where.id);
        if (!inv) {
          // Simulate Prisma's "record not found" error code.
          const err: any = new Error('Record not found');
          err.code = 'P2025';
          throw err;
        }
        Object.assign(inv, data);
        return inv;
      },
    },
    invoiceLineItem: {
      async findMany({ where }: { where: { invoiceId: string } }) {
        // Return in insertion order (as the DB would)
        return items.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        items.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn: (tx: any) => Promise<any>) {
      // Simple copy‑on‑write transaction simulation.
      const invoicesCopy = [...invoices];
      const itemsCopy = [...items];
      const accountsCopy = accounts.map((a) => ({ ...a }));
      const tx: PrismaClient = {
        // The transaction client works on the copies.
        account: {
          async findUnique(arg) {
            return accountsCopy.find((a) => a.id === arg.where.id) ?? null;
          },
          async update(arg) {
            const a = accountsCopy.find((x) => x.id === arg.where.id)!;
            a.invoiceCount += 1;
            return a;
          },
        },
        invoice: {
          async findUnique(arg) {
            return invoicesCopy.find((i) => i.id === arg.where.id) ?? null;
          },
          async create(arg) {
            const row = { ...arg.data, createdAt: new Date() } as InvoiceRow;
            invoicesCopy.push(row);
            return row;
          },
          async update(arg) {
            const inv = invoicesCopy.find((i) => i.id === arg.where.id);
            if (!inv) {
              const err: any = new Error('Record not found');
              err.code = 'P2025';
              throw err;
            }
            Object.assign(inv, arg.data);
            return inv;
          },
        },
        invoiceLineItem: {
          async findMany(arg) {
            return itemsCopy.filter((li) => li.invoiceId === arg.where.invoiceId);
          },
          async createMany(arg) {
            // Simulate a failure that occurs after the invoice row is created.
            if (arg.data.some((d) => d.description === 'FAIL')) {
              const err: any = new Error('Mid‑transaction failure');
              err.code = 'FAIL';
              throw err;
            }
            itemsCopy.push(...arg.data);
            return { count: arg.data.length };
          },
        },
        async $transaction(inner) {
          return inner(this);
        },
      } as any;

      try {
        const result = await fn(tx);
        // Commit: replace originals with copies.
        invoices.length = 0;
        invoices.push(...invoicesCopy);
        items.length = 0;
        items.push(...itemsCopy);
        accounts.length = 0;
        accounts.push(...accountsCopy);
        return result;
      } catch (e) {
        // Rollback: discard copies.
        throw e;
      }
    },
  } as unknown as PrismaClient;

  return { prisma, state: { accounts, invoices, items } };
}

/**
 * Helper: a fake client that throws a Prisma‑like not‑found error when
 * attempting to update a missing invoice.
 */
function makeFakePrismaMissingInvoice(): PrismaClient {
  const base = makeFakePrisma().prisma;
  // Override only the invoice.update method to always fail.
  base.invoice.update = async () => {
    const err: any = new Error('Record not found');
    err.code = 'P2025';
    throw err;
  };
  return base;
}

/**
 * Helper: a fake client that simulates a failure after the invoice row is
 * inserted but before line items are persisted.
 */
function makeFakePrismaMidFailure(): PrismaClient {
  const { prisma } = makeFakePrisma();
  // Inject a line‑item whose description triggers a forced error.
  const originalCreateMany = prisma.invoiceLineItem.createMany.bind(prisma.invoiceLineItem);
  prisma.invoiceLineItem.createMany = async (arg) => {
    if (arg.data.some((d) => d.description === 'FAIL')) {
      const err: any = new Error('Mid‑transaction failure');
      err.code = 'FAIL';
      throw err;
    }
    return originalCreateMany(arg);
  };
  return prisma;
}

describe('Extended Billing Behaviour', () => {
  it('returns an empty list for a non‑existent account', async () => {
    const { prisma } = makeFakePrisma();
    const service = new BillingService(new BillingRepository(prisma));
    const list = await service.listForAccount('non‑existent-id');
    expect(list).toEqual([]);
  });

  it('throws NotFoundError when issuing a missing invoice', async () => {
    const prisma = makeFakePrismaMissingInvoice();
    const service = new BillingService(new BillingRepository(prisma));
    await expect(service.issue('missing-id')).rejects.toThrow(NotFoundError);
    await expect(service.issue('missing-id')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('orders line items by position', async () => {
    const { prisma } = makeFakePrisma();
    // Insert an invoice with out‑of‑order line items.
    await prisma.invoice.create({
      data: {
        id: 'inv-order-test',
        accountId: '11111111-1111-4111-8111-111111111111',
        number: 'INV-ORDER',
        status: 'draft',
        totalMinor: 1000n,
        issuedAt: null,
      },
    });
    await prisma.invoiceLineItem.createMany({
      data: [
        {
          id: 'li-2',
          invoiceId: 'inv-order-test',
          position: 2,
          description: 'Second',
          quantity: 1,
          unitPriceMinor: 500n,
        },
        {
          id: 'li-1',
          invoiceId: 'inv-order-test',
          position: 1,
          description: 'First',
          quantity: 1,
          unitPriceMinor: 500n,
        },
      ],
    });

    const service = new BillingService(new BillingRepository(prisma));
    const invoice = await service.getInvoice('inv-order-test');
    expect(invoice.lineItems.map((li) => li.description)).toEqual(['First', 'Second']);
  });

  it('serialises bigint fields as strings', async () => {
    const { prisma } = makeFakePrisma();
    // Use the seed invoice that contains a BigInt beyond Number.MAX_SAFE_INTEGER.
    const service = new BillingService(new BillingRepository(prisma));
    const inv = await service.getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    const ser = serialize(inv);
    expect(typeof ser.totalMinor).toBe('string');
    expect(ser.totalMinor).toBe('9007199254740993');
  });

  it('createInvoice is atomic on mid‑transaction failure', async () => {
    const { prisma, state } = makeFakePrisma();
    const repo = new BillingRepository(prisma);
    // Prepare input where the line‑item triggers the forced failure.
    const input = {
      invoice: {
        id: 'inv-fail',
        accountId: '11111111-1111-4111-8111-111111111111',
        number: 'INV-FAIL',
        status: 'draft',
        totalMinor: 123n,
        issuedAt: null,
      },
      lineItems: [
        {
          id: 'li-fail',
          invoiceId: 'inv-fail',
          position: 1,
          description: 'FAIL', // will cause createMany to throw.
          quantity: 1,
          unitPriceMinor: 123n,
        },
      ],
    };

    await expect(repo.createInvoice(input)).rejects.toThrow();

    // No invoice row should have been persisted.
    expect(state.invoices.find((i) => i.id === 'inv-fail')).toBeUndefined();
    // Account's invoiceCount must remain unchanged.
    const account = state.accounts.find((a) => a.id === '11111111-1111-4111-8111-111111111111')!;
    expect(account.invoiceCount).toBe(0);
  });
});
