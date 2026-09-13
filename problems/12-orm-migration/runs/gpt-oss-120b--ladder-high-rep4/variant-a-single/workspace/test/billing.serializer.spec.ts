import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { seed } from '../prisma/seed.js';
import { serialize } from '../src/common/serializer.js';
import type { PrismaClient } from '../src/billing/prisma.js';

function fakePrisma(): PrismaClient {
  const invoices = seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') }));
  const items = seed.lineItems;
  const accounts = seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') }));

  return {
    account: {
      async findUnique({ where }) {
        return accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where }) {
        const a = accounts.find((x) => x.id === where.id)!;
        a.invoiceCount += 1;
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
        const row = { ...data, createdAt: new Date() };
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
        return items.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }) {
        items.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn) {
      return fn(this as unknown as PrismaClient);
    },
  } as unknown as PrismaClient;
}

describe('Serializer – BigInt handling', () => {
  it('converts bigint invoice amounts to strings', async () => {
    const service = new BillingService(new BillingRepository(fakePrisma()));
    const invoice = await service.getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    const serialized = serialize(invoice);
    expect(typeof serialized.totalMinor).toBe('string');
    // Ensure the string value matches the original bigint.
    expect(serialized.totalMinor).toBe(invoice.totalMinor.toString());
  });
});
