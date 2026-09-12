import { describe, expect, it } from 'vitest';
import { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type { BillingDb } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import { ConflictError, mapDbError, NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { accounts, invoiceLineItems, invoices } from '../src/db/schema.js';
import type { AccountRow, InvoiceRow, LineItemRow } from '../src/db/schema.js';
import { seed } from '../prisma/seed.js';

interface Store {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
}

function makeStore(): Store {
  return {
    accounts: seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') })),
    invoices: seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') })),
    // Kept in the seed's deliberate out-of-position insertion order (3, 1, 2).
    lineItems: seed.lineItems.map((li) => ({ ...li })),
  };
}

// A real Drizzle instance whose only job is to compile the repository's
// `where` fragments to SQL so the fake can read the bound column and value.
// The postgres() client is lazy: nothing here ever connects.
//
// ASSUMPTION: Drizzle query builders expose a synchronous `.toSQL()` that
// returns `{ sql, params }` without executing (documented public API).
const compiler = drizzle(postgres('postgres://fake:fake@127.0.0.1:1/fake'), {
  schema: { accounts, invoices, invoiceLineItems },
});

function compileWhere(table: unknown, condition: SQL): { column: string; value: unknown } {
  const { sql, params } = compiler
    .select()
    .from(table as typeof accounts)
    .where(condition)
    .toSQL();
  const match = sql.match(/where\s+"([a-z_]+)"\s*=\s*\$1/i);
  if (!match) throw new Error(`fake: could not interpret condition in: ${sql}`);
  return { column: match[1], value: params[0] };
}

function toProp(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * A fake Drizzle session with real transaction semantics: writes made through
 * the transaction callback are staged and only land in the store when the
 * callback succeeds; a throw discards the stage (rollback). Writes made
 * through the root connection apply immediately, so a test can tell the two
 * apart -- a write done outside the transaction would survive the rollback
 * test and fail it.
 */
function fakeDb(store: Store, options: { failLineItemInsert?: boolean } = {}): BillingDb {
  interface Target {
    accounts: AccountRow[];
    invoices: InvoiceRow[];
    lineItems: LineItemRow[];
    bumpAccount(id: string): void;
  }

  const stage = { invoices: [] as InvoiceRow[], lineItems: [] as LineItemRow[], accountBumps: [] as string[] };

  const rootTarget: Target = {
    accounts: store.accounts,
    invoices: store.invoices,
    lineItems: store.lineItems,
    bumpAccount(id: string) {
      const account = store.accounts.find((a) => a.id === id);
      if (account) account.invoiceCount += 1;
    },
  };

  const txTarget: Target = {
    accounts: store.accounts, // reads see committed rows
    invoices: stage.invoices, // writes are staged
    lineItems: stage.lineItems,
    bumpAccount(id: string) {
      stage.accountBumps.push(id);
    },
  };

  const rowsFor = (target: Target, table: unknown): Record<string, unknown>[] => {
    if (table === accounts) return target.accounts as unknown as Record<string, unknown>[];
    if (table === invoices) return target.invoices as unknown as Record<string, unknown>[];
    if (table === invoiceLineItems) return target.lineItems as unknown as Record<string, unknown>[];
    throw new Error('fake: unknown table');
  };

  const selectFrom = (target: Target, table: unknown) => ({
    where(condition: SQL) {
      const { column, value } = compileWhere(table, condition);
      const prop = toProp(column);
      const matched = rowsFor(target, table).filter((row) => row[prop] === value);
      return {
        // The select builder is thenable; the repository awaits it for lists
        // and calls .get() for single rows, exactly like the real builder.
        then(
          onfulfilled?: (rows: Record<string, unknown>[]) => unknown,
          onrejected?: (reason: unknown) => unknown,
        ): Promise<unknown> {
          return Promise.resolve(matched).then(onfulfilled as never, onrejected as never);
        },
        all: async () => matched,
        get: async () => matched[0] ?? null,
      };
    },
  });

  const insertInto = (target: Target, table: unknown) => ({
    values(data: Record<string, unknown> | Record<string, unknown>[]) {
      const rows = Array.isArray(data) ? data : [data];
      if (table === invoices) {
        // Emulates the created_at DB default the Prisma layer applied too.
        const inserted = rows.map((row) => ({ ...row, createdAt: row.createdAt ?? new Date() }));
        target.invoices.push(...(inserted as unknown as InvoiceRow[]));
        return { returning: async () => inserted as unknown as InvoiceRow[] };
      }
      if (table === invoiceLineItems) {
        if (options.failLineItemInsert) throw new Error('simulated line-item insert failure');
        target.lineItems.push(...(rows as unknown as LineItemRow[]));
        return { returning: async () => rows as unknown as LineItemRow[] };
      }
      throw new Error('fake: unexpected insert target');
    },
  });

  const updateTable = (target: Target, table: unknown) => ({
    set(data: Record<string, unknown>) {
      return {
        where(condition: SQL) {
          const { column, value } = compileWhere(table, condition);
          const prop = toProp(column);
          if (table === accounts) {
            // The repository only writes the atomic counter increment, which
            // arrives as a SQL chunk (sql`${accounts.invoiceCount} + 1`).
            if (!(data.invoiceCount instanceof SQL)) {
              throw new Error('fake: only counter increments are supported on accounts');
            }
            const account = target.accounts.find(
              (row) => (row as unknown as Record<string, unknown>)[prop] === value,
            );
            if (account) target.bumpAccount(account.id);
            return { returning: async () => (account ? [account] : []) as Record<string, unknown>[] };
          }
          // Drizzle resolves an unmatched update with an empty result instead
          // of throwing (Prisma threw P2025); that is what the repository now
          // relies on, and what the fake reproduces here.
          const rows = rowsFor(target, table);
          const match = rows.find((row) => row[prop] === value);
          if (match) Object.assign(match, data);
          return { returning: async () => (match ? [match] : []) as Record<string, unknown>[] };
        },
      };
    },
  });

  const chain = (target: Target) => ({
    select: () => ({ from: (table: unknown) => selectFrom(target, table) }),
    insert: (table: unknown) => insertInto(target, table),
    update: (table: unknown) => updateTable(target, table),
  });

  const db = {
    ...chain(rootTarget),
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      try {
        const result = await fn(chain(txTarget));
        // Commit: the callback succeeded, so every staged write lands now.
        store.invoices.push(...stage.invoices);
        store.lineItems.push(...stage.lineItems);
        for (const id of stage.accountBumps) rootTarget.bumpAccount(id);
        return result;
      } catch (error) {
        // Rollback: the stage is discarded; the committed store is untouched.
        throw error;
      }
    },
  };

  return db as unknown as BillingDb;
}

function service(): BillingService {
  return new BillingService(new BillingRepository(fakeDb(makeStore())));
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

describe('behaviors the original suite left unpinned', () => {
  it('returns line items in database insertion order, not sorted by position', async () => {
    const inv = await service().getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    // The seed inserts positions 3, 1, 2 on purpose and no query has an
    // ORDER BY, so that is exactly the order callers receive.
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Support retainer',
      'Implementation',
      'Training day',
    ]);
  });

  it('exposes exactly the documented view fields (no row extras leak)', async () => {
    const view = await service().getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    expect(Object.keys(view).sort()).toEqual(['id', 'issuedAt', 'lineItems', 'number', 'status', 'totalMinor']);
    expect(Object.keys(view.lineItems[0]).sort()).toEqual(['description', 'quantity', 'unitPriceMinor']);
  });

  it('returns an empty list for an account that does not exist yet (no 404)', async () => {
    const list = await service().listForAccount('99999999-9999-4999-8999-999999999999');
    expect(list).toEqual([]);
  });

  it('issue() on a missing invoice rejects with invoice_not_found (was Prisma P2025)', async () => {
    const error: unknown = await service().issue('does-not-exist').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).code).toBe('invoice_not_found');
  });

  it('issue() leaves the rest of the row untouched and sets issuedAt', async () => {
    const inv = await service().issue('aaaaaaaa-0000-4000-8000-000000000002');
    expect(inv.number).toBe('INV-2024-0002');
    expect(inv.totalMinor).toBe(125000n);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
  });

  it('serializes bigint money as exact decimal strings on the wire', async () => {
    const view = await service().getInvoice('aaaaaaaa-0000-4000-8000-000000000001');
    const body = JSON.stringify(serialize(view));
    // 9007199254740993 is above Number.MAX_SAFE_INTEGER: it only survives as
    // this exact string if the value stays a bigint end to end.
    expect(body).toContain('"totalMinor":"9007199254740993"');
    expect(body).toContain('"unitPriceMinor":"250000"');
  });

  it('keeps null fields present on the wire (null, not missing)', async () => {
    const view = await service().getInvoice('aaaaaaaa-0000-4000-8000-000000000002');
    const body = JSON.parse(JSON.stringify(serialize(view))) as { issuedAt: unknown };
    expect(body).toHaveProperty('issuedAt');
    expect(body.issuedAt).toBeNull();
  });

  it('maps a Postgres unique violation (23505) to invoice_number_taken (was P2002)', () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const mapped = mapDbError(uniqueViolation);
    expect(mapped).toBeInstanceOf(ConflictError);
    expect((mapped as ConflictError).code).toBe('invoice_number_taken');
  });

  it('propagates non-constraint errors unchanged', () => {
    const boom = new Error('boom');
    expect(mapDbError(boom)).toBe(boom);
  });
});

