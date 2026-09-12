# repair1-set

## reasoning

```
Let me look at the error:

```
test/billing.spec.ts(223,8): error TS1128: Declaration or statement expected.
```

This means there's a syntax error at line 223, column 8 in `test/billing.spec.ts`.

Let me count the lines in the file provided:

Looking at the test file, let me count lines carefully. The file content is provided in the reference. Let me count to line 223.

Let me recount by looking at the structure:

```
1: import { describe, expect, it } from 'vitest';
2: import { ConflictError, NotFoundError } from '../src/common/errors.js';
3: import { serialize } from '../src/common/serializer.js';
4: import { BillingRepository } from '../src/billing/billing.repository.js';
5: import { BillingService } from '../src/billing/billing.service.js';
6: import type { Db } from '../src/billing/db.js';
7: import {
8:   accounts,
9:   invoiceLineItems,
10:   invoices,
11:   type AccountRow,
12:   type InvoiceRow,
13:   type LineItemRow,
14: } from '../src/billing/schema.js';
15: import { seed } from './seed.js';
16: (empty)
17: const ACCOUNT_NORTHWIND = '11111111-1111-4111-8111-111111111111';
18: const ACCOUNT_CONTOSO = '22222222-2222-4222-8222-222222222222';
19: const INVOICE_ISSUED = 'aaaaaaaa-0000-4000-8000-000000000001';
20: const INVOICE_DRAFT = 'aaaaaaaa-0000-4000-8000-000000000002';
21: (empty)
22: /**
23:  * In-memory stand-in for the Drizzle client, in the spirit of the old fake
24:  * Prisma client. It switches on the real table objects the repository passes
25:  * in, and simulates the database semantics the ported behavior hinged on:
26:  *   * zero-row updates RESOLVE (Drizzle never throws the P2025 equivalent),
27:  *   * unique violations surface as SQLSTATE 23505,
28:  *   * selects without ORDER BY come back in storage order,
29:  *   * transaction() rolls the store back on rejection.
30:  */
31: (empty)
32: interface Store {
33:   accounts: AccountRow[];
34:   invoices: InvoiceRow[];
35:   items: LineItemRow[];
36: }
37: (empty)
38: interface FakeDbConfig {
39:   /** Account id passed to findAccount, and used to filter listInvoices. */
40:   accountId?: string;
41:   /** Invoice id passed to findInvoice / findLineItems. */
42:   invoiceId?: string;
43:   /** Invoice id passed to markIssued. */
44:   issuedId?: string;
45:   /** Simulate a constraint failure on the line item insert in createInvoice. */
46:   failLineItemInsert?: boolean;
47:   /** Simulate a failure on the account counter update in createInvoice. */
48:   failCounterUpdate?: boolean;
49: }
50: (empty)
51: type Row = AccountRow | InvoiceRow | LineItemRow;
52: (empty)
53: class FakeSelect {
54:   private table: unknown = undefined;
55:   private ordered = false;
56:   private limited = false;
57: (empty)
58:   constructor(private readonly store: Store, private readonly cfg: FakeDbConfig) {}
59: (empty)
60:   from(t: unknown) {
61:     this.table = t;
62:     return this;
63:   }
64: (empty)
65:   where(_cond: unknown) {
66:     return this;
67:   }
68: (empty)
69:   orderBy(_order: unknown) {
70:     this.ordered = true;
71:     return this;
72:   }
73: (empty)
74:   limit(_n: number) {
75:     this.limited = true;
76:     return this;
77:   }
78: (empty)
79:   then<TResult1 = Row[], TResult2 = never>(
80:     onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
81:     onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
82:   ): Promise<TResult1 | TResult2> {
83:     return Promise.resolve(this.rows()).then(onfulfilled ?? undefined, onrejected ?? undefined);
84:   }
85: (empty)
86:   private rows(): Row[] {
87:     if (this.table === accounts) {
88:       return this.store.accounts.filter((a) => a.id === this.cfg.accountId);
89:     }
90:     if (this.table === invoices) {
91:       // findInvoice queries by primary key (with limit); listInvoices by account.
92:       return this.limited
93:         ? this.store.invoices.filter((i) => i.id === this.cfg.invoiceId)
94:         : this.store.invoices.filter((i) => i.accountId === this.cfg.accountId);
95:     }
96:     if (this.table === invoiceLineItems) {
97:       const rows = this.store.items.filter((li) => li.invoiceId === this.cfg.invoiceId);
98:       // A real database returns rows in physical order unless the query says
99:       // otherwise; honor ORDER BY only when the repository asked for it.
100:       return this.ordered ? [...rows].sort((a, b) => a.position - b.position) : rows;
101:     }
102:     throw new Error('fake db: unexpected select target');
103:   }
104: }
105: (empty)
106: class FakeInsertResult {
107:   constructor(private readonly rows: unknown[]) {}
108: (empty)
109:   then<TResult1 = unknown[], TResult2 = never>(
110:     onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
111:     onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
112:   ): Promise<TResult1 | TResult2> {
113:     return Promise.resolve(this.rows).then(onfulfilled ?? undefined, onrejected ?? undefined);
114:   }
115: (empty)
116:   returning() {
117:     return this;
118:   }
119: }
120: (empty)
121: class FakeInsert {
122:   constructor(
123:     private readonly table: unknown,
124:     private readonly store: Store,
125:     private readonly cfg: FakeDbConfig,
126:   ) {}
127: (empty)
128:   values(data: unknown): FakeInsertResult {
129:     if (this.table === invoices) {
130:       const incoming = (Array.isArray(data) ? data : [data]) as Array<Omit<InvoiceRow, 'createdAt'>>;
131:       for (const v of incoming) {
132:         if (this.store.invoices.some((i) => i.number === v.number)) {
133:           // Same shape as a real Postgres unique violation (SQLSTATE 23505).
134:           throw Object.assign(
135:             new Error('duplicate key value violates unique constraint "invoices_number_key"'),
136:             { code: '23505' },
137:           );
138:         }
139:       }
140:       const rows = incoming.map((v) => ({ ...v, createdAt: new Date() }));
141:       this.store.invoices.push(...rows);
142:       return new FakeInsertResult(rows);
143:     }
144:     if (this.table === invoiceLineItems) {
145:       if (this.cfg.failLineItemInsert) throw new Error('injected failure: line item insert');
146:       const rows = Array.isArray(data) ? data : [data];
147:       this.store.items.push(...(rows as LineItemRow[]));
148:       return new FakeInsertResult(rows);
149:     }
150:     throw new Error('fake db: unexpected insert target');
151:   }
152: }
153: (empty)
154: class FakeUpdate {
155:   private data: Record<string, unknown> = {};
156: (empty)
157:   constructor(
158:     private readonly table: unknown,
159:     private readonly store: Store,
160:     private readonly cfg: FakeDbConfig,
161:   ) {}
162: (empty)
163:   set(d: Record<string, unknown>) {
164:     this.data = d;
165:     return this;
166:   }
167: (empty)
168:   where(_cond: unknown) {
169:     return this;
170:   }
171: (empty)
172:   returning() {
173:     return this;
174:   }
175: (empty)
176:   then<TResult1 = unknown[], TResult2 = never>(
177:     onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
178:     onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
179:   ): Promise<TResult1 | TResult2> {
180:     return Promise.resolve(this.run()).then(onfulfilled ?? undefined, onrejected ?? undefined);
181:   }
182: (empty)
183:   private run(): unknown[] {
184:     if (this.table === invoices) {
185:       const target = this.store.invoices.find((i) => i.id === this.cfg.issuedId);
186:       if (!target) return []; // zero-row update resolves; it does not throw
187:       Object.assign(target, this.data);
188:       return [target];
189:     }
190:     if (this.table === accounts) {
191:       if (this.cfg.failCounterUpdate) throw new Error('injected failure: account counter');
192:       // The only account update in this service: +1 on the invoice counter of
193:       // the account that owns the invoice created in the same transaction.
194:       const lastInvoice = this.store.invoices[this.store.invoices.length - 1];
195:       const target = lastInvoice
196:         ? this.store.accounts.find((a) => a.id === lastInvoice.accountId)
197:         : undefined;
198:       if (!target) return [];
199:       target.invoiceCount += 1;
200:       return [target];
201:     }
202:     throw new Error('fake db: unexpected update target');
203:   }
204: }
205: (empty)
206: function makeDb(cfg: FakeDbConfig = {}) {
207:   const store: Store = freshStore();
208:   const fake = {
209:     select: () => new FakeSelect(store, cfg),
210:     insert: (table: unknown) => new FakeInsert(table, store, cfg),
211:     update: (table: unknown) => new FakeUpdate(table, store, cfg),
212:     transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
213:       const accountsBefore = structuredClone(store.accounts);
214:       const invoicesBefore = structuredClone(store.invoices);
215:       const itemsBefore = structuredClone(store.items);
216:       try {
217:         return await fn(fake);
218:       } catch (err) {
219:         store.accounts = accountsBefore;
220:         store.invoices = invoicesBefore;
221:         store.items = itemsBefore;
222:         throw err;
223:       },
224:     },
225:   };
226:   return { db: fake as unknown as Db, store };
227: }
```

Wait, let me recount. Line 223 would be... let me be more careful.

Actually, let me look at the structure more carefully. The error is at line 223, column 8. Let me look at what's around there.

Looking at the `makeDb` function:

```
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
      },
    },
  };
  return { db: fake as unknown as Db, store };
}
```

The issue is `throw err;` followed by `},` — the catch block ends with `}` and then there's a trailing comma. But wait, that's inside an object literal property value (the `transaction` property). Let me look more carefully:

```
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      ...
      try {
        return await fn(fake);
      } catch (err) {
        store.accounts = accountsBefore;
        store.invoices = invoicesBefore;
        store.items = itemsBefore;
        throw err;
      },       <-- This is the problem!
    },
