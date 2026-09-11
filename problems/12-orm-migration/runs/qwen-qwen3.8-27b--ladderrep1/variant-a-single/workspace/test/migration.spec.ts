import { describe, expect, it } from 'vitest';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import { RowNotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { seed } from '../prisma/seed.js';
import type { AccountRow, BillingStore, InvoiceRow, LineItemRow } from '../src/billing/billing-store.js';

/**
 * New suite pinning behaviour the original (unmodified) suite never asserted.
 *
 * The fake below stands in for the data layer with the semantics the Drizzle
 * store implements against Postgres:
 *  - reads return rows in storage (insertion) order -- there is no hidden
 *    ORDER BY anywhere in the port
 *  - a unique violation surfaces with the Postgres SQLSTATE code 23505
 *  - an update matching nothing throws RowNotFoundError (the old P2025 case)
 *  - $transaction snapshots the tables and restores them when the callback
 *    throws, so a mid-transaction failure rolls back exactly what was written
 *    inside the transaction (and only that: a write done outside the
 *    transaction would survive the rollback and be caught by these tests)
 */

type FailurePoint = 'lineItems' | 'account';

interface FakeState {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
}

function freshState(): FakeState {
  return {
    accounts: seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') })),
    invoices: seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') })),
    lineItems: seed.lineItems.map((li) => ({ ...li })),
  };
}

function fakeStore(failAt?: FailurePoint) {
  const state = freshState();

  const store = {
    state,
    account: {
      async findUnique({ where }: { where: { id: string } }) {
        return state.accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }) {
        if (failAt === 'account') throw new Error('simulated failure: account counter update');
        const a = state.accounts.find((x) => x.id === where.id);
        if (!a) throw new RowNotFoundError('account');
        a.invoiceCount += data.invoiceCount.increment;
        return a;
      },
    },
    invoice: {
      async findUnique({ where }: { where: { id: string } }) {
        return state.invoices.find((i) => i.id === where.id) ?? null;
      },
      async findMany({ where }: { where: { accountId: string } }) {
        return state.invoices.filter((i) => i.accountId === where.accountId);
      },
      async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) {
        if (state.invoices.some((i) => i.number === data.number)) {
          const e = new Error('duplicate key value violates unique constraint "invoices_number_key"');
          (e as { code?: string }).code = '23505';
          throw e;
        }
        const row = { ...data, createdAt: new Date() } as InvoiceRow;
        state.invoices.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) {
        const i = state.invoices.find((x) => x.id === where.id);
        if (!i) throw new RowNotFoundError('invoice');
        Object.assign(i, data);
        return i;
      },
    },
    invoiceLineItem: {
      async findMany({ where }: { where: { invoiceId: string } }) {
        return state.lineItems.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        if (failAt === 'lineItems') throw new Error('simulated failure: line item insert');
        state.lineItems.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const snapshot = {
        accounts: state.accounts.map((a) => ({ ...a })),
        invoices: state.invoices.map((i) => ({ ...i })),
        lineItems: state.lineItems.map((li) => ({ ...li })),
      };
      try {
        return await fn(store);
      } catch (e) {
        state.accounts = snapshot.accounts;
        state.invoices = snapshot.invoices;
        state.lineItems = snapshot.lineItems;
        throw e;
      }
    },
  };

  return store;
}

function repoWith(failAt?: FailurePoint): { store: ReturnType<typeof fakeStore>; repo: BillingRepository } {
  const store = fakeStore(failAt);
  return { store, repo: new BillingRepository(store as unknown as BillingStore) };
}

function service(): BillingService {
  return new BillingService(new BillingRepository(fakeStore() as unknown as BillingStore));
}

const INVOICE_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';

const newInvoice = {
  invoice: {
    id: 'cccccccc-0000-4000-8000-000000000009',
    accountId: ACCOUNT_1,
    number: 'INV-2024-0009',
    status: 'draft',
    totalMinor: 100000n,
    issuedAt: null,
  },
  lineItems: [
    {
      id: 'dddddddd-0000-4000-8000-000000000009',
      invoiceId: 'cccccccc-0000-4000-8000-000000000009',
      position: 1,
      description: 'Audit day',
      quantity: 1,
      unitPriceMinor: 100000n,
    },
  ],
};

