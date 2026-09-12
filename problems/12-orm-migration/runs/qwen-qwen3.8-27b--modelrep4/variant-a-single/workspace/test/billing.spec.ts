import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import type { Db } from '../src/billing/db.js';
import {
  accounts,
  invoiceLineItems,
  invoices,
  type AccountRow,
  type InvoiceRow,
  type LineItemRow,
} from '../src/billing/schema.js';
import { seed } from './seed.js';

const ACCOUNT_NORTHWIND = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_CONTOSO = '22222222-2222-4222-8222-222222222222';
const INVOICE_ISSUED = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_DRAFT = 'aaaaaaaa-0000-4000-8000-000000000002';

/**
 * In-memory stand-in for the Drizzle client, in the spirit of the old fake
 * Prisma client. It switches on the real table objects the repository passes
 * in, and simulates the database semantics the ported behavior hinged on:
 *   * zero-row updates RESOLVE (Drizzle never throws the P2025 equivalent),
 *   * unique violations surface as SQLSTATE 23505,
 *   * selects without ORDER BY come back in storage order,
 *   * transaction() rolls the store back on rejection.
 */

interface Store {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  items: LineItemRow[];
}

interface FakeDbConfig {
  /** Account id passed to findAccount, and used to filter listInvoices. */
  accountId?: string;
  /** Invoice id passed to findInvoice / findLineItems. */
  invoiceId?: string;
  /** Invoice id passed to markIssued. */
  issuedId?: string;
  /** Simulate a constraint failure on the line item insert in createInvoice. */
  failLineItemInsert?: boolean;
  /** Simulate a failure on the account counter update in createInvoice. */
  failCounterUpdate?: boolean;
}

type Row = AccountRow | InvoiceRow | LineItemRow;

class FakeSelect {
  private table: unknown = undefined;
  private ordered = false;
  private limited = false;

  constructor(private readonly store: Store, private readonly cfg: FakeDbConfig) {}

  from(t: unknown) {
    this.table = t;
    return this;
  }

  where(_cond: unknown) {
    return this;
  }

  orderBy(_order: unknown) {
    this.ordered = true;
    return this;
  }

  limit(_n: number) {
    this.limited = true;
    return this;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.rows()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private rows(): Row[] {
    if (this.table === accounts) {
      return this.store.accounts.filter((a) => a.id === this.cfg.accountId);
    }
    if (this.table === invoices) {
      // findInvoice queries by primary key (with limit); listInvoices by account.
      return this.limited
        ? this.store.invoices.filter((i) => i.id === this.cfg.invoiceId)
        : this.store.invoices.filter((i) => i.accountId === this.cfg.accountId);
    }
    if (this.table === invoiceLineItems) {
      const rows = this.store.items.filter((li) => li.invoiceId === this.cfg.invoiceId);
      // A real database returns rows in physical order unless the query says
      // otherwise; honor ORDER BY only when the repository asked for it.
      return this.ordered ? [...rows].sort((a, b) => a.position - b.position) : rows;
    }
    throw new Error('fake db: unexpected select target');
  }
}

class FakeInsertResult {
  constructor(private readonly rows: unknown[]) {}

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  returning() {
    return this;
  }
}

class FakeInsert {
  constructor(
    private readonly table: unknown,
    private readonly store: Store,
    private readonly cfg: FakeDbConfig,
  ) {}

  values(data: unknown): FakeInsertResult {
    if (this.table === invoices) {
      const incoming = (Array.isArray(data) ? data : [data]) as Array<Omit<InvoiceRow, 'createdAt'>>;
      for (const v of incoming) {
        if (this.store.invoices.some((i) => i.number === v.number)) {
          // Same shape as a real Postgres unique violation (SQLSTATE 23505).
          throw Object.assign(
            new Error('duplicate key value violates unique constraint "invoices_number_key"'),
            { code: '23505' },
          );
        }
      }
      const rows = incoming.map((v) => ({ ...v, createdAt: new Date() }));
      this.store.invoices.push(...rows);
      return new FakeInsertResult(rows);
    }
    if (this.table === invoiceLineItems) {
      if (this.cfg.failLineItemInsert) throw new Error('injected failure: line item insert');
      const rows = Array.isArray(data) ? data : [data];
      this.store.items.push(...(rows as LineItemRow[]));
      return new FakeInsertResult(rows);
    }
    throw new Error('fake db: unexpected insert target');
  }
}

class FakeUpdate {
  private data: Record<string, unknown> = {};

  constructor(
    private readonly table: unknown,
    private readonly store: Store,
    private readonly cfg: FakeDbConfig,
  ) {}

