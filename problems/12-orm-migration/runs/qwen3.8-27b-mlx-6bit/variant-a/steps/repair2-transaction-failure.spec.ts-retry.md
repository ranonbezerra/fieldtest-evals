# repair2-transaction-failure.spec.ts-retry

## reply

Let me analyze the compiler errors for `test/transaction-failure.spec.ts`:

1. Line 2: `Cannot find module '@nestjs/testing'` — need to add `.js` extension? No, this is a package import. The issue is likely that `@nestjs/testing` isn't installed or the tsconfig doesn't have it in types. But wait, looking at other files like `test/validate-quantity.spec.ts` which also imports `@nestjs/testing` and has the same error — this suggests it's a workspace-level issue. But I'm only asked to fix `test/transaction-failure.spec.ts`.

Wait, let me re-read the instructions: "Rewrite `test/transaction-failure.spec.ts` complete, fixing what these messages require of this file."

So I need to fix the errors that are in `test/transaction-failure.spec.ts`. Let me list them:

- Line 2: `Cannot find module '@nestjs/testing'` — TS2307
- Line 3: `Cannot find module '@nestjs/common'` — TS2307
- Line 4: `Cannot find module '../src/db/database.module'` — TS2307
- Line 5: `Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/db/client.js'?` — TS2835
- Line 6: `Cannot find module 'drizzle-orm'` — TS2307
- Line 7: `Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/db/schema.js'?` — TS2835
- Line 8: `Cannot find module '../src/accounts/accounts.repository'` — TS2307
- Line 9: `Cannot find module '../src/invoices/invoices.repository'` — TS2307
- Line 10: `Cannot find module 'node:crypto'` — TS2307

Now, the TS2835 errors are clear: I need to add `.js` extensions to relative imports. So:
- `'../src/db/client'` → `'../src/db/client.js'`
- `'../src/db/schema'` → `'../src/db/schema.js'`

The TS2307 errors for `@nestjs/testing`, `@nestjs/common`, `drizzle-orm`, `node:crypto` — these are module resolution errors. For the node built-in modules (`node:crypto`), this might be a tsconfig issue (missing `@types/node`). For package imports, it could be that the packages aren't installed or the tsconfig `moduleResolution` doesn't find them.

But wait — looking at the other test files, they have the same errors for `@nestjs/testing`, `@nestjs/common`, `supertest`. This suggests it's a workspace-level issue that I can't fix by just changing this file. However, the instruction says "fixing what these messages require of this file."

For the relative imports that produce TS2307 (lines 4, 8, 9), these might also need `.js` extensions. Let me think:
- `'../src/db/database.module'` — TS2307 (cannot find module)
- `'../src/accounts/accounts.repository'` — TS2307
- `'../src/invoices/invoices.repository'` — TS2307

With `moduleResolution: node16/nodenext`, relative imports need explicit extensions. So these should be:
- `'../src/db/database.module.js'`
- `'../src/accounts/accounts.repository.js'`
- `'../src/invoices/invoices.repository.js'`

But wait, line 5 and 7 already have the TS2835 error (which is specifically about missing extensions), while lines 4, 8, 9 have TS2307 (cannot find module). This is interesting. Maybe the files at those paths don't exist? Or maybe with node16 resolution, without the extension, it just can't find them at all (TS2307 instead of TS2835).

Actually, looking more carefully: TS2835 is specifically "Relative import paths need explicit file extensions" — this is a different error from TS2307. TS2835 means TypeScript found the module but is complaining about the missing extension. TS2307 means it can't find the module at all.

Hmm, but that's contradictory. If the file exists, it should give TS2835, not TS2307. Unless the file doesn't exist at that path.

Wait, let me reconsider. Maybe with `moduleResolution: node16`, when you have a relative import without an extension, TypeScript gives TS2307 because it literally can't resolve it (it doesn't do extension guessing in node16 mode). The TS2835 might be a different diagnostic that's also emitted. Or maybe the distinction is:
- TS2835: the file exists but needs an extension
- TS2307: the file doesn't exist at all

Looking at the plan manifest:
- `src/db/database.module.ts` exists ✓
- `src/accounts/accounts.repository.ts` exists ✓
- `src/invoices/invoices.repository.ts` exist ✓

So all these files should exist. The fact that some get TS2835 and others get TS2307 is confusing. Let me just add `.js` extensions to all relative imports, which should fix both TS2835 and potentially TS2307 (if TS2307 is caused by the missing extension in node16 mode).

Actually, I think what's happening is:
- Lines 5 and 7 use `import { ... } from '../src/db/client'` and `import { ... } from '../src/db/schema'` — these are value imports (importing bindings), and TypeScript gives TS2835.
- Lines 4, 8, 9 might use `import type` or the module just can't be resolved for some other reason.

You know what, let me just add `.js` to all relative imports. That's the correct fix for node16/nodenext resolution.

For the package-level TS2307 errors (`@nestjs/testing`, `@nestjs/common`, `drizzle-orm`, `node:crypto`), these are likely workspace-level issues (missing `@types/node`, or packages not in `node_modules`). I can't fix these from within this file alone. But the instruction says "fixing what these messages require of this file" — so I should fix what I can from within this file.

The things I CAN fix from within this file:
1. Add `.js` extensions to all relative imports (fixes TS2835 on lines 5, 7, and potentially TS2307 on lines 4, 8, 9)

The things I CANNOT fix from within this file:
- `@nestjs/testing` not found (TS2307) — workspace issue
- `@nestjs/common` not found (TS2307) — workspace issue
- `drizzle-orm` not found (TS2307) — workspace issue
- `node:crypto` not found (TS2307) — likely missing `@types/node`

Wait, but the instruction says "fixing what these messages require of this file." If the module simply isn't installed, I can't fix it from within the file. But if adding the right import specifier would help... no, `@nestjs/testing` is a bare specifier, there's no extension to add.

Let me just focus on what I can fix: the relative import paths need `.js` extensions. I'll rewrite the file with proper `.js` extensions on all relative imports.

Now let me write the test based on the PLAN:

The plan says `test/transaction-failure.spec.ts` should have two tests:
1. "rolls back invoice on line-item insert failure" — Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged
2. "rolls back when account row missing" — Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted

Let me write this test. I need to:
- Import from `@nestjs/testing` for test module
- Import from `@nestjs/common` for decorators
- Import the database module
- Import the drizzle client factory
- Import the schema for query building
- Import repositories
- Import `node:crypto` for randomUUID

