import { describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed.js';
import {
  ConflictError,
  mapDbError,
  NotFoundError,
  RecordNotFoundError,
} from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import type { BillingClient } from '../src/billing/billing.client.js';
import type { AccountRow, InvoiceRow, LineItemRow } from '../src/db/schema.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ISSUED = 'aaaaaaaa-0000-4000-8000-000000000001';
const DRAFT = 'aaaaaaaa-0000-4000-8000-000000000002';
const MISSING = '00000000-0000-4000-8000-000000000000';

/**
 * In-memory BillingClient with real transaction semantics (snapshot + rollback,
 * modelling the database's atomicity contract) and hooks to inject a failure
 * mid-transaction. Rows are kept in insertion order, as the database returns them.
 */
class InMemoryBillingClient implements BillingClient {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
  failLineItemInsert = false;
  failAccountUpdate = false;

  constructor() {
    this.accounts = seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') }));
    this.invoices = seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') }));
    this.lineItems = seed.lineItems.map((li) => ({ ...li }));
  }

  readonly account: BillingClient['account'] = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.accounts.find((a) => a.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }) => {
      if (this.failAccountUpdate) throw new Error('injected: account counter write failed mid-transaction');
      const account = this.accounts.find((a) => a.id === where.id);
      if (!account) throw new RecordNotFoundError('accounts', { id: where.id });
      account.invoiceCount += data.invoiceCount.increment;
      return account;
    },
  };

  readonly invoice: BillingClient['invoice'] = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.invoices.find((i) => i.id === where.id) ?? null,
    findMany: async ({ where }: { where: { accountId: string } }) =>
      this.invoices.filter((i) => i.accountId === where.accountId),
    create: async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) => {
      const row: InvoiceRow = { ...data, createdAt: new Date('2024-04-02T00:00:00Z') };
      this.invoices.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) => {
      const invoice = this.invoices.find((i) => i.id === where.id);
      if (!invoice) throw new RecordNotFoundError('invoices', { id: where.id });
      Object.assign(invoice, data);
      return invoice;
    },
  };

  readonly invoiceLineItem: BillingClient['invoiceLineItem'] = {
    findMany: async ({ where }: { where: { invoiceId: string } }) =>
      this.lineItems.filter((li) => li.invoiceId === where.invoiceId),
    createMany: async ({ data }: { data: LineItemRow[] }) => {
      if (this.failLineItemInsert) throw new Error('injected: line item insert failed mid-transaction');
      this.lineItems.push(...data);
      return { count: data.length };
    },
  };

  async $transaction<T>(fn: (tx: BillingClient) => Promise<T>): Promise<T> {
    const snapshot = {
      accounts: this.accounts.map((a) => ({ ...a })),
      invoices: this.invoices.map((i) => ({ ...i })),
      lineItems: this.lineItems.map((li) => ({ ...li })),
    };
    try {
      return await fn(this);
    } catch (error) {
      // Roll back: nothing written inside a failed transaction survives.
      this.accounts = snapshot.accounts;
      this.invoices = snapshot.invoices;
      this.lineItems = snapshot.lineItems;
      throw error;
    }
  }
}

function makeHarness() {
  const client = new InMemoryBillingClient();
  const repository = new BillingRepository(client);
  return { client, repository, service: new BillingService(repository) };
}

describe('wire format: byte compatibility with the Prisma-era service', () => {
  it('getInvoice serialises to exactly the same JSON as before (bigint as string, dates as ISO)', async () => {
    const view = await makeHarness().service.getInvoice(ISSUED);
    expect(JSON.stringify(serialize(view))).toBe(
      '{"id":"aaaaaaaa-0000-4000-8000-000000000001",' +
        '"number":"INV-2024-0001",' +
        '"status":"issued",' +
        '"totalMinor":"9007199254740993",' +
        '"issuedAt":"2024-04-01T09:00:00.000Z",' +
        '"lineItems":[' +
          '{"description":"Support retainer","quantity":1,"unitPriceMinor":"50000"},' +
          '{"description":"Implementation","quantity":2,"unitPriceMinor":"250000"},' +
          '{"description":"Training day","quantity":1,"unitPriceMinor":"120000"}' +
        ']}'
    );
  });

  it('keeps money values as bigint internally, including values past Number.MAX_SAFE_INTEGER', async () => {
    const view = await makeHarness().service.getInvoice(ISSUED);
    expect(view.totalMinor).toBe(9007199254740993n);
    expect(typeof view.totalMinor).toBe('bigint');
    expect(view.lineItems[0].unitPriceMinor).toBe(50000n);
  });

  it('ships a draft invoice with issuedAt present and null, and an empty (not missing) lineItems', async () => {
    const view = await makeHarness().service.getInvoice(DRAFT);
    const wire = JSON.parse(JSON.stringify(serialize(view))) as Record<string, unknown>;
    expect('issuedAt' in wire).toBe(true);
    expect(wire.issuedAt).toBe(null);
    expect('lineItems' in wire).toBe(true);
    expect(wire.lineItems).toEqual([]);
    expect(wire.totalMinor).toBe('125000');
  });
});

