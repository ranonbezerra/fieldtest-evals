# repair2-set

## reasoning

```
Let me analyze the error carefully.

The error is at `test/billing-drizzle.spec.ts(285,7)`. Let me look at what's on line 285 in the test file.

Looking at the test file, the `makeThenable` function is defined around line 278-283:

```typescript
function makeThenable<T>(value: T): PromiseLike<T> & { returning: () => PromiseLike<T> } {
  return {
    then: (onfulfilled?: ((v: T) => unknown) | null) => Promise.resolve(value).then(onfulfilled ?? undefined),
    returning: () => makeThenable(value),
  };
}
```

The issue is that the `then` method signature doesn't match `PromiseLike<T>`'s expected `then` signature. The `PromiseLike<T>` interface expects:

```typescript
then<TResult1 = T, TResult2 = never>(
  onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
  onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined
): PromiseLike<TResult1 | TResult2>;
```

But the implementation has:
```typescript
then: (onfulfilled?: ((v: T) => unknown) | null) => Promise.resolve(value).then(onfulfilled ?? undefined)
```

This has two problems:
1. The `onfulfilled` callback type is `(v: T) => unknown` instead of `(value: T) => TResult1 | PromiseLike<TResult1>`
2. The return type is `Promise<unknown>` instead of `PromiseLike<TResult1 | TResult2>`
3. It's missing the `onrejected` parameter

The fix is to make `then` match the `PromiseLike<T>` signature properly. The simplest fix that works:

```typescript
function makeThenable<T>(value: T): PromiseLike<T> & { returning: () => PromiseLike<T> } {
  return {
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(value).then(onfulfilled, onrejected);
    },
    returning: () => makeThenable(value),
  };
}
```

Wait, but `Promise.resolve(value).then(onfulfilled, onrejected)` returns `Promise<TResult1 | TResult2>` which is assignable to `PromiseLike<TResult1 | TResult2>`. That should work.

Let me count: there's only ONE error in the list, and it's a single mistake — the `then` method in `makeThenable` doesn't conform to the `PromiseLike<T>` type signature.

The fix is to change the `then` method to have the proper generic signature matching `PromiseLike<T>`.

Let me write the complete file with this one fix applied.
```

## reply