Let me structure the test:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseModule } from '../src/db/database.module.js';
import { createDb, DrizzleDb } from '../src/db/client.js';
import { eq, and, sql } from 'drizzle-orm';
import { accounts, invoices, lineItems } from '../src/db/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { InvoicesRepository, CreateInvoiceTxArgs } from '../src/invoices/invoices.repository.js';
import { randomUUID } from 'node:crypto';

// ... tests
```

Wait, but if `drizzle-orm` can't be found (TS2307), I still need to import it. The instruction says fix what the messages require of this file. The TS2307 for `drizzle-orm` means the module isn't resolvable — I can't fix that from within the file. Same for `@nestjs/testing`, `@nestjs/common`, `node:crypto`.

So my fix is: add `.js` extensions to all relative imports. That addresses TS2835 on lines 5 and 7, and the TS2307 on lines 4, 8, 9 (which are likely also caused by missing extensions in node16 mode).

Let me write the complete file now. I'll base it on what the plan specifies for these two tests.

For test 1: "rolls back invoice on line-item insert failure"
- I need to create a scenario where the line item insert fails mid-transaction
- One approach: use a mock/fake that throws on the second insert
- Another approach: actually trigger a constraint violation (e.g., insert a line item with an invalid FK)
- The plan says "Monkey-patch a query inside the tx to throw"

Actually, the simplest approach that actually tests real behavior would be to:
1. Create a valid account
2. Try to create an invoice where the line item insert would fail (e.g., the account doesn't exist for FK, but that's already checked... hmm)

Wait, let me think about this differently. The plan says "Monkey-patch a query inside the tx to throw." So I need to intercept the database transaction and make one of the queries fail.

One clean way: use Drizzle's transaction callback and spy/mock the `tx` object's methods. Or, I could use a real constraint violation.

Actually, a cleaner approach for a real integration test:
- For test 1: Create an invoice where the line_items insert fails due to a constraint. For example, if I set up the schema with a CHECK constraint on `quantity > 0`, I could try to insert a line item with quantity 0. But wait, the plan says validation happens before the repo call...

Hmm, let me think again. The most straightforward approach for "monkey-patch a query inside the tx to throw":

I can use `vi.spyOn` on the db instance to intercept the transaction and make the second query (line items insert) throw.

Actually, let me think about what Drizzle's transaction looks like:
```typescript
db.transaction(async (tx) => {
  // step 1: insert invoice
  const [invoice] = await tx.insert(invoices).values(...).returning();
  // step 2: insert line items
  await tx.insert(lineItems).values(...);
  // step 3: update account
  await tx.update(accounts).set(...).where(...);
  return invoice;
});
```

To monkey-patch, I could spy on the `tx` object. But that's implementation-specific.

A better approach: use a real database constraint to force the failure. For example:
- If the `line_items` table has a CHECK constraint (like `quantity > 0`), and I somehow bypass the service validation to insert a line item with quantity = 0, the database would reject it.

But wait, the plan says validation happens in the controller/service layer before calling the repository. So I'd need to call the repository directly with invalid data.

Actually, let me re-read the plan: "Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged"

I think the cleanest approach is:
1. Create the test module with real database
2. In the test, directly call `InvoicesRepository.createWithLineItems` with a setup where the line items insert will fail at the DB level

OR use `vi.spyOn` to intercept.

Let me go with a practical approach: I'll spy on the Drizzle db's `transaction` method to intercept the tx and make the second query fail. Or better yet, I'll use a real constraint violation.

Actually, the simplest and most robust approach: 
- For test 1: Call `createWithLineItems` with a line item that has an invalid FK (invoice_id pointing to a non-existent invoice). Wait, no — the line item's invoice_id is set to the newly created invoice within the same transaction, so it should be valid.

Let me think differently. What if I make the line item description exceed some max length? No, there's no length constraint defined.

OK here's another approach: What about making the `unit_price_cents` so large that `line_total_cents` overflows bigint? That's unlikely in practice.

The most practical approach for a unit/integration test is to mock at the right level. Let me use `vi.spyOn` on the repository's db instance to intercept the transaction.

Actually, you know what, let me just use a simpler approach:
- Create the app with real DB
- For test 1: Use `vi.spyOn` on the drizzle instance's `transaction` method to wrap it and throw on the second query
- For test 2: Delete the account after creating it but before the tx runs (race condition simulation), or better: use a non-existent account_id

Wait, for test 2 "rolls back when account row missing" — this is simpler. I just need to call `createWithLineItems` with an `account_id` that doesn't exist in the accounts table. The UPDATE at step 3 will affect 0 rows, and the repository should throw, causing rollback.

For test 1, let me use `vi.spyOn`. Here's my approach:

```typescript
// Get the db instance from the module
const db: DrizzleDb = app.get(DatabaseModule.DB);

// Spy on transaction to intercept
const originalTransaction = db.transaction.bind(db);
vi.spyOn(db, 'transaction').mockImplementation(async (fn) => {
  // Create a proxy that throws on the second query
  let callCount = 0;
  return originalTransaction(async (tx) => {
    // We need to intercept the second .insert() call...
  });
});
```

Hmm, this is getting complex. Let me think of a cleaner way.

Actually, the cleanest approach: I'll create a wrapper around the transaction that provides a `tx` object where I can control when things fail.

Or even simpler: I can just test the behavior by:
1. Creating an account
2. Calling `createWithLineItems` with a line item that will cause a DB-level failure

What DB-level failures can I trigger?
- If I set up the test so that the `line_items` table doesn't exist → but that's too drastic
- If I use a trigger... no, too complex

OK, let me just go with the spy approach. Here's my plan:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule, DB } from '../src/db/database.module.js';
import { DrizzleDb } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { accounts, invoices, lineItems } from '../src/db/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { InvoicesRepository } from '../src/invoices/invoices.repository.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('transaction-failure', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [AccountsRepository, InvoicesRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back invoice on line-item insert failure', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);
    
    // Create a test account
    const accountId = randomUUID();
    await acctRepo.create({
      id: accountId,
      name: 'Tx Test Account',
      email: `tx-test-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 0n,
    });
    
    // Spy on transaction to make the line items insert fail
    // ...
  });
});
```

Hmm, but I'm not sure about the exact internal implementation of `createWithLineItems`. The plan says it does:
1. INSERT invoice
2. INSERT line items (if any)
3. UPDATE account

To monkey-patch, I think the most reliable approach is to use `vi.spyOn` on the db instance. But Drizzle's `db.transaction()` takes a callback that receives a `tx` object. The `tx` object is what I need to intercept.

Let me think about this differently. What if I just use a real database error? 

Here's an idea: What if the `line_items` table has a NOT NULL constraint on some field, and I pass an undefined value? In Drizzle, if I pass `undefined` for a NOT NULL field, it would either:
- Be omitted from the INSERT (if Drizzle handles it that way) → DB rejects with NOT NULL violation
- Or Drizzle might throw before sending to DB

Actually, looking at the schema in the plan:
- `line_items.description` is `text NOT NULL`
- If I pass `undefined` for description, Drizzle might omit it from the INSERT statement, and PostgreSQL would reject it because of the NOT NULL constraint.

Wait, but the `LineItemInsert` type would require `description` as a non-optional field (since it's NOT NULL with no default). So TypeScript wouldn't let me pass undefined...

Unless I cast it. Let me use a type assertion to bypass the check.

Actually, let me reconsider. The plan says "Monkey-patch a query inside the tx to throw." This strongly suggests using a mock/spy rather than a real DB constraint.

Let me go with this approach: I'll intercept the `db.transaction` call and provide a fake `tx` that allows the first query (invoice insert) to succeed but throws on the second (line items insert).

Here's how I can do it with Drizzle:

```typescript
const originalTransaction = db.transaction.bind(db);

