# repair2-set

## reasoning

```
Let me analyze the errors:

1. `test/billing.spec.ts(3,10): error TS2724: '"@electric-sql/pglite"' has no exported member named 'Pglite'. Did you mean 'PGlite'?`
   - The import uses `Pglite` but the package exports `PGlite`. Fix: change `Pglite` to `PGlite`.

2. `test/billing.spec.ts(79,41): error TS2339: Property 'position' does not exist on type '{ description: string; quantity: number; unitPriceMinor: bigint; }'`
   - This is in the test that checks line items. Let me look at line 79 in context. The test `returns line items in storage order (no ORDER BY in either stack)` does:
   ```ts
   expect(inv.lineItems.map((li) => li.position)).toEqual([3, 1, 2]);
   ```
   
   The issue is that `li` doesn't have a `position` property according to the type. This means the `lineItems` field on the invoice object returned by `getInvoice` doesn't include `position` in its type. 

   Wait, but I can only fix what the compiler requires. The compiler says `position` doesn't exist on the type `{ description: string; quantity: number; unitPriceMinor: bigint; }`. This means the service's return type for line items doesn't include `position`. 

   But wait - the task says "Change exactly what the compiler requires." and "When two files disagree about a name, a signature or a type, one of them is the definition. Change the caller unless the definition is the thing the errors say is wrong."

   So the definition is in the service/repository, and the test is the caller. The test expects `position` to be on line items. If the service's type doesn't include `position`, I need to look at what the service returns.

   Actually, I don't have access to the service file or the schema file. But the error is clear: the type of `li` in `inv.lineItems` is `{ description: string; quantity: number; unitPriceMinor: bigint; }` — it's missing `position`.

   Since I can only see the test file and the error, and the instruction says to change the caller unless the definition is wrong... but actually, the test is testing correct behavior (line items should have positions). The issue is likely that the repository or service isn't selecting `position` from the database.

   But I can only return files I changed, and I need to fix the type error. Since I don't have the source files (service, repository, schema), I need to think about what I can fix here.

   Wait, let me re-read the instructions: "Return only the files you changed." I can only see `test/billing.spec.ts` in the errors. Let me look at what's available.

   Actually, looking more carefully at the error - the type `{ description: string; quantity: number; unitPriceMinor: bigint; }` is the inferred type of the line items. This suggests that somewhere in the code, the line items are being mapped/returned without the `position` field.

   But I only have access to the test file in the error list. The other files (service, repository, schema) aren't shown as having errors. So the fix must be in the test file.

   Hmm, but the test is asserting correct behavior. If the service doesn't return `position`, that's a bug in the service, not the test.

   Wait - let me re-read: "Change the caller unless the definition is the thing the errors say is wrong." The definition here would be the service/repository return type. The test is the caller. So I should change the test?

   But that would mean removing the `position` assertion, which would be wrong because the test is verifying correct behavior.

   Actually, I think I'm overthinking this. Let me look at this differently. The test file references `li.position` and the type doesn't have it. The fix could be:
   1. Add `position` to the return type in the service/repository (but I don't have those files)
   2. Cast in the test
   3. The type is correct and `position` genuinely isn't returned (meaning the test is wrong)

   Given that I can only modify files that appear in the error list, and only `test/billing.spec.ts` appears there, I need to fix it in the test. But the test is correct behavior-wise...

   Actually wait - I need to look at this more carefully. The test file IS the file with the error. I need to make it compile. The service returns line items without `position` in its type. The test accesses `.position`. 

   Since I can only change the test file (it's the only one in the error list), and the test's intent is to verify that positions are preserved, I should cast the line items to include the position field, or use a type assertion.

   Actually, the simplest fix that preserves the test's intent while making it compile: cast `inv.lineItems` to include position. Something like:

   ```ts
   expect((inv.lineItems as Array<{ position: number }>).map((li) => li.position)).toEqual([3, 1, 2]);
   ```

   But that's ugly. A better approach: since the test is verifying behavior that the type system says isn't there, I can use a type assertion on the whole invoice or just the line items.

   Hmm, but actually let me reconsider. The problem statement says "Fix all of them in one reply" and "Return only the files you changed." The only file with errors is `test/billing.spec.ts`. So I need to fix both errors in that file.

   For error 1: Change `Pglite` to `PGlite` (the type reference too).
   For error 2: The line items type doesn't include `position`. I need to make the access type-safe.

   Let me write the complete file with both fixes:
   1. `Pglite` → `PGlite` (both the import and the type annotation)
   2. For `li.position` - I'll cast the line items array to include the position property.

   Wait, actually I should look at this more carefully. The variable `client` is typed as `Pglite` on line 28. That also needs to change to `PGlite`.

   Let me write out the complete file with both fixes applied.
```

## reply