### test/billing-drizzle.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed.js';
import { NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { DrizzleBillingClient, type BillingDb } from '../src/billing/drizzle-client.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const INVOICE_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

interface FakeStore {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
}

function makeStore(): FakeStore {
  return {
    accounts: seed.accounts.map((a) => ({ ...a, createdAt: new Date('2024-01-01T00:00:00Z') })),
    invoices: seed.invoices.map((i) => ({ ...i, createdAt: new Date('2024-04-01T00:00:00Z') })),
    lineItems: [...seed.lineItems],
  };
}

type FailurePoint = 'invoice' | 'lineItems' | 'account';

interface FakeHooks {
  onCall?: (method: string) => void;
}

/**
 * In-memory implementation of the data-access seam, with a
 * rollback-emulating $transaction: a snapshot is taken when the
 * transaction begins and restored if the body throws -- the same
 * observable contract a database transaction provides. If the repository
 * ever wrote outside the transaction, that write would survive the
 * rollback and the atomicity tests below would fail.
 */
function makeClient(store: FakeStore, failure: FailurePoint | null = null, hooks: FakeHooks = {}): PrismaClient {
  const raw = {
    account: {
      async findUnique({ where }: { where: { id: string } }) {
        hooks.onCall?.('account.findUnique');
        return store.accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }) {
        hooks.onCall?.('account.update');
        const a = store.accounts.find((x) => x.id === where.id);
        if (!a) throw new Error('account not found');
        a.invoiceCount += data.invoiceCount.increment;
        return a;
      },
    },
    invoice: {
      async findUnique({ where }: { where: { id: string } }) {
        hooks.onCall?.('invoice.findUnique');
        return store.invoices.find((i) => i.id === where.id) ?? null;
      },
      async findMany({ where }: { where: { accountId: string } }) {
        hooks.onCall?.('invoice.findMany');
        return store.invoices.filter((i) => i.accountId === where.accountId);
      },
      async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) {
        hooks.onCall?.('invoice.create');
        const row = { ...data, createdAt: new Date() } as InvoiceRow;
        store.invoices.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) {
        hooks.onCall?.('invoice.update');
        const i = store.invoices.find((x) => x.id === where.id);
        if (!i) return null; // no-op update: nothing matched
        Object.assign(i, data);
        return i;
      },
    },
    invoiceLineItem: {
      async findMany({ where }: { where: { invoiceId: string } }) {
        hooks.onCall?.('lineItems.findMany');
        return store.lineItems.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        hooks.onCall?.('lineItems.createMany');
        store.lineItems.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown> {
      const snapshot = {
        counts: store.accounts.map((a) => a.invoiceCount),
        invoices: [...store.invoices],
        lineItems: [...store.lineItems],
      };
      try {
        return await fn(raw);
      } catch (e) {
        store.accounts.forEach((a, idx) => {
          a.invoiceCount = snapshot.counts[idx];
        });
        store.invoices = snapshot.invoices;
        store.lineItems = snapshot.lineItems;
        throw e;
      }
    },
  };

  if (failure === 'invoice') {
    raw.invoice.create = async () => {
      hooks.onCall?.('invoice.create');
      throw new Error('injected: invoice insert failed');
    };
  } else if (failure === 'lineItems') {
    raw.invoiceLineItem.createMany = async () => {
      hooks.onCall?.('lineItems.createMany');
      throw new Error('injected: line items insert failed');
    };
  } else if (failure === 'account') {
    raw.account.update = async () => {
      hooks.onCall?.('account.update');
      throw new Error('injected: account counter update failed');
    };
  }

  return raw as unknown as PrismaClient;
}

function service(store: FakeStore = makeStore(), failure: FailurePoint | null = null, hooks: FakeHooks = {}): BillingService {
  return new BillingService(new BillingRepository(makeClient(store, failure, hooks)));
}

describe('invoice creation (repository)', () => {
  const input = {
    invoice: {
      id: 'cccccccc-0000-4000-8000-000000000099',
      accountId: ACCOUNT,
      number: 'INV-2024-0099',
      status: 'draft',
      totalMinor: 100n,
      issuedAt: null,
    },
    lineItems: [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        invoiceId: 'cccccccc-0000-4000-8000-000000000099',
        position: 1,
        description: 'Consulting',
        quantity: 1,
        unitPriceMinor: 100n,
      },
    ],
  };

  it('persists invoice, line items and the counter on success', async () => {
    const store = makeStore();
    const repo = new BillingRepository(makeClient(store));
    const created = await repo.createInvoice(input);

    expect(created.id).toBe(input.invoice.id);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(store.invoices.some((i) => i.id === input.invoice.id)).toBe(true);
    expect(store.lineItems.filter((li) => li.invoiceId === input.invoice.id)).toHaveLength(1);
    expect(store.accounts.find((a) => a.id === ACCOUNT)!.invoiceCount).toBe(3);
  });

  it('rolls back the invoice when the line-item insert fails mid-transaction', async () => {
    const store = makeStore();
    const calls: string[] = [];
    const repo = new BillingRepository(makeClient(store, 'lineItems', { onCall: (m) => calls.push(m) }));

    await expect(repo.createInvoice(input)).rejects.toThrow('injected: line items insert failed');

    // The writes were attempted (inside the transaction) and then rolled back.
    expect(calls).toContain('invoice.create');
    expect(calls).toContain('lineItems.createMany');
    expect(store.invoices).toHaveLength(2);
    expect(store.lineItems).toHaveLength(3);
    expect(store.accounts.find((a) => a.id === ACCOUNT)!.invoiceCount).toBe(2);
  });

  it('rolls back the invoice and line items when the counter update fails mid-transaction', async () => {
    const store = makeStore();
    const calls: string[] = [];
    const repo = new BillingRepository(makeClient(store, 'account', { onCall: (m) => calls.push(m) }));

    await expect(repo.createInvoice(input)).rejects.toThrow('injected: account counter update failed');

    expect(calls).toContain('lineItems.createMany');
    expect(calls).toContain('account.update');
    expect(store.invoices).toHaveLength(2);
    expect(store.lineItems).toHaveLength(3);
    expect(store.accounts.find((a) => a.id === ACCOUNT)!.invoiceCount).toBe(2);
  });

  it('skips the line-item batch entirely when there are no line items', async () => {
    const store = makeStore();
    const calls: string[] = [];
    const repo = new BillingRepository(makeClient(store, null, { onCall: (m) => calls.push(m) }));

    await repo.createInvoice({ invoice: input.invoice, lineItems: [] });

    expect(calls).toContain('invoice.create');
    expect(calls).not.toContain('lineItems.createMany');
    expect(store.accounts.find((a) => a.id === ACCOUNT)!.invoiceCount).toBe(3);
  });
});