vi.spyOn(db, 'transaction').mockImplementation(async (fn: any) => {
  // Wrap the real transaction but intercept the tx
  return originalTransaction(async (realTx: any) => {
    let callCount = 0;
    const proxiedTx = new Proxy(realTx, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => {
            callCount++;
            if (callCount === 2) {
              throw new Error('Simulated line item insert failure');
            }
            return value.apply(target, args);
          };
        }
        return value;
      }
    });
    return fn(proxiedTx);
  });
});
```

Hmm, but this is fragile because it depends on the internal call sequence. The `tx` object in Drizzle has methods like `insert`, `update`, `select`, etc. The `insert` method returns a query builder, and you call `.values()`, `.returning()` etc. on it. So intercepting at the `tx` level won't work simply because the actual query execution happens when you `await` the final query.

Let me think about this more carefully. In Drizzle:
```typescript
await tx.insert(invoices).values({...}).returning();
```

This is a chain: `tx.insert(table)` returns a builder, `.values(...)` returns another builder, `.returning()` returns the executable query. The actual DB call happens when you `await` it (or call `.execute()`).

So I'd need to intercept at the point of execution. One way: make the `tx` object's `insert` method return a chain where the final `.returning()` or the await-able throws.

This is getting complex. Let me try a different approach.

What if I use `vi.spyOn` at a lower level? Like spying on the pg pool's `query` method?

```typescript
const pool = (db as any)['session']['client']; // or wherever the pool is
```

Actually, in `drizzle-orm/node-postgres`, the db instance wraps a `pg.Pool`. The internal structure might be:
- `db.session.client` → the pool
- or `db['client']` → the pool

Let me try:
```typescript
// Access the underlying pg pool
const client = (db as any).session.client; // NodePgSession has a .client property
```

Then I can spy on `client.query` to make the second query fail.

Actually, let me look at this from a different angle. What's the simplest way to make the test work?

Option A: Use a real constraint violation
- I can create a scenario where the line item insert violates a constraint
- E.g., if I somehow get a NULL into a NOT NULL column
- Problem: TypeScript types prevent this

Option B: Spy on the pg pool's query method
- Intercept raw SQL queries and make the 2nd one fail
- More reliable but requires knowing the internal structure of Drizzle's node-postgres driver

Option C: Mock the repository method partially
- Don't test the actual DB transaction, just verify the service calls the repo correctly
- But the plan says "prove it still does" — meaning prove atomicity

Option D: Use a transaction that I control
- Override the `createWithLineItems` to use a custom transaction
- Too invasive

I think Option B is the most practical. Let me look at how Drizzle's node-postgres driver works internally.

In `drizzle-orm/node-postgres`, the `NodePgDatabase` instance has:
- `db.session` → a `NodePgSession` instance
- `db.session.client` → the `pg.Pool` or `pg.Client` instance

So I can do:
```typescript
const pool = (db as any).session.client;
```

Then spy on `pool.query`:
```typescript
const originalQuery = pool.query.bind(pool);
let queryCount = 0;
vi.spyOn(pool, 'query').mockImplementation((...args) => {
  queryCount++;
  if (queryCount === 2) { // second query = line items insert
    return Promise.reject(new Error('Simulated failure'));
  }
  return originalQuery(...args);
});
```

Wait, but the transaction itself uses a BEGIN/COMMIT. So the query sequence would be:
1. BEGIN (or START TRANSACTION)
2. INSERT INTO invoices ...
3. INSERT INTO line_items ...
4. UPDATE accounts ...
5. COMMIT (or ROLLBACK)

So query #3 would be the line items insert. Let me count:
1. BEGIN
2. INSERT invoices
3. INSERT line_items ← this is where I want to fail
4. (would be UPDATE accounts, but we won't reach it)

Actually, Drizzle might or might not use explicit BEGIN/COMMIT. In `drizzle-orm/node-postgres`, `db.transaction()` uses a real PG transaction (BEGIN/COMMIT). So the sequence would be:
1. BEGIN
2. INSERT INTO invoices
3. INSERT INTO line_items ← fail here
4. ROLLBACK (automatic due to error)

So I need to make the 3rd query fail (or the 2nd if Drizzle batches the BEGIN differently).

Actually, this is getting too implementation-specific. Let me take a step back.

The plan says: "Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged"

I think the most robust approach is:
1. Spy on the pool's query method
2. Track queries within the transaction
3. Make the line items INSERT fail (I can identify it by checking if the SQL contains 'line_items')
4. Verify the rollback

Let me write it:

```typescript
it('rolls back invoice on line-item insert failure', async () => {
  const acctRepo = app.get(AccountsRepository);
  const invRepo = app.get(InvoicesRepository);
  
  const accountId = randomUUID();
  await acctRepo.create({
    id: accountId,
    name: 'Tx Rollback Account',
    email: `tx-rollback-${accountId}@example.com`,
    credit_limit_cents: 100000n,
    balance_cents: 50000n,
    total_invoiced_cents: 1000n,
  });

  // Get the underlying pg pool
  const pool = (db as any).session.client;
  
  // Spy on query to make line_items inserts fail
  const originalQuery = pool.query.bind(pool);
  vi.spyOn(pool, 'query').mockImplementation((...args: any[]) => {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (sql && sql.includes('line_items')) {
      return Promise.reject(new Error('Simulated line item insert failure'));
    }
    return originalQuery(...args);
  });

  // Call createWithLineItems - should throw
  await expect(invRepo.createWithLineItems({
    invoice: {
      id: randomUUID(),
      account_id: accountId,
      status: 'draft',
      subtotal_cents: 5000n,
      tax_cents: 500n,
      total_cents: 5500n,
    },
    lineItems: [
      { id: randomUUID(), invoice_id: '', description: 'Test item', unit_price_cents: 2500n, quantity: 2, line_total_cents: 5000n },
    ],
  })).rejects.toThrow('Simulated line item insert failure');

  // Restore
  vi.restoreAllMocks();

  // Verify: no invoice was created
  const [foundInvoice] = await db.select().from(invoices).where(eq(invoices.account_id, accountId));
  // Hmm, this would return all invoices for the account. Let me be more specific.
  
  // Actually, I should check that no invoice with the specific ID exists
  // But I generated a random UUID for it... let me capture it.
});
```

Wait, I need to be more careful. Let me restructure:

```typescript
it('rolls back invoice on line-item insert failure', async () => {
  const acctRepo = app.get(AccountsRepository);
  const invRepo = app.get(InvoicesRepository);
  
  const accountId = randomUUID();
  const invoiceId = randomUUID();
  const lineItemId = randomUUID();
  
  await acctRepo.create({
    id: accountId,
    name: 'Tx Rollback Account',
    email: `tx-rollback-${accountId}@example.com`,
    credit_limit_cents: 100000n,
    balance_cents: 50000n,
    total_invoiced_cents: 1000n,
  });

  const pool = (db as any).session.client;
  const originalQuery = pool.query.bind(pool);
  vi.spyOn(pool, 'query').mockImplementation((...args: any[]) => {
    const sqlText = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (sqlText && sqlText.includes('line_items')) {
      return Promise.reject(new Error('Simulated line item insert failure'));
    }
    return originalQuery(...args);
  });

  await expect(invRepo.createWithLineItems({
    invoice: {
      id: invoiceId,
      account_id: accountId,
      status: 'draft',
      subtotal_cents: 5000n,
      tax_cents: 500n,
      total_cents: 5500n,
    },
    lineItems: [
      { id: lineItemId, invoice_id: invoiceId, description: 'Test item', unit_price_cents: 2500n, quantity: 2, line_total_cents: 5000n },
    ],
  })).rejects.toThrow();

  vi.restoreAllMocks();

  // No invoice should exist
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  expect(invoice).toBeUndefined(); // or null, depending on Drizzle's behavior

  // No line items should exist
  const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
  expect(lineItem).toBeUndefined();

  // Account counters unchanged
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  expect(account.total_invoiced_cents).toBe(1000n);
  expect(account.balance_cents).toBe(50000n);
});
```

Hmm wait, but there's a problem. The `pool.query` spy might interfere with the ROLLBACK query that PG sends after the error. Let me make sure the spy only rejects `line_items` INSERTs and lets everything else through.

Actually, my implementation already does that — it only rejects if the SQL contains 'line_items'. The ROLLBACK statement won't contain 'line_items', so it'll pass through to `originalQuery`.

But wait — will the ROLLBACK actually be sent? When Drizzle's transaction callback throws, Drizzle should automatically issue a ROLLBACK. The ROLLBACK query would go through `pool.query` (or maybe through a different connection in the pool). Let me make sure my spy handles this correctly.

Actually, there's another subtlety: in a pg Pool, each query might get a different connection. The transaction would use one specific connection (via `pool.connect()` → get a client → use that client for the tx). So the ROLLBACK would go through the same client, not through `pool.query` directly.

Hmm, this means my approach of spying on `pool.query` might not work if Drizzle uses `pool.connect()` to get a dedicated client for the transaction.

Let me reconsider. In `drizzle-orm/node-postgres`, how does `db.transaction()` work?

Looking at the Drizzle source (from memory):
- `db.transaction()` calls the session's `transaction()` method
- For node-postgres, it typically does: `const client = await pool.connect(); try { await client.query('BEGIN'); ... } finally { ...; client.release(); }`
- So individual queries within the transaction go through `client.query()`, not `pool.query()`

This means I need to spy on the client's query method, not the pool's. But the client is obtained dynamically within the transaction...

Alternative approach: Spy on `pool.connect()` to get the client, then spy on that client's query method.

```typescript
const originalConnect = pool.connect.bind(pool);
vi.spyOn(pool, 'connect').mockImplementation(async () => {
  const client = await originalConnect();
  const originalClientQuery = client.query.bind(client);
  let queryCount = 0;
  (client as any).query = (...args: any[]) => {
    queryCount++;
    const sqlText = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (sqlText && sqlText.includes('INSERT INTO "line_items"')) {
      return Promise.reject(new Error('Simulated line item insert failure'));
    }
    return originalClientQuery(...args);
  };
  return client;
});
```

This is getting complex but should work. However, it's quite implementation-specific to how Drizzle uses the pool.

Let me try yet another approach: What if I just use a real database error? 

What if the `line_items` table has a CHECK constraint that I can violate? Looking at the plan:
- `quantity` has `CHECK > 0`

So if I pass `quantity: 0` or a negative number, the database would reject it! But the TypeScript type for `LineItemInsert` would have `quantity: number` (not optional), so I can pass 0 and it would be a valid TS type but invalid at the DB level.

Wait, but the plan also says there's a test `test/validate-quantity.spec.ts` that "rejects quantity ≤ 0" with a 400 validation_error. This means the service/controller validates quantity before it reaches the repository. So if I call the repository directly with quantity 0, it would bypass that validation and hit the DB constraint.

This is perfect! I can:
1. Call `createWithLineItems` directly (bypassing service validation) with a line item that has `quantity: 0`
2. The DB CHECK constraint will reject it
3. The transaction should roll back

This is a real, honest test of the transactional behavior without any mocking!

Let me verify: The plan says `quantity` has `CHECK > 0`. So `quantity: 0` would violate this constraint.

But wait — will the CHECK constraint actually be in the migration? The plan says "CHECK > 0" for quantity. Let me assume it is (since the plan specifies it).

Actually, looking more carefully at the plan's data model:
```
| quantity | integer | no | CHECK > 0 |
```

Yes! So if I insert a line item with quantity 0, PostgreSQL will reject it with a CHECK violation. This will cause the transaction to roll back.

This is much cleaner than monkey-patching! Let me use this approach.

For test 1: "rolls back invoice on line-item insert failure"
- Create an account with known counters
- Call `createWithLineItems` with a line item that has `quantity: 0` (violates CHECK constraint)
- Expect the call to reject
- Verify no invoice, no line items, account counters unchanged

For test 2: "rolls back when account row missing"
- Call `createWithLineItems` with an `account_id` that doesn't exist in the accounts table
- The UPDATE at step 3 will affect 0 rows
- The repository should throw (per plan: "Assert rowCount === 1; if 0, throw")
- Verify no invoice was persisted

This is much better! Real database behavior, no mocking needed.

But wait — for test 1, I need to make sure the CHECK constraint is actually in the schema. If it's not (if the migration doesn't include it), my test would fail for the wrong reason (or the insert would succeed and I'd get a different error).

The plan explicitly states `CHECK > 0` for quantity, so I'll assume it's there.

Actually, let me reconsider test 1. The plan says "Monkey-patch a query inside the tx to throw." This is quite specific. Maybe I should honor that and actually use a mock/spy approach rather than a constraint violation. The constraint violation is a valid way to test the same thing, but it's testing "the CHECK constraint works" as much as "the transaction rolls back."

Hmm, but the goal is to prove that "invoice creation writes invoice + line items + account counters atomically." Using a real DB error (CHECK violation) proves this just as well as a monkey-patched query. In fact, it's arguably a better test because it tests the real integration.

I'll go with the CHECK constraint approach for test 1 and the missing account approach for test 2. Both use real database behavior.

Now, one concern: will the error from a CHECK violation propagate correctly through Drizzle's transaction? When a query within a transaction fails, PostgreSQL puts the transaction in an aborted state. Drizzle should catch the error and issue a ROLLBACK. The error should propagate to the caller.

Let me also consider: what error does Drizzle throw when a CHECK constraint is violated? It would be a `DrizzleError` wrapping a PG error with code `23514` (check_violation). The `rejects.toThrow()` should still work since it's checking that a rejection occurred.

OK let me write the final version:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule, DB } from '../src/db/database.module.js';
import type { DrizzleDb } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { accounts, invoices, lineItems } from '../src/db/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { InvoicesRepository } from '../src/invoices/invoices.repository.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('transaction-failure', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [AccountsRepository, InvoicesRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back invoice on line-item insert failure', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);

    const accountId = randomUUID();
    const invoiceId = randomUUID();
    const lineItemId = randomUUID();

    await acctRepo.create({
      id: accountId,
      name: 'Tx Rollback Account',
      email: `tx-rollback-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 1000n,
    });

    // quantity: 0 violates the CHECK constraint (quantity > 0),
    // causing the line_items INSERT to fail mid-transaction.
    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: accountId,
          status: 'draft',
          subtotal_cents: 5000n,
          tax_cents: 500n,
          total_cents: 5500n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Should fail',
            unit_price_cents: 2500n,
            quantity: 0,
            line_total_cents: 5000n,
          },
        ],
      }),
    ).rejects.toThrow();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();

    // Account counters must be unchanged
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.total_invoiced_cents).toBe(1000n);
    expect(account.balance_cents).toBe(50000n);
  });

  it('rolls back when account row missing', async () => {
    const invRepo = app.get(InvoicesRepository);

    const invoiceId = randomUUID();
    const lineItemId = randomUUID();
    const missingAccountId = randomUUID();

    // The account does not exist, so the UPDATE at step 3 affects 0 rows.
    // The repository should throw, causing the entire transaction to roll back.
    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: missingAccountId,
          status: 'draft',
          subtotal_cents: 3000n,
          tax_cents: 300n,
          total_cents: 3300n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Orphan line item',
            unit_price_cents: 1500n,
            quantity: 2,
            line_total_cents: 3000n,
          },
        ],
      }),
    ).rejects.toThrow();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();
  });
});
```

Wait, I need to double-check the errors in the original file and make sure my version addresses them all:

1. Line 2: `Cannot find module '@nestjs/testing'` — I'm still importing it. This is a workspace issue (package not installed or not in tsconfig). I can't fix this from within the file. ✓ (unfixable from this file)

2. Line 3: `Cannot find module '@nestjs/common'` — Same as above. ✓ (unfixable)

3. Line 4: `Cannot find module '../src/db/database.module'` — Fixed by adding `.js`: `'../src/db/database.module.js'` ✓

4. Line 5: `Relative import paths need explicit file extensions... Did you mean '../src/db/client.js'?` — Fixed by using `'../src/db/client.js'` ✓

5. Line 6: `Cannot find module 'drizzle-orm'` — Workspace issue. ✓ (unfixable)

6. Line 7: `Relative import paths need explicit file extensions... Did you mean '../src/db/schema.js'?` — Fixed by using `'../src/db/schema.js'` ✓

7. Line 8: `Cannot find module '../src/accounts/accounts.repository'` — Fixed by adding `.js`: `'../src/accounts/accounts.repository.js'` ✓

8. Line 9: `Cannot find module '../src/invoices/invoices.repository'` — Fixed by adding `.js`: `'../src/invoices/invoices.repository.js'` ✓

9. Line 10: `Cannot find module 'node:crypto'` — Workspace issue (missing `@types/node`). ✓ (unfixable)

So my fixes address all the relative import issues. The bare module imports (`@nestjs/testing`, `@nestjs/common`, `drizzle-orm`, `node:crypto`) are workspace-level issues that I cannot fix from within this file.

Now, let me also check: the plan says `CreateInvoiceTxArgs` is exported from the invoices repository. Do I need to import it? In my test, I'm passing the object literal directly to `createWithLineItems`, so TypeScript should infer the type from the method signature. I don't need to explicitly import `CreateInvoiceTxArgs` unless I want to annotate a variable.

Actually, I don't use `CreateInvoiceTxArgs` as a type annotation in my code, so I don't need to import it.

Let me also verify: does the plan's `DatabaseModule` export a `DB` token? Yes: "provides + exports a provider token DB: DrizzleDb" and `export const DB = Symbol('DB')`.

One more thing: the `DrizzleDb` type. The plan says it's exported from `src/db/client.ts`. I'm importing it as a type: `import type { DrizzleDb } from '../src/db/client.js'`.

Wait, but if `@nestjs/testing` can't be resolved, will the test even run? No, it won't. But the task is to fix what the compiler messages require of this file, and the module resolution errors for bare packages are not fixable from within the file. The relative import issues ARE fixable and I've fixed them.

Let me also make sure I'm not importing anything I don't need. Let me review:
- `Test` from `@nestjs/testing` — used for `Test.createTestingModule`
- `INestApplication` from `@nestjs/common` — used as type for `app`
- `DatabaseModule, DB` from `'../src/db/database.module.js'` — used for module setup and getting the db instance
- `DrizzleDb` from `'../src/db/client.js'` — used as type for `db`
- `eq` from `'drizzle-orm'` — used in where clauses
- `accounts, invoices, lineItems` from `'../src/db/schema.js'` — used in select queries
- `AccountsRepository` from `'../src/accounts/accounts.repository.js'` — used to create account and get from app
- `InvoicesRepository` from `'../src/invoices/invoices.repository.js'` — used to call createWithLineItems and get from app
- `randomUUID` from `'node:crypto'` — used to generate IDs
- `afterAll, beforeAll, describe, expect, it` from `'vitest'` — test framework

This all looks good. Let me finalize the file.

Actually, wait. I want to double-check one thing about test 2. The plan says:
"Assert `rowCount === 1`; if 0, throw (account vanished)."

So the repository's `createWithLineItems` method checks if the UPDATE affected exactly 1 row, and throws if not. This means the transaction will be rolled back because the throw happens inside the `db.transaction()` callback.

But here's a subtlety: if the account doesn't exist, would the FK constraint on `invoices.account_id` also fail? The invoice INSERT references `account_id` which is an FK to `accounts.id`. If the account doesn't exist, the INSERT would fail with an FK violation BEFORE we even get to the UPDATE step.

Hmm, this changes things. If the FK is enforced, then test 2 would fail at step 1 (invoice INSERT) due to FK violation, not at step 3 (UPDATE affecting 0 rows).

Wait, but the plan says:
"3. UPDATE `accounts SET total_invoiced_cents = total_invoiced_cents + $invoice.total, balance_cents = balance_cents - $invoice.total WHERE id = $accountId`. Assert `rowCount === 1`; if 0, throw (account vanished)."

The "account vanished" scenario implies that the account existed when the invoice was being created but disappeared by the time the UPDATE ran. This is a race condition scenario, not a "never existed" scenario. In practice, with a NOT NULL FK constraint, you can't insert an invoice with a non-existent account_id.

So for test 2, I need to simulate the scenario where the account exists at INSERT time but is gone by UPDATE time. This is harder to test with a real database...

Unless I use a DEFERRED FK constraint! In PostgreSQL, you can define FK constraints as DEFERRABLE INITIALLY DEFERRED. This means the FK check is deferred until COMMIT time, not at INSERT time. If the constraint is deferred, the INSERT would succeed even if the account doesn't exist, and the FK violation would only be caught at COMMIT (after the UPDATE).

But wait, the plan doesn't mention deferred FK constraints. Let me re-read the schema:
```
| account_id | varchar 36 | no | FK → accounts.id, NOT NULL |
```

No mention of DEFERRABLE. So by default, the FK is checked immediately at INSERT time.

This means my test 2 approach (using a non-existent account) would fail at the INSERT step with an FK violation, not at the UPDATE step. The test would still pass (transaction rolls back, no invoice persisted), but it's testing a different code path than what the plan describes.

Hmm, let me reconsider. The plan says:
"test/transaction-failure.spec.ts — 'rolls back when account row missing' | Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted"

This explicitly says "Tx reaches UPDATE, rowCount=0". So the test should specifically exercise the path where the INSERT succeeds but the UPDATE affects 0 rows.

To achieve this with a real database, I have a few options:
1. Use DEFERRABLE FK (but the schema doesn't specify this)
2. Delete the account between the INSERT and UPDATE (race condition — hard to test deterministically)
3. Use a spy/mock to make the UPDATE return 0 rows affected

Option 3 seems most practical. I could spy on the db's transaction to intercept the tx and make the UPDATE return 0 rows.

Actually, wait. Let me reconsider option 2. What if I:
1. Create an account
2. Start a separate transaction that deletes the account (but doesn't commit yet)
3. In the main transaction, insert the invoice (FK check passes because the account still exists in the uncommitted state... wait, no. In PostgreSQL with default READ COMMITTED isolation, the INSERT would see the account as existing because the DELETE hasn't committed. The FK check would pass.)
4. Then in the separate transaction, commit the DELETE
5. Back in the main transaction, the UPDATE would... hmm, actually with READ COMMITTED, each statement sees a fresh snapshot. So the UPDATE might or might not see the deleted account depending on timing.

This is getting too complex and racy. Let me go with option 3: spy on the transaction to make the UPDATE return 0 rows.

Actually, you know what, let me reconsider the whole approach. Maybe I'm overthinking this.

Let me re-read the plan's description of test 2:
"rolls back when account row missing" — "Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted"

The key insight is: the test needs to verify that when the UPDATE affects 0 rows, the transaction rolls back. The simplest way to do this without complex mocking is:

What if I just create the scenario where the account doesn't exist, and accept that the FK violation at INSERT time will also cause a rollback? The test still proves that "no invoice is persisted when the account is missing." The specific code path (INSERT fails vs UPDATE returns 0) is an implementation detail.

But the plan explicitly says "Tx reaches UPDATE, rowCount=0" — meaning the test should specifically exercise that path.

OK, let me use a spy for test 2. Here's my approach:
- Create the account
- Spy on the underlying client to intercept the UPDATE query and make it return 0 rows affected
- This simulates the "account vanished" race condition

Or, even simpler: what if I just delete the account BEFORE calling `createWithLineItems`, but make the FK constraint deferred? No, I can't change the schema.

Alright, let me use a different approach for test 2. What if I:
1. Create an account
2. Call `createWithLineItems` with that account's ID
3. But before the transaction completes, delete the account from another connection

This is a race condition and not deterministic. Not great for a test.

Let me just use a spy. Here's my refined approach:

For test 2, I'll spy on the pg client's query method to intercept the UPDATE statement and return `{ rows: [], rowCount: 0 }` instead of actually executing it.

```typescript
it('rolls back when account row missing', async () => {
  const acctRepo = app.get(AccountsRepository);
  const invRepo = app.get(InvoicesRepository);

  const accountId = randomUUID();
  const invoiceId = randomUUID();
  const lineItemId = randomUUID();

  await acctRepo.create({
    id: accountId,
    name: 'Tx Vanish Account',
    email: `tx-vanish-${accountId}@example.com`,
    credit_limit_cents: 100000n,
    balance_cents: 50000n,
    total_invoiced_cents: 1000n,
  });

  // Get the pool and intercept the client used for the transaction
  const pool = (db as any).session.client;
  const originalConnect = pool.connect.bind(pool);
  
  vi.spyOn(pool, 'connect').mockImplementation(async () => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client);
    (client as any).query = (...args: any[]) => {
      const sqlText = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (sqlText && sqlText.includes('UPDATE "accounts"')) {
        // Simulate account vanished: return 0 rows affected
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return originalQuery(...args);
    };
    return client;
  });

  await expect(
    invRepo.createWithLineItems({
      invoice: {
        id: invoiceId,
        account_id: accountId,
        status: 'draft',
        subtotal_cents: 3000n,
        tax_cents: 300n,
        total_cents: 3300n,
      },
      lineItems: [
        {
          id: lineItemId,
          invoice_id: invoiceId,
          description: 'Should rollback',
          unit_price_cents: 1500n,
          quantity: 2,
          line_total_cents: 3000n,
        },
      ],
    }),
  ).rejects.toThrow();

  vi.restoreAllMocks();

  // No invoice should have been persisted
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  expect(invoice).toBeUndefined();

  // No line items should have been persisted
  const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
  expect(lineItem).toBeUndefined();

  // Account counters unchanged (the UPDATE was intercepted)
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  expect(account.total_invoiced_cents).toBe(1000n);
  expect(account.balance_cents).toBe(50000n);
});
```

Wait, but there's a problem. When the UPDATE is intercepted and returns 0 rows, the repository throws. Then Drizzle's transaction handler catches the error and issues a ROLLBACK. The ROLLBACK query goes through the same client (which is now spied). But my spy only intercepts `UPDATE "accounts"` queries, so the ROLLBACK would pass through to `originalQuery`. Good.

But wait — will the ROLLBACK actually work? The transaction is in a valid state (the INSERT and line item INSERT succeeded, the UPDATE "succeeded" with 0 rows). So ROLLBACK should work fine.

Actually, hmm. If I'm intercepting the UPDATE and returning a fake result, the transaction is still "open" from PostgreSQL's perspective. The ROLLBACK will properly roll back the INSERTs. Good.

But there's another issue: after `vi.restoreAllMocks()`, the pool is back to normal. But the client that was obtained during the spied `connect()` call might still be in the pool. When I do the subsequent `db.select()` calls, they'll use a different client from the pool (or the same one after it's released). This should be fine.

Actually, I realize there might be an issue with how Drizzle uses the pool. Let me think about this more carefully.

In `drizzle-orm/node-postgres`, the `NodePgSession` has a `client` property which is the pool. When you call `db.transaction()`, it does something like:
1. Get a client from the pool (`pool.connect()`)
2. Execute BEGIN on that client
3. Run the transaction callback with a `tx` object that uses that client
4. On success: execute COMMIT on that client
5. On error: execute ROLLBACK on that client
6. Release the client back to the pool

So if I spy on `pool.connect()`, I can intercept the client that's used for the transaction. My approach should work.

But wait, there's a subtlety: Drizzle might not use `pool.connect()` directly. It might use the pool's query method with a specific tag, or it might have its own connection management. Let me not overthink this and just go with the approach. If `pool.connect()` is not the right method, the test would fail and I'd need to adjust. But based on standard pg.Pool usage, `connect()` is how you get a dedicated client.

Actually, I just realized: in newer versions of Drizzle ORM with node-postgres, the internal implementation might use `pool.query()` for simple queries and `pool.connect()` for transactions. Or it might always use `pool.query()`. I'm not 100% sure of the internal implementation.

Let me take a step back and think about whether there's a simpler approach.

What if, for test 2, I just accept that the FK violation at INSERT time is sufficient to prove the rollback? The test name is "rolls back when account row missing" — the key assertion is that no invoice is persisted. Whether it's because the INSERT failed (FK violation) or the UPDATE returned 0 rows is a secondary concern.

The plan says "Tx reaches UPDATE, rowCount=0 → whole tx rolls back" — this describes the expected behavior, but for testing purposes, if I can't easily set up that exact scenario without complex mocking, maybe I should just test the observable behavior (no invoice persisted when account is missing).

But the plan also says "Do not drop a requirement to silence an error." And the plan specifically describes this test as exercising the UPDATE-returns-0 path.

OK, let me compromise: I'll use the spy approach for test 2, but I'll add an `// ASSUMPTION:` comment noting that I'm intercepting at the pool level because the exact internal connection management of Drizzle's node-postgres driver is not visible to me.