describe('createInvoice: atomicity (not covered by the original suite)', () => {
  it('commits the invoice, its line items and the account counter when all writes succeed', async () => {
    const { store, repo } = repoWith();
    const created = await repo.createInvoice(newInvoice);
    expect(created.id).toBe(newInvoice.invoice.id);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(store.state.invoices).toHaveLength(3);
    expect(store.state.lineItems).toHaveLength(4);
    expect(store.state.accounts[0].invoiceCount).toBe(3);
  });

  it('writes NOTHING when the line-item insert fails mid-transaction', async () => {
    const { store, repo } = repoWith('lineItems');
    await expect(repo.createInvoice(newInvoice)).rejects.toThrow('simulated failure: line item insert');
    expect(store.state.invoices).toHaveLength(2);
    expect(store.state.lineItems).toHaveLength(3);
    expect(store.state.accounts[0].invoiceCount).toBe(2);
  });

  it('writes NOTHING when the counter bump fails (invoice and line items roll back too)', async () => {
    const { store, repo } = repoWith('account');
    await expect(repo.createInvoice(newInvoice)).rejects.toThrow('simulated failure: account counter update');
    expect(store.state.invoices).toHaveLength(2);
    expect(store.state.lineItems).toHaveLength(3);
    expect(store.state.accounts[0].invoiceCount).toBe(2);
  });

  it('propagates the unique violation (23505, was P2002) for a taken number and writes nothing', async () => {
    const { store, repo } = repoWith();
    await expect(
      repo.createInvoice({
        ...newInvoice,
        invoice: { ...newInvoice.invoice, id: 'eeeeeeee-0000-4000-8000-000000000009', number: 'INV-2024-0001' },
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(store.state.invoices).toHaveLength(2);
    expect(store.state.accounts[0].invoiceCount).toBe(2);
  });
});

describe('wire contract the original suite never asserted', () => {
  it('keeps the exact view field set (line items expose no position, no ids)', async () => {
    const inv = await service().getInvoice(INVOICE_1);
    expect(Object.keys(inv).sort()).toEqual(['id', 'issuedAt', 'lineItems', 'number', 'status', 'totalMinor']);
    expect(Object.keys(inv.lineItems[0]).sort()).toEqual(['description', 'quantity', 'unitPriceMinor']);
  });

  it('returns line items in storage order (3, 1, 2), not position order', async () => {
    const inv = await service().getInvoice(INVOICE_1);
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Support retainer', // position 3
      'Implementation', // position 1
      'Training day', // position 2
    ]);
  });

  it('lists invoices in storage order for the account', async () => {
    const list = await service().listForAccount(ACCOUNT_1);
    expect(list.map((i) => i.number)).toEqual(['INV-2024-0001', 'INV-2024-0002']);
  });

  it('keeps issuedAt present with a null value on an unissued invoice (null, not missing)', async () => {
    const inv = await service().getInvoice(INVOICE_2);
    expect('issuedAt' in inv).toBe(true);
    expect(inv.issuedAt).toBeNull();
    expect(serialize(inv)).toEqual(expect.objectContaining({ issuedAt: null }));
  });

  it('serializes BigInt money fields as decimal strings, even past Number.MAX_SAFE_INTEGER', async () => {
    const inv = await service().getInvoice(INVOICE_1);
    expect(inv.totalMinor).toBe(9007199254740993n);
    const json = serialize(inv) as { totalMinor: string; lineItems: Array<{ unitPriceMinor: string }> };
    expect(json.totalMinor).toBe('9007199254740993');
    expect(json.lineItems.map((li) => li.unitPriceMinor)).toEqual(['50000', '250000', '120000']);
  });

  it('returns an empty list for a nonexistent account (the dashboard path, not a 404)', async () => {
    await expect(service().listForAccount('99999999-9999-4999-8999-999999999999')).resolves.toEqual([]);
  });

  it('throws a coded invoice_not_found when the invoice is missing', async () => {
    await expect(service().getInvoice('missing')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('issue() on a missing invoice throws invoice_not_found (was Prisma P2025), not a generic 500', async () => {
    await expect(service().issue('missing')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });
});