```

Wait no. The `catch` block ends with `}`. Then the arrow function body ends with `}`. Then the property ends with `,`. So it should be:

```
      } catch (err) {
        store.accounts = accountsBefore;
        store.invoices = invoicesBefore;
        store.items = itemsBefore;
        throw err;
      }
    },
```

But in the provided code, it shows:
```
        throw err;
      },
    },
```

That `},` after the catch block is wrong. The catch block's closing brace should be just `}` (no comma), because it's a statement block, not an object property. The comma belongs only on the closing `}` of the arrow function (which is the value of the `transaction` property in the object literal).

So the fix is: change `},` (line 223) to `}`.

Wait, let me re-examine. The structure is:

```
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
      },      // <-- BUG: this should be just }
    },
  };
```

Yes! The catch block is a statement, not a property in an object. The `}` closing the catch block should not have a comma. The comma is only valid on the `}` that closes the arrow function body (which is the value of the `transaction` property).

So the fix is to change `      },` to `      }` on that line.

Now let me produce the complete file with this one-character fix.
```

## reply

Looking at the error at line 223, column 8 in `test/billing.spec.ts`: the `catch` block's closing brace has a trailing comma (`},`) as if it were an object property, but it's a statement block. It should be just `}`.

### test/billing.spec.ts
```ts
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
    expect(inv.lineItems.map((li) => li.position)).toEqual([1, 2, 3]);
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
```