Actually, wait. Let me reconsider test 1 as well. I was going to use a CHECK constraint violation (quantity: 0). But what if the CHECK constraint isn't actually in the migration? The plan specifies it, but if the implementation doesn't include it, my test would fail.

Hmm, but the plan says the migration should include `CHECK > 0` for quantity. If I'm writing the test against the planned schema, I should assume the constraint is there.

OK here's my final decision:
- Test 1: Use CHECK constraint violation (quantity: 0) — clean, no mocking needed
- Test 2: Use pool spy to simulate UPDATE returning 0 rows — necessary because FK prevents the "account never existed" scenario

Let me also add an `// ASSUMPTION:` for test 2 about the pool connection method.

Wait, actually, I just thought of something for test 2. What if I use `DEFERRABLE` FK? No, I can't change the schema.

What about this: What if I create the account, then in a separate connection, DELETE the account and COMMIT, all before calling `createWithLineItems`? Then the account truly doesn't exist. But then the FK violation at INSERT would prevent the test from reaching the UPDATE step.

Unless... I use a different approach. What if the FK is on `account_id` but it's a `varchar(36)` (not a native UUID type)? In PostgreSQL, FK constraints work the same regardless of the column type. So this doesn't help.

OK, I'll stick with my plan: spy for test 2.

