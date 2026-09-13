import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { seed } from '../prisma/seed.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';

function fakePrisma(): PrismaClient {
  const invoices = seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') })) as InvoiceRow[];
  const items = seed.lineItems as LineItemRow[];
  const accounts = seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') })) as AccountRow[];

  return {
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
      async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) {
        const i = invoices.find((x) => x.id === where.id)!;
        Object.assign(i, data);
        return i;
      },
    },
    invoiceLineItem: {
      async findMany({ where }: { where: { invoiceId: string } }) {
        // insertion order, as the database returns it
        return items.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        items.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn(this as unknown as PrismaClient);
    },
  } as unknown as PrismaClient;
}

function service(): BillingService {
  return new BillingService(new BillingRepository(fakePrisma()));
}

describe('BillingService', () => {
  it('returns an invoice with its line items', async () => {
    const inv = await service().getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    expect(inv.number).toBe('INV-2024-0001');
    expect(inv.lineItems.length).toBe(3);
  });

  it('throws when the invoice does not exist', async () => {
    await expect(service().getInvoice('missing')).rejects.toThrow();
  });

  it('lists invoices for an account', async () => {
    const list = await service().listForAccount('11111111-1111-4111-8111-111111111111');
    expect(list.length).toBe(2);
  });

  it('returns an empty list for an account with no invoices', async () => {
    const list = await service().listForAccount('22222222-2222-4222-8222-222222222222');
    expect(list.length).toBe(0);
  });

  it('marks an invoice issued', async () => {
    const inv = await service().issue('aaaaaaaa-0000-4000-8000-000000000002');
    expect(inv.status).toBe('issued');
  });
});