### test/billing.spec.ts
```ts
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGLite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import type { Db } from '../src/billing/db.js';
import { accounts, invoiceLineItems, invoices } from '../src/billing/schema.js';
import { ConflictError, NotFoundError, mapDbError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { seed } from './seed.js';

// Well-formed UUIDs that match no seeded row. A malformed id ('missing')
// fails the uuid cast in BOTH the old (Prisma) and the new (Drizzle/Postgres)
// stack — a 500, never a 404 — so the not-found contract is pinned with
// valid, non-existent UUIDs.
const MISSING_UUID = 'ffffffff-9999-4999-8999-999999999999';
const NORTHWIND = '11111111-1111-4111-8111-111111111111';
const CONTOSO = '22222222-2222-4222-8222-222222222222';
const INV_0001 = 'aaaaaaaa-0000-4000-8000-000000000001';
const INV_0002 = 'aaaaaaaa-0000-4000-8000-000000000002';

// Resolved from this file, not from process.cwd().
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

const schema = { accounts, invoices, invoiceLineItems };

let client: PGLite;
let db: PgliteDatabase<typeof schema>;
let repo: BillingRepository;
let svc: BillingService;

async function seedDb(): Promise<void> {
  await db.insert(accounts).values(
    seed.accounts.map(({ id, name, currency, invoiceCount }) => ({ id, name, currency, invoiceCount })),
  );
  await db.insert(invoices).values(seed.invoices);
  await db.insert(invoiceLineItems).values(seed.lineItems);
}

async function accountCount(id: string): Promise<number> {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id));
  return rows[0].invoiceCount;
}

beforeAll(async () => {
  client = new PGLite();
  db = drizzle(client, { schema });
  // Same migration files the production `drizzle-kit migrate` runs.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // pglite (test) and node-postgres (prod) expose the same pg query surface;
  // the repository is typed against the production driver.
  repo = new BillingRepository(db as unknown as Db);
  svc = new BillingService(repo);
});

beforeEach(async () => {
  await client.query('TRUNCATE "invoice_line_items", "invoices", "accounts" CASCADE');
  await seedDb();
});

describe('getInvoice', () => {
  it('returns an invoice with its line items', async () => {
    const inv = await svc.getInvoice(INV_0001);
    expect(inv.number).toBe('INV-2024-0001');
    expect(inv.lineItems).toHaveLength(3);
  });

  it('throws NotFoundError with code invoice_not_found for a missing invoice', async () => {
    await expect(svc.getInvoice(MISSING_UUID)).rejects.toThrow(NotFoundError);
    await expect(svc.getInvoice(MISSING_UUID)).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('returns line items in storage order (no ORDER BY in either stack)', async () => {
    // seed inserts positions 3, 1, 2 on purpose
    const inv = await svc.getInvoice(INV_0001);
    expect((inv.lineItems as Array<{ position: number }>).map((li) => li.position)).toEqual([3, 1, 2]);
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Support retainer',
      'Implementation',
      'Training day',
    ]);
  });

  it('keeps issuedAt as null (field present) for drafts', async () => {
    const inv = await svc.getInvoice(INV_0002);
    expect(inv.issuedAt).toBeNull();
    expect(JSON.stringify(serialize(inv))).toContain('"issuedAt":null');
  });

  it('round-trips bigint money past Number.MAX_SAFE_INTEGER as decimal strings', async () => {
    const inv = await svc.getInvoice(INV_0001);
    expect(inv.totalMinor).toBe(9007199254740993n);
    const json = JSON.stringify(serialize(inv));
    expect(json).toContain('"totalMinor":"9007199254740993"');
    expect(json).toContain('"unitPriceMinor":"50000"');
  });
});

describe('listForAccount', () => {
  it('lists invoices for an account', async () => {
    const list = await svc.listForAccount(NORTHWIND);
    expect(list).toHaveLength(2);
  });

  it('returns raw rows with the same fields as before', async () => {
    const [first] = await svc.listForAccount(NORTHWIND);
    expect(Object.keys(first).sort()).toEqual([
      'accountId',
      'createdAt',
      'id',
      'issuedAt',
      'number',
      'status',
      'totalMinor',
    ]);
    expect(first.id).toBe(INV_0001);
    expect(first.issuedAt).toBeInstanceOf(Date);
    expect(typeof first.totalMinor).toBe('bigint');
  });

  it('returns an empty list for an account with no invoices', async () => {
    expect(await svc.listForAccount(CONTOSO)).toEqual([]);
  });

  it('returns an empty list (not 404) for a missing account', async () => {
    // the dashboard calls this before the account row exists for fresh tenants
    expect(await svc.listForAccount(MISSING_UUID)).toEqual([]);
  });
});

describe('issue', () => {
  it('marks an invoice issued and leaves the account counter alone', async () => {
    const inv = await svc.issue(INV_0002);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
    expect(inv.number).toBe('INV-2024-0002');
    expect(inv.totalMinor).toBe(125000n);
    expect(await accountCount(NORTHWIND)).toBe(2);
  });

  it('throws NotFoundError with code invoice_not_found for a missing invoice', async () => {
    await expect(svc.issue(MISSING_UUID)).rejects.toThrow(NotFoundError);
    await expect(svc.issue(MISSING_UUID)).rejects.toMatchObject({ code: 'invoice_not_found' });
  });
});

describe('createInvoice (repository)', () => {
  it('writes invoice + line items + account counter atomically', async () => {
    const newInv = 'cccccccc-0000-4000-8000-000000000001';
    const created = await repo.createInvoice({
      invoice: {
        id: newInv,
        accountId: CONTOSO,
        number: 'INV-2024-0003',
        status: 'draft',
        totalMinor: 9007199254740993n,
        issuedAt: null,
      },
      lineItems: [
        { id: 'dddddddd-0000-4000-8000-000000000001', invoiceId: newInv, position: 1, description: 'Alpha', quantity: 1, unitPriceMinor: 100n },
        { id: 'dddddddd-0000-4000-8000-000000000002', invoiceId: newInv, position: 2, description: 'Beta', quantity: 3, unitPriceMinor: 200n },
      ],
    });

    expect(created.id).toBe(newInv);
    expect(created.status).toBe('draft');
    expect(created.totalMinor).toBe(9007199254740993n);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect((await repo.findLineItems(newInv)).map((li) => li.position)).toEqual([1, 2]);
    expect(await accountCount(CONTOSO)).toBe(1); // was 0
    expect(await accountCount(NORTHWIND)).toBe(2); // untouched
  });

  it('rolls back the whole transaction when a line item insert fails mid-transaction', async () => {
    const poisonInv = 'cccccccc-0000-4000-8000-000000000002';
    await expect(
      repo.createInvoice({
        invoice: {
          id: poisonInv,
          accountId: CONTOSO,
          number: 'INV-2024-0004',
          status: 'draft',
          totalMinor: 5n,
          issuedAt: null,
        },
        // injected failure: line item references an invoice that does not exist
        lineItems: [
          { id: 'dddddddd-0000-4000-8000-000000000009', invoiceId: MISSING_UUID, position: 1, description: 'Poison', quantity: 1, unitPriceMinor: 1n },
        ],
      }),
    ).rejects.toThrow(/violates foreign key constraint/);

    // the invoice insert (step 1) and the counter bump (step 3) are rolled back
    expect(await repo.findInvoice(poisonInv)).toBeNull();
    expect(await repo.findLineItems(poisonInv)).toEqual([]);
    expect(await accountCount(CONTOSO)).toBe(0);
  });

  it('accepts an invoice with zero line items (createMany no-op, as before)', async () => {
    const created = await repo.createInvoice({
      invoice: {
        id: 'cccccccc-0000-4000-8000-000000000003',
        accountId: CONTOSO,
        number: 'INV-2024-0005',
        status: 'draft',
        totalMinor: 10n,
        issuedAt: null,
      },
      lineItems: [],
    });
    expect(created.number).toBe('INV-2024-0005');
    expect(await repo.findLineItems(created.id)).toEqual([]);
  });

  it('rejects a duplicate invoice number (unique constraint)', async () => {
    await expect(
      repo.createInvoice({
        invoice: {
          id: 'cccccccc-0000-4000-8000-000000000004',
          accountId: CONTOSO,
          number: 'INV-2024-0001',
          status: 'draft',
          totalMinor: 1n,
          issuedAt: null,
        },
        lineItems: [],
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
    expect(await accountCount(CONTOSO)).toBe(0);
  });
});

describe('mapDbError', () => {
  it('maps a unique violation (SQLSTATE 23505, old P2002) to invoice_number_taken', () => {
    const mapped = mapDbError({ code: '23505', message: 'duplicate key value violates unique constraint' });
    expect(mapped).toBeInstanceOf(ConflictError);
    expect((mapped as ConflictError).code).toBe('invoice_number_taken');
  });

  it('passes anything else through unchanged', () => {
    const original = new Error('boom');
    expect(mapDbError(original)).toBe(original);
    expect(mapDbError('stringy')).toBeInstanceOf(Error);
  });
});

describe('schema defaults and constraints', () => {
  it('applies the Prisma defaults (status draft, invoice_count 0, created_at now())', async () => {
    const accId = '99999999-0000-4000-8000-000000000001';
    await db.insert(accounts).values({ id: accId, name: 'Defaults', currency: 'GBP' });
    const acc = await db.select().from(accounts).where(eq(accounts.id, accId));
    expect(acc[0].invoiceCount).toBe(0);
    expect(acc[0].createdAt).toBeInstanceOf(Date);
    expect(acc[0].currency).toBe('GBP');

    const invId = '88888888-0000-4000-8000-000000000001';
    await db.insert(invoices).values({ id: invId, accountId: accId, number: 'INV-2024-0200', totalMinor: 7n });
    const inv = await db.select().from(invoices).where(eq(invoices.id, invId));
    expect(inv[0].status).toBe('draft');
    expect(inv[0].issuedAt).toBeNull();
    expect(inv[0].createdAt).toBeInstanceOf(Date);
  });

  it('cascades line items when their invoice is deleted', async () => {
    await db.delete(invoices).where(eq(invoices.id, INV_0001));
    expect(await repo.findLineItems(INV_0001)).toEqual([]);
  });
});
```