describe('wire format', () => {
  it('keeps large amounts exact in memory and ships them as decimal strings', async () => {
    const inv = await service().getInvoice(INVOICE_1);
    expect(inv.totalMinor).toBe(9007199254740993n);
    expect(typeof inv.totalMinor).toBe('bigint');

    const wire = serialize(inv) as Record<string, unknown>;
    expect(wire.totalMinor).toBe('9007199254740993');
    const items = wire.lineItems as Array<Record<string, unknown>>;
    expect(items[1].unitPriceMinor).toBe('250000');
  });

  it('returns line items in stored (insertion) order, not by position', async () => {
    const inv = await service().getInvoice(INVOICE_1);
    // The seed inserts positions 3, 1, 2 on purpose; the API must keep that
    // natural order instead of reordering by position.
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Support retainer',
      'Implementation',
      'Training day',
    ]);
  });

  it('keeps the invoice list in stored order', async () => {
    const list = await service().listForAccount(ACCOUNT);
    expect(list.map((i) => i.number)).toEqual(['INV-2024-0001', 'INV-2024-0002']);
  });

  it('keeps issuedAt present-and-null for a draft, and lineItems as an empty array', async () => {
    const inv = await service().getInvoice(INVOICE_2);
    expect(inv).toHaveProperty('issuedAt');
    expect(inv.issuedAt).toBeNull();
    expect(inv.lineItems).toEqual([]);

    const wire = serialize(inv) as Record<string, unknown>;
    expect('issuedAt' in wire).toBe(true);
    expect(wire.issuedAt).toBeNull();
  });

  it('serializes bigints to decimal strings and dates to ISO strings', () => {
    const wire = serialize({
      amount: 123n,
      big: 9007199254740993n,
      at: new Date('2024-04-01T09:00:00Z'),
      nested: [{ a: 1n }],
    }) as Record<string, unknown>;
    expect(wire.amount).toBe('123');
    expect(wire.big).toBe('9007199254740993');
    expect(wire.at).toBe('2024-04-01T09:00:00.000Z');
    expect(wire.nested).toEqual([{ a: '1' }]);
  });
});