describe('behaviour the original suite never asserted', () => {
  it('listForAccount returns [] for a completely missing account (not a 404)', async () => {
    const list = await makeHarness().service.listForAccount('99999999-9999-4999-8999-999999999999');
    expect(list).toEqual([]);
  });

  it('listForAccount returns full rows (accountId, createdAt included) in database order', async () => {
    const list = await makeHarness().service.listForAccount(ACCOUNT);
    expect(list.map((i) => i.number)).toEqual(['INV-2024-0001', 'INV-2024-0002']);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual([
        'accountId',
        'createdAt',
        'id',
        'issuedAt',
        'number',
        'status',
        'totalMinor',
      ]);
    }
    const wire = JSON.parse(JSON.stringify(serialize(list))) as Array<Record<string, unknown>>;
    expect(wire[0].totalMinor).toBe('9007199254740993');
    expect(wire[0].issuedAt).toBe('2024-04-01T09:00:00.000Z');
    expect(wire[1].issuedAt).toBe(null);
  });

  it('line items come back in database (insertion) order, not position order', async () => {
    const view = await makeHarness().service.getInvoice(ISSUED);
    // The seed inserted positions 3, 1, 2; the old service returned them in that order.
    expect(view.lineItems.map((li) => li.description)).toEqual([
      'Support retainer',
      'Implementation',
      'Training day',
    ]);
  });

  it('getInvoice on a missing invoice rejects with code invoice_not_found', async () => {
    await expect(makeHarness().service.getInvoice(MISSING)).rejects.toMatchObject({
      name: 'NotFoundError',
      code: 'invoice_not_found',
    });
  });

  it('issue() on a missing invoice 404s with invoice_not_found (the P2025 path)', async () => {
    await expect(makeHarness().service.issue(MISSING)).rejects.toMatchObject({
      name: 'NotFoundError',
      code: 'invoice_not_found',
    });
  });

  it('issue() returns the stored row with totalMinor still bigint and a fresh issuedAt', async () => {
    const row = await makeHarness().service.issue(DRAFT);
    expect(row.status).toBe('issued');
    expect(row.totalMinor).toBe(125000n);
    expect(row.issuedAt).toBeInstanceOf(Date);
  });
});

describe('error mapping (Drizzle/Postgres instead of Prisma codes)', () => {
  it('maps a unique violation (23505) to invoice_number_taken, as P2002 did', () => {
    const err = mapDbError(
      Object.assign(new Error('duplicate key value violates unique constraint "invoices_number_key"'), {
        code: '23505',
      }),
    );
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe('invoice_number_taken');
  });

  it('maps a no-op update (the P2025 equivalent) to invoice_not_found', () => {
    const err = mapDbError(new RecordNotFoundError('invoices', { id: MISSING }));
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('invoice_not_found');
  });

  it('propagates anything else unchanged (the 500 path)', () => {
    const boom = new Error('connection reset');
    expect(mapDbError(boom)).toBe(boom);
  });
});

describe('createInvoice: atomicity and write order', () => {
  const invoice = {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    accountId: ACCOUNT,
    number: 'INV-2024-0003',
    status: 'draft',
    totalMinor: 1000n,
    issuedAt: null,
  };
  const lineItems = [
    {
      id: 'bbbbbbbb-0000-4000-8000-000000000004',
      invoiceId: invoice.id,
      position: 1,
      description: 'Setup',
      quantity: 1,
      unitPriceMinor: 600n,
    },
    {
      id: 'bbbbbbbb-0000-4000-8000-000000000005',
      invoiceId: invoice.id,
      position: 2,
      description: 'Seating',
      quantity: 4,
      unitPriceMinor: 100n,
    },
  ];

  it('writes the invoice, its line items and the account counter together', async () => {
    const { client, repository, service } = makeHarness();
    const created = await repository.createInvoice({ invoice, lineItems });
    expect(created.id).toBe(invoice.id);
    expect(created.createdAt).toBeInstanceOf(Date);

    const account = (await client.account.findUnique({ where: { id: ACCOUNT } }))!;
    expect(account.invoiceCount).toBe(3); // was 2

    const view = await service.getInvoice(invoice.id);
    // Insertion order is the contract: items are read back in the order written.
    expect(view.lineItems.map((li) => li.description)).toEqual(['Setup', 'Seating']);
  });

  it('rolls back everything when the line-item insert fails mid-transaction', async () => {
    const { client, repository } = makeHarness();
    client.failLineItemInsert = true;

    await expect(repository.createInvoice({ invoice, lineItems })).rejects.toThrow('mid-transaction');

    expect(await client.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await client.invoiceLineItem.findMany({ where: { invoiceId: invoice.id } })).toEqual([]);
    const account = (await client.account.findUnique({ where: { id: ACCOUNT } }))!;
    expect(account.invoiceCount).toBe(2); // unchanged
  });

  it('rolls back the invoice too when the counter update fails (the third write)', async () => {
    const { client, repository } = makeHarness();
    client.failAccountUpdate = true;

    await expect(repository.createInvoice({ invoice, lineItems })).rejects.toThrow('mid-transaction');

    expect(await client.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await client.invoiceLineItem.findMany({ where: { invoiceId: invoice.id } })).toEqual([]);
    const account = (await client.account.findUnique({ where: { id: ACCOUNT } }))!;
    expect(account.invoiceCount).toBe(2); // unchanged
  });

  it('creates an invoice with zero line items and still bumps the counter', async () => {
    const { client, repository } = makeHarness();
    const created = await repository.createInvoice({ invoice, lineItems: [] });
    expect(created.number).toBe('INV-2024-0003');
    const account = (await client.account.findUnique({ where: { id: ACCOUNT } }))!;
    expect(account.invoiceCount).toBe(3);
    expect(await client.invoiceLineItem.findMany({ where: { invoiceId: created.id } })).toEqual([]);
  });
});