describe('BillingRepository.createInvoice (transactional)', () => {
  const CONTOSO = '22222222-2222-4222-8222-222222222222';
  const NEW_INVOICE = 'cccccccc-0000-4000-8000-000000000001';

  const input: { invoice: Omit<InvoiceRow, 'createdAt'>; lineItems: LineItemRow[] } = {
    invoice: {
      id: NEW_INVOICE,
      accountId: CONTOSO,
      number: 'INV-2024-0003',
      status: 'draft',
      totalMinor: 4242n,
      issuedAt: null,
    },
    lineItems: [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        invoiceId: NEW_INVOICE,
        position: 1,
        description: 'Setup',
        quantity: 1,
        unitPriceMinor: 4242n,
      },
    ],
  };

  it('writes invoice, line items and the account counter together', async () => {
    const store = makeStore();
    const repo = new BillingRepository(fakeDb(store));
    const created = await repo.createInvoice(input);
    expect(created.id).toBe(NEW_INVOICE);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(store.invoices.some((i) => i.id === NEW_INVOICE)).toBe(true);
    expect(store.lineItems.filter((li) => li.invoiceId === NEW_INVOICE)).toHaveLength(1);
    expect(store.accounts.find((a) => a.id === CONTOSO)?.invoiceCount).toBe(1);
  });

  it('rolls everything back when the line-item insert fails mid-transaction', async () => {
    const store = makeStore();
    const repo = new BillingRepository(fakeDb(store, { failLineItemInsert: true }));
    await expect(repo.createInvoice(input)).rejects.toThrow('simulated line-item insert failure');
    // The invoice insert had already run (and been staged) before the
    // failure: if anything had been committed eagerly, it would show up here.
    expect(store.invoices.some((i) => i.id === NEW_INVOICE)).toBe(false);
    expect(store.lineItems.some((li) => li.invoiceId === NEW_INVOICE)).toBe(false);
    expect(store.accounts.find((a) => a.id === CONTOSO)?.invoiceCount).toBe(0);
  });

  it('still bumps the counter when the invoice has no line items', async () => {
    const store = makeStore();
    const repo = new BillingRepository(fakeDb(store));
    await repo.createInvoice({ ...input, lineItems: [] });
    expect(store.invoices.some((i) => i.id === NEW_INVOICE)).toBe(true);
    expect(store.lineItems).toHaveLength(3); // only the seeded rows
    expect(store.accounts.find((a) => a.id === CONTOSO)?.invoiceCount).toBe(1);
  });
});