  set(d: Record<string, unknown>) {
    this.data = d;
    return this;
  }

  where(_cond: unknown) {
    return this;
  }

  returning() {
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private run(): unknown[] {
    if (this.table === invoices) {
      const target = this.store.invoices.find((i) => i.id === this.cfg.issuedId);
      if (!target) return []; // zero-row update resolves; it does not throw
      Object.assign(target, this.data);
      return [target];
    }
    if (this.table === accounts) {
      if (this.cfg.failCounterUpdate) throw new Error('injected failure: account counter');
      // The only account update in this service: +1 on the invoice counter of
      // the account that owns the invoice created in the same transaction.
      const lastInvoice = this.store.invoices[this.store.invoices.length - 1];
      const target = lastInvoice
        ? this.store.accounts.find((a) => a.id === lastInvoice.accountId)
        : undefined;
      if (!target) return [];
      target.invoiceCount += 1;
      return [target];
    }
    throw new Error('fake db: unexpected update target');
  }
}

function makeDb(cfg: FakeDbConfig = {}) {
  const store: Store = freshStore();
  const fake = {
    select: () => new FakeSelect(store, cfg),
    insert: (table: unknown) => new FakeInsert(table, store, cfg),
    update: (table: unknown) => new FakeUpdate(table, store, cfg),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const accountsBefore = structuredClone(store.accounts);
      const invoicesBefore = structuredClone(store.invoices);
      const itemsBefore = structuredClone(store.items);
      try {
        return await fn(fake);
      } catch (err) {
        store.accounts = accountsBefore;
        store.invoices = invoicesBefore;
        store.items = itemsBefore;
        throw err;
      }
    },
  };
  return { db: fake as unknown as Db, store };
}

function freshStore(): Store {
  return {
    accounts: seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') })) as AccountRow[],
    invoices: seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') })) as InvoiceRow[],
    items: seed.lineItems.map((li) => ({ ...li })) as LineItemRow[],
  };
}

function serviceWith(cfg: FakeDbConfig = {}) {
  const { db, store } = makeDb(cfg);
  const repo = new BillingRepository(db);
  return { svc: new BillingService(repo), repo, store };
}

describe('BillingService (Drizzle port)', () => {
  it('returns an invoice with its line items', async () => {
    const { svc } = serviceWith({ accountId: ACCOUNT_NORTHWIND, invoiceId: INVOICE_ISSUED });
    const inv = await svc.getInvoice(INVOICE_ISSUED);
    expect(inv.number).toBe('INV-2024-0001');
    expect(inv.status).toBe('issued');
    expect(inv.lineItems).toHaveLength(3);
  });

  it('rejects a missing invoice with invoice_not_found', async () => {
    const { svc } = serviceWith({ invoiceId: 'does-not-exist' });
    await expect(svc.getInvoice('does-not-exist')).rejects.toThrow(NotFoundError);
    await expect(svc.getInvoice('does-not-exist')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('lists invoices for an account', async () => {
    const { svc } = serviceWith({ accountId: ACCOUNT_NORTHWIND });
    expect(await svc.listForAccount(ACCOUNT_NORTHWIND)).toHaveLength(2);
  });

  it('returns an empty list for an account with no invoices', async () => {
    const { svc } = serviceWith({ accountId: ACCOUNT_CONTOSO });
    expect(await svc.listForAccount(ACCOUNT_CONTOSO)).toHaveLength(0);
  });

  it('returns an empty list for a missing account, not a 404', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const { svc } = serviceWith({ accountId: missing });
    await expect(svc.listForAccount(missing)).resolves.toEqual([]);
  });

  it('returns line items in position order even when stored out of order', async () => {
    const { svc } = serviceWith({ invoiceId: INVOICE_ISSUED });
    const inv = await svc.getInvoice(INVOICE_ISSUED);
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Implementation',
      'Training day',
      'Support retainer',
    ]);
  });

  it('keeps issuedAt present-but-null and lineItems present-but-empty on a draft', async () => {
    const { svc } = serviceWith({ invoiceId: INVOICE_DRAFT });
    const inv = await svc.getInvoice(INVOICE_DRAFT);
    expect(inv.issuedAt).toBeNull();
    expect(inv.lineItems).toEqual([]);
    const body = serialize(inv) as Record<string, unknown>;
    expect('issuedAt' in body).toBe(true);
    expect(body.issuedAt).toBeNull();
    expect('lineItems' in body).toBe(true);
  });

  it('serializes BigInt money fields as exact decimal strings', async () => {
    const { svc } = serviceWith({ invoiceId: INVOICE_ISSUED });
    const inv = await svc.getInvoice(INVOICE_ISSUED);
    expect(inv.totalMinor).toBe(9007199254740993n); // past Number.MAX_SAFE_INTEGER
    const body = serialize(inv) as {
      totalMinor: string;
      lineItems: Array<{ unitPriceMinor: string }>;
    };
    expect(body.totalMinor).toBe('9007199254740993');
    expect(body.lineItems.map((li) => li.unitPriceMinor)).toEqual(['250000', '120000', '50000']);
  });

  it('serializes list rows with the full invoice field set', async () => {
    const { svc } = serviceWith({ accountId: ACCOUNT_NORTHWIND });
    const [first] = await svc.listForAccount(ACCOUNT_NORTHWIND);
    const body = serialize(first) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'accountId',
      'createdAt',
      'id',
      'issuedAt',
      'number',
      'status',
      'totalMinor',
    ]);
    expect(typeof body.createdAt).toBe('string');
  });