Let me also reconsider: maybe I should just use the FK violation for test 2 and note in a comment that it exercises a slightly different code path (INSERT fails due to FK rather than UPDATE returning 0). The observable behavior (rollback, no invoice) is the same.

Actually, you know what, let me re-read the plan one more time:

"test/transaction-failure.spec.ts — 'rolls back when account row missing' | Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted"

I think the intent is clear: the test should specifically exercise the UPDATE-returns-0 path. Let me use the spy approach.

Final plan:
- Test 1: CHECK constraint violation (quantity: 0) → real DB error → rollback
- Test 2: Spy on pool.connect() to intercept the client and make UPDATE return 0 rows → repository throws → rollback

Let me write the final version now.

One more thought: for the `pool.connect()` spy, I need to be careful about the return type. `pool.connect()` returns a `Promise<Client>`. My mock should return the same thing (the real client, but with a spied `query` method).

Also, I should make sure to clean up the spy after the test. `vi.restoreAllMocks()` should handle this, but I need to make sure it's called in the right place (after the assertion, before the cleanup queries).

Let me also think about whether `vi.restoreAllMocks()` will properly restore the `pool.connect` spy. It should, since I used `vi.spyOn`.

OK, here's my final version:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule, DB } from '../src/db/database.module.js';
import type { DrizzleDb } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { accounts, invoices, lineItems } from '../src/db/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { InvoicesRepository } from '../src/invoices/invoices.repository.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('transaction-failure', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [AccountsRepository, InvoicesRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back invoice on line-item insert failure', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);

    const accountId = randomUUID();
    const invoiceId = randomUUID();
    const lineItemId = randomUUID();

    await acctRepo.create({
      id: accountId,
      name: 'Tx Rollback Account',
      email: `tx-rollback-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 1000n,
    });

    // quantity: 0 violates the CHECK (quantity > 0) constraint,
    // causing the line_items INSERT to fail mid-transaction.
    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: accountId,
          status: 'draft',
          subtotal_cents: 5000n,
          tax_cents: 500n,
          total_cents: 5500n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Triggers CHECK violation',
            unit_price_cents: 2500n,
            quantity: 0,
            line_total_cents: 5000n,
          },
        ],
      }),
    ).rejects.toThrow();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();

    // Account counters must be unchanged
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.total_invoiced_cents).toBe(1000n);
    expect(account.balance_cents).toBe(50000n);
  });

  // ASSUMPTION: Drizzle's node-postgres driver obtains a dedicated pg.Client
  // via pool.connect() for transactions; intercepting at that level lets us
  // simulate the "account vanished between INSERT and UPDATE" race.
  it('rolls back when account row missing', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);

    const accountId = randomUUID();
    const invoiceId = randomUUID();
    const lineItemId = randomUUID();

    await acctRepo.create({
      id: accountId,
      name: 'Tx Vanish Account',
      email: `tx-vanish-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 1000n,
    });

    const pool = (db as any).session.client;
    const originalConnect = pool.connect.bind(pool);

    vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      (client as any).query = (...args: any[]) => {
        const sqlText = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text;
        if (sqlText && /UPDATE\s+"?accounts"?/i.test(sqlText)) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return originalQuery(...args);
      };
      return client;
    });

    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: accountId,
          status: 'draft',
          subtotal_cents: 3000n,
          tax_cents: 300n,
          total_cents: 3300n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Should roll back',
            unit_price_cents: 1500n,
            quantity: 2,
            line_total_cents: 3000n,
          },
        ],
      }),
    ).rejects.toThrow();

    vi.restoreAllMocks();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();

    // Account counters unchanged (UPDATE was intercepted, ROLLBACK undid the INSERTs)
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.total_invoiced_cents).toBe(1000n);
    expect(account.balance_cents).toBe(50000n);
  });
});
```

Wait, I want to double-check: after `vi.restoreAllMocks()`, the pool is back to normal. The subsequent `db.select()` calls will work normally. Good.

But there's a potential issue: when I spy on `pool.connect()`, the mock implementation calls `originalConnect()` which gets a real client from the pool. I then modify that client's `query` method. After the transaction completes (with ROLLBACK), the client is released back to the pool. When I do `vi.restoreAllMocks()`, it restores `pool.connect` to its original implementation. But the client that was modified might still be in the pool with its modified `query` method!

This could cause issues with subsequent queries. To be safe, I should restore the client's query method as well. Or better yet, I should ensure the client is properly released before restoring mocks.

Actually, let me think about this more carefully. The flow is:
1. `vi.spyOn(pool, 'connect')` — spy on connect
2. `invRepo.createWithLineItems(...)` — this calls `db.transaction()` which calls `pool.connect()` (spied)
3. The spied connect gets a real client, modifies its query method, returns it
4. The transaction runs: BEGIN, INSERT invoice, INSERT line items, UPDATE (intercepted, returns 0 rows)
5. Repository throws because rowCount === 0
6. Drizzle catches the error, calls ROLLBACK on the client (this goes through the modified query method, but ROLLBACK doesn't match the UPDATE pattern, so it passes through to originalQuery)
7. Drizzle releases the client back to the pool
8. The `rejects.toThrow()` assertion passes
9. `vi.restoreAllMocks()` — restores pool.connect to original

At step 7, the client is released back to the pool. Its `query` method is still the modified one (a closure that checks for UPDATE accounts). If a subsequent query happens to be an UPDATE to accounts, it would be intercepted. But in my test, the subsequent queries are SELECTs, so they won't match the pattern. And `vi.restoreAllMocks()` only restores the spy on `pool.connect`, not the client's query method.

To be thorough, I should save and restore the client's query method. But this adds complexity. For the purposes of this test, since the subsequent queries are SELECTs (which won't match the UPDATE pattern), it's safe.

Alternatively, I could use `vi.spyOn` on the client's query method as well, which would be properly restored by `vi.restoreAllMocks()`. Let me do that:

```typescript
vi.spyOn(pool, 'connect').mockImplementation(async () => {
  const client = await originalConnect();
  const querySpy = vi.spyOn(client, 'query').mockImplementation((...args: any[]) => {
    const sqlText = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text;
    if (sqlText && /UPDATE\s+"?accounts"?/i.test(sqlText)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // Call the original implementation
    return (client as any).query.mock.calls; // no, this doesn't work
  });
  return client;
});
```

Hmm, this is getting circular. Let me just save the original query method:

```typescript
vi.spyOn(pool, 'connect').mockImplementation(async () => {
  const client = await originalConnect();
  const originalClientQuery = client.query.bind(client);
  const querySpy = vi.spyOn(client, 'query').mockImplementation((...args: any[]) => {
    const sqlText = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text;
    if (sqlText && /UPDATE\s+"?accounts"?/i.test(sqlText)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return originalClientQuery(...args);
  });
  return client;
});
```

Wait, but `vi.spyOn(client, 'query')` replaces the method. When I call