describe('behaviour the original suite did not cover', () => {
  it('returns [] (not a 404) for an account id that does not exist', async () => {
    const list = await service().listForAccount(MISSING);
    expect(list).toEqual([]);
  });

  it('throws NotFoundError(invoice_not_found) when issuing a missing invoice', async () => {
    await expect(service().issue(MISSING)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service().issue(MISSING)).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('sets status and issuedAt when issuing', async () => {
    const inv = await service().issue(INVOICE_2);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
  });
});

describe('DrizzleBillingClient (adapter over a fake Drizzle database)', () => {
  function makeThenable<T>(value: T): PromiseLike<T> & { returning: () => PromiseLike<T> } {
    return {
      then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined,
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(value).then(onfulfilled, onrejected);
      },
      returning: () => makeThenable(value),
    };
  }

  function fakeDrizzleDb(store: FakeStore, updateInvoiceReturn: InvoiceRow[]) {
    const calls: string[] = [];

    const queryable = {
      select() {
        return {
          from(_table: unknown) {
            return {
              where(_cond: unknown) {
                const q: Record<string, unknown> = {
                  limit: () => makeThenable(store.invoices.slice(0, 1)),
                };
                q.then = (f?: (v: unknown) => unknown) => Promise.resolve(store.invoices).then(f);
                return q;
              },
            };
          },
        };
      },
      insert(_table: unknown) {
        return {
          values(values: Record<string, unknown> | Record<string, unknown>[]) {
            const list = Array.isArray(values) ? values : [values];
            calls.push(`insert:${list.length}`);
            if ('number' in list[0]) {
              const row = { ...list[0], createdAt: new Date() } as InvoiceRow;
              store.invoices.push(row);
              return makeThenable([row]);
            }
            const rows = list as unknown as LineItemRow[];
            store.lineItems.push(...rows);
            return makeThenable(rows);
          },
        };
      },
      update(_table: unknown) {
        return {
          set(setData: Record<string, unknown>) {
            return {
              where(_cond: unknown) {
                return {
                  returning() {
                    calls.push('update');
                    if ('invoiceCount' in setData) {
                      // The real statement is invoice_count = invoice_count + 1;
                      // the fake applies the increment directly.
                      const a = store.accounts[0];
                      a.invoiceCount += 1;
                      return makeThenable([a]);
                    }
                    return makeThenable(updateInvoiceReturn);
                  },
                };
              },
            };
          },
        };
      },
    };

    return {
      calls,
      ...queryable,
      transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown> {
        calls.push('transaction');
        return fn(queryable);
      },
    };
  }

  it('routes createInvoice through a single db.transaction and keeps amounts as bigint', async () => {
    const store = makeStore();
    const db = fakeDrizzleDb(store, []);
    const client = new DrizzleBillingClient(db as unknown as BillingDb);
    const repo = new BillingRepository(client);

    const created = await repo.createInvoice({
      invoice: {
        id: 'cccccccc-0000-4000-8000-000000000077',
        accountId: ACCOUNT,
        number: 'INV-2024-0077',
        status: 'draft',
        totalMinor: 9007199254740993n,
        issuedAt: null,
      },
      lineItems: [
        {
          id: 'dddddddd-0000-4000-8000-000000000077',
          invoiceId: 'cccccccc-0000-4000-8000-000000000077',
          position: 1,
          description: 'Consulting',
          quantity: 1,
          unitPriceMinor: 9007199254740993n,
        },
      ],
    });

    expect(db.calls).toContain('transaction');
    expect(created.totalMinor).toBe(9007199254740993n);
    expect(typeof created.totalMinor).toBe('bigint');
    expect(store.invoices.some((i) => i.id === 'cccccccc-0000-4000-8000-000000000077')).toBe(true);
    expect(store.lineItems.some((li) => li.invoiceId === 'cccccccc-0000-4000-8000-000000000077')).toBe(true);
    expect(store.accounts.find((a) => a.id === ACCOUNT)!.invoiceCount).toBe(3);
  });

  it('resolves null when the invoice update matches no row (feeds the 404 path)', async () => {
    const db = fakeDrizzleDb(makeStore(), []);
    const client = new DrizzleBillingClient(db as unknown as BillingDb);

    await expect(
      client.invoice.update({ where: { id: MISSING }, data: { status: 'issued' } }),
    ).resolves.toBeNull();
  });
});
```