  it('marks an invoice issued and stamps issuedAt', async () => {
    const { svc } = serviceWith({ issuedId: INVOICE_DRAFT });
    const inv = await svc.issue(INVOICE_DRAFT);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
  });

  it('rejects issuing a missing invoice with invoice_not_found', async () => {
    const { svc } = serviceWith({ issuedId: 'does-not-exist' });
    await expect(svc.issue('does-not-exist')).rejects.toThrow(NotFoundError);
    await expect(svc.issue('does-not-exist')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });
});

describe('BillingRepository.createInvoice (Drizzle port)', () => {
  const newInvoice = {
    id: 'cccccccc-0000-4000-8000-000000000001',
    accountId: ACCOUNT_NORTHWIND,
    number: 'INV-2024-0003',
    status: 'draft',
    totalMinor: 42n,
    issuedAt: null,
  };
  const newItem = {
    id: 'dddddddd-0000-4000-8000-000000000001',
    invoiceId: newInvoice.id,
    position: 1,
    description: 'Something',
    quantity: 1,
    unitPriceMinor: 42n,
  };

  it('writes the invoice, its line items and the account counter in one transaction', async () => {
    const { repo, store } = serviceWith();
    const created = await repo.createInvoice({ invoice: newInvoice, lineItems: [newItem] });
    expect(created.id).toBe(newInvoice.id);
    expect(created.totalMinor).toBe(42n);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(store.invoices).toHaveLength(3);
    expect(store.items).toHaveLength(4);
    expect(store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount).toBe(3);
  });

  it('rolls back the invoice when the line item insert fails mid-transaction', async () => {
    const { repo, store } = serviceWith({ failLineItemInsert: true });
    const invoicesBefore = store.invoices.length;
    const itemsBefore = store.items.length;
    const countBefore = store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount;

    await expect(repo.createInvoice({ invoice: newInvoice, lineItems: [newItem] })).rejects.toThrow(
      'injected failure: line item insert',
    );

    expect(store.invoices).toHaveLength(invoicesBefore);
    expect(store.items).toHaveLength(itemsBefore);
    expect(store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount).toBe(countBefore);
  });

  it('rolls back the invoice and its items when the counter update fails last', async () => {
    const { repo, store } = serviceWith({ failCounterUpdate: true });
    const invoicesBefore = store.invoices.length;
    const itemsBefore = store.items.length;

    await expect(repo.createInvoice({ invoice: newInvoice, lineItems: [newItem] })).rejects.toThrow(
      'injected failure: account counter',
    );

    expect(store.invoices).toHaveLength(invoicesBefore);
    expect(store.items).toHaveLength(itemsBefore);
    expect(store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount).toBe(2);
  });

  it('increments the counter even for an invoice with no line items', async () => {
    const { repo, store } = serviceWith();
    await repo.createInvoice({ invoice: newInvoice, lineItems: [] });
    expect(store.items).toHaveLength(3);
    expect(store.invoices).toHaveLength(3);
    expect(store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount).toBe(3);
  });

  it('maps a duplicate invoice number to invoice_number_taken and writes nothing', async () => {
    const { repo, store } = serviceWith();
    const duplicate = { ...newInvoice, id: 'cccccccc-0000-4000-8000-000000000099', number: 'INV-2024-0001' };
    await expect(repo.createInvoice({ invoice: duplicate, lineItems: [] })).rejects.toThrow(ConflictError);
    await expect(repo.createInvoice({ invoice: duplicate, lineItems: [] })).rejects.toMatchObject({
      code: 'invoice_number_taken',
    });
    expect(store.invoices).toHaveLength(2);
    expect(store.accounts.find((a) => a.id === ACCOUNT_NORTHWIND)?.invoiceCount).toBe(2);
  });
});
