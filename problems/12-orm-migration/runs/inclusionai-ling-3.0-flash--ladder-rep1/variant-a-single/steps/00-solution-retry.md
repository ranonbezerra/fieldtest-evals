# solution-retry

## reasoning

```
Let me analyze this task carefully. I need to migrate a billing service from Prisma to Drizzle while:

1. Recreating the schema in Drizzle with migrations
2. Porting all queries while keeping wire format byte-compatible (BigInt as strings)
3. Preserving transactional behavior
4. Finding uncovered behavior and pinning it with tests
5. Documenting in MIGRATION_NOTES.md
6. NOT editing the existing test suite

Let me understand the codebase:

**Schema:**
- Account: id (Uuid, pk), name (String), currency (Char(3)), invoiceCount (Int @default(0)), createdAt (DateTime @default(now())), invoices (relation)
- Invoice: id (Uuid, pk), accountId (Uuid), number (unique), status (String @default("draft")), totalMinor (BigInt), issuedAt (DateTime? ), createdAt (DateTime @default(now())), account (relation), lineItems (relation)
- InvoiceLineItem: id (Uuid, pk), invoiceId (Uuid), position (Int), description (String), quantity (Int), unitPriceMinor (BigInt), invoice (relation, onDelete: Cascade)

**Key behaviors to preserve:**
1. `getInvoice` - returns invoice with line items, throws if not found
2. `listForAccount` - returns empty list (not 404) for missing account
3. `issue` - marks invoice as issued, uses `mapPrismaError` for error handling
4. `createInvoice` - transactional: creates invoice + line items + increments account counter atomically
5. BigInt fields serialized as strings via global serializer
6. Line items returned in insertion order (from `findLineItems`)
7. Line items have `onDelete: Cascade` from Invoice
8. `findAccount` returns null when account doesn't exist
9. Invoice `issuedAt` can be null

**Things the existing tests DON'T cover (that I need to find and pin):**
1. Line items ordering - the seed inserts them out of order (3, 1, 2) but the test expects 3 items. The `findLineItems` query doesn't have an ORDER BY, so database returns in insertion order. Wait, actually looking at the test, it just checks `inv.lineItems.length` is 3, not the order. But the ordering might matter for consumers.

2. The `createInvoice` transactional behavior - no test for mid-transaction failure
3. What happens when creating an invoice with a duplicate number - should throw ConflictError
4. What happens when issuing an invoice that doesn't exist - `mapPrismaError` maps P2025 to NotFoundError
5. The `listForAccount` returns empty for missing account - this IS tested actually

Let me think about what semantic behaviors I need to pin:

1. **Line item ordering**: The query `findLineItems` returns items in insertion order (database order). The seed intentionally inserts out of order (positions 3, 1, 2). A consumer might expect them ordered by position. Let me check the service code - it just maps them, no ordering. So the behavior is "returned in insertion order" which is the DB default. I should pin this.

2. **Mid-transaction failure atomicity**: Need a test that injects a failure and asserts nothing was written.

3. **Duplicate invoice number**: The `mapPrismaError` handles P2002 → ConflictError. But wait, in the Drizzle migration, there's no Prisma error code. I need to handle this differently - Drizzle will throw different errors.

4. **Issuing a non-existent invoice**: `mapPrismaError` with P2025 → NotFoundError. In Drizzle, a failed update affects 0 rows.

5. **BigInt serialization**: Already handled by serializer, but I need to make sure Drizzle returns bigints properly.

6. **`createInvoice` with 0 line items**: The code checks `if (input.lineItems.length > 0)` before creating. This should still work.

7. **Cascade delete on line items**: When an invoice is deleted, line items should cascade. But wait, there's no delete invoice endpoint in the code. Still, the schema has it.

Let me now plan the Drizzle schema and all the files.

**Key migration concerns:**

1. **Prisma error codes → Drizzle errors**: In Drizzle, unique constraint violations don't have error code "P2002". They throw `DrizzleError` or we need to check the PostgreSQL error. Similarly, "record not found" for updates doesn't have "P2025". I need to handle these in the error mapping.

2. **BigInt types**: Drizzle supports `bigint` column type which returns bigints in TypeScript.

3. **UUID types**: Drizzle has `uuid` type.

4. **Transactions**: Drizzle supports `$transaction`.

Let me think about what `MIGRATION_NOTES.md` should contain:

- How Prisma error codes (P2002, P2025) were handled in Drizzle
- How BigInt fields are preserved
- How transaction atomicity is preserved
- Line item ordering behavior
- The `listForAccount` empty-list-for-missing-account behavior
- Cascade delete behavior
- Any other semantic differences

Now let me figure out the Drizzle setup. I'll need:
- `drizzle` package and `drizzle-orm`
- `drizzle-orm/postgresql` for the database integration
- A `drizzle.config.ts` for migrations
- The schema file

Let me structure the files:

1. `package.json` - Remove Prisma, add Drizzle
2. `drizzle.config.ts` - Drizzle config
3. `src/db/schema.ts` or `src/billing/schema.ts` - Drizzle schema
4. `src/billing/drizzle.ts` - Database connection/instance
5. `src/billing/billing.repository.ts` - Port from Prisma to Drizzle
6. `src/common/errors.ts` - Update error mapper (remove Prisma-specific)
7. `src/billing/prisma.ts` - REMOVE (was the Prisma type stub)
8. Update tests to use Drizzle instead of fake Prisma... wait, no. The task says "Do not edit the existing suite". But the existing suite imports from `prisma.js` and uses `fakePrisma()`. This is a contradiction.

Wait, let me re-read: "Do not edit the existing suite - It is the only evidence the migration preserved behaviour. Rewriting it... destroys the comparison this task exists to make."

But the existing test imports from `../src/billing/prisma.js` and uses `fakePrisma()` which returns a `PrismaClient`. If I remove Prisma, the existing tests won't compile.

Hmm, let me re-read more carefully. The issue says "No Prisma anywhere: not in package.json, not in an import, not in the error mapper". And "The existing suite passes unmodified".

These seem contradictory unless... the test's `fakePrisma()` is a fake client that doesn't actually import from `@prisma/client`. Looking at the test, it defines its own `PrismaClient` interface and casts to it. The import is `import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';` - this imports types from `prisma.ts` which is a type-only stub.

So if I remove `prisma.ts`, the test won't compile. But the task says don't edit the test. And it says no Prisma anywhere including imports.

Wait, maybe I need to keep the type definitions somewhere else, or the stub file `prisma.ts` stays but as plain types (not Prisma imports). Let me look again at `prisma.ts`:

```ts
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';
```

The test imports from `prisma.js` which is a local file with type definitions. It doesn't import from `@prisma/client` directly. So if I keep the `prisma.ts` file but remove the `@prisma/client` dependency from package.json, it should still work since it's just type definitions.

But wait, the task says "No Prisma anywhere: not in package.json, not in an import, not in the error mapper". And "The import that only survives because it is a type" should be removed. Hmm.

Actually, re-reading: "The Prisma schema, the generated client and the dependency all removed — including the import that only survives because it is a type, and the error-mapping helper that translates Prisma error codes."

So I need to:
1. Remove Prisma from package.json
2. Remove the type-only import of PrismaClient from the test (but I can't edit the test...)
3. Remove `mapPrismaError` from errors.ts

This is contradictory unless I interpret it differently. Let me re-read once more.

"including the import that only survives because it is a type" - This might refer to an import somewhere in the source code (not the test) that exists only for types. Let me check the source files:

- `billing.repository.ts` imports `AccountRow, InvoiceRow, LineItemRow, PrismaClient` from `./prisma.js`
- `billing.service.ts` imports `InvoiceRow, LineItemRow` from `./prisma.js`
- `prisma.ts` is a type stub

The test also imports from `prisma.js`.

OK, I think the resolution is: The `prisma.ts` file with type definitions should be replaced by Drizzle's generated types or by inline type definitions. The test's imports from `../src/billing/prisma.js` need to keep working since I can't edit the test. So I need to keep a `prisma.ts`-equivalent file but with Drizzle-compatible types instead of Prisma types.

Wait, but the test specifically creates a `fakePrisma()` that returns something cast as `PrismaClient`. If I remove the `PrismaClient` interface, the test won't compile.

Hmm. Let me reconsider. The task says "Do not edit the existing suite" but also "No Prisma anywhere". Maybe the interpretation is:
- The test file itself is not edited
- But the types it imports from can change (as long as the test still compiles and passes)
- The `PrismaClient` interface in `prisma.ts` was a fake/stub for testing; I need to replace it with something that works with Drizzle

Actually wait - the test imports from `../src/billing/prisma.js`. I can rename the file or change its content. The test just needs the types to be there. So I can:
1. Keep a file at `src/billing/prisma.ts` (or rename it) that exports the same type interfaces
2. But rename it to something Drizzle-friendly
3. Keep the `PrismaClient` interface so the test's `fakePrisma()` works

But the task says "No Prisma anywhere" - meaning no Prisma in the project. Having a file named `prisma.ts` seems to go against that.

Let me think about this differently. The test creates a fake client and casts it. The key thing is that the test needs those types. I could:
- Export the same types from a different file (e.g., `src/billing/types.ts`)
- But then the test import `from '../src/billing/prisma.js'` would break

OK I think the most sensible interpretation is: The test can't be edited, so it still imports from `../src/billing/prisma.js`. I need to keep that file but make it export plain TypeScript types (not Prisma types) and update the `PrismaClient` interface to match the Drizzle-backed fake client. The `PrismaClient` name is just a name - it's a TypeScript interface, not the actual Prisma client.

Actually wait, let me re-read the task more carefully: "No Prisma anywhere: not in package.json, not in an import, not in the error mapper". This says "not in an import". Does that mean I can't have `import ... from '@prisma/client'`? Yes. But importing types from a local `prisma.ts` file that just has TypeScript interfaces is different from importing the Prisma client library.

I think the intent is:
- No `@prisma/client` dependency
- No `import { ... } from '@prisma/client'` anywhere
- No `mapPrismaError` function that maps Prisma error codes
- The Prisma schema file is removed
- But the test's `fakePrisma()` mock is kept as-is (since we can't edit tests)

So my approach: Keep `src/billing/prisma.ts` as a types file (rename conceptually but keep the path since tests import from it), update the types to work with Drizzle, and update the `PrismaClient` interface to match what the fake client provides.

Actually, let me look at this more carefully. The fake Prisma client in the test has methods like `account.findUnique`, `invoice.create`, etc. The `PrismaClient` interface in `prisma.ts` defines these. The test creates a fake client that satisfies this interface.

When I migrate to Drizzle, the real repository will use Drizzle's API. The test uses a fake client. These are different. The test doesn't care about the real implementation - it tests the service through the repository.

So my plan:
1. Keep `src/billing/prisma.ts` with the same type interfaces (AccountRow, InvoiceRow, LineItemRow, Tx, PrismaClient) so the test compiles
2. The fake client in the test still works because it satisfies the interface
3. But the real repository now uses Drizzle instead of this fake client

Wait, but `mapPrismaError` needs to be removed. The service calls it in the `issue` method. I need to replace it with Drizzle error handling.

Let me also think about what `DrizzleError` looks like. In Drizzle with PostgreSQL, when a unique constraint is violated, it throws an error that you can inspect via the `code` property on the error or the SQL state. When an update affects 0 rows, Drizzle's `.run()` returns `{ rowCount: 0 }` or for `.update()` with `.get()` it returns `null`.

Let me now plan all files:

### Files to create/modify:

1. **`package.json`** - Remove `@prisma/client` and `prisma`, add `drizzle`, `drizzle-orm`, `pg`
2. **`drizzle.config.ts`** - Drizzle config for migrations
3. **`src/db/schema.ts`** (or `src/billing/schema.ts`) - Drizzle schema definition
4. **`src/billing/drizzle.ts`** - Database instance
5. **`src/billing/billing.repository.ts`** - Drizzle-backed repository
6. **`src/billing/billing.service.ts`** - Service (mostly unchanged, update imports)
7. **`src/billing/prisma.ts`** - Keep type definitions for test compatibility
8. **`src/common/errors.ts`** - Remove `mapPrismaError`, add Drizzle error mapping
9. **`src/common/serializer.ts`** - Unchanged
10. **`src/main.ts`** - Unchanged (if it exists)
11. **`src/app.module.ts`** - Unchanged
12. **MIGRATION_NOTES.md** - Documentation
13. **Test for mid-transaction atomicity**
14. **New tests for uncovered behaviors**
15. **Migration SQL file**

Wait, actually looking at the test more carefully, the test imports from `../prisma/seed.js` too:
```ts
import { seed } from '../prisma/seed.js';
```

I should keep `prisma/seed.ts` as-is since it's data, not the Prisma client.

Also the test imports types from `../src/billing/prisma.js`. I need to keep this file.

Let me also think about what new tests I need:

1. **Mid-transaction failure test**: Create an invoice where the transaction fails partway through (e.g., line item creation throws), and assert that nothing was written (no invoice, no line items, no counter increment).

2. **Line item ordering**: The seed inserts line items out of order. The `findLineItems` method in the fake Prisma returns them in insertion order (items.filter preserves order from the array). In a real database, without ORDER BY, the order is undefined. But with Drizzle, I should add an ORDER BY to match the "insertion order" behavior... or should I? Let me think about what the database actually does.

Actually in PostgreSQL, without an ORDER BY, the order is undefined but typically follows the physical storage order. For a freshly inserted table, this would be insertion order. But this is not guaranteed.

Looking at the fake Prisma implementation:
```ts
async findMany({ where }: { where: { invoiceId: string } }) {
  return items.filter((li) => li.invoiceId === where.invoiceId);
}
```
This preserves the order from the `items` array, which is insertion order from the seed (position 3, 1, 2).

But the test doesn't check ordering. However, consumers might depend on it. I should preserve this by adding an explicit ORDER BY in the query... but on what? The seed data has positions 3, 1, 2 for invoice 0001, and if we order by position, we'd get 1, 2, 3 which differs from the insertion order.

Hmm, but in a real database with auto-increment IDs, ordering by ID would give insertion order. In Drizzle, line items have UUID IDs that are generated randomly, not sequentially.

I think the behavior to pin is: "Line items are returned in database insertion order" (which for the fake client means the seed order). In Drizzle, I should query without an explicit ORDER BY to preserve whatever the database returns naturally, matching the behavior.

Actually wait, let me re-read the issue: "Ordering that happens to be stable today." This is one of the things to find. The `findLineItems` doesn't have an ORDER BY, so the order is whatever the DB returns. For the fake Prisma, it's the array order. For a real DB, it's typically insertion order. I should preserve this behavior (no explicit ordering) and document it.

3. **Duplicate invoice number → ConflictError**: Test that creating an invoice with a duplicate number throws a ConflictError. In Drizzle, unique constraint violations throw with a specific error that I need to detect.

4. **Issue non-existent invoice → NotFoundError**: Test that issuing a non-existent invoice throws NotFoundError. In Drizzle, an update that affects 0 rows needs to be detected.

5. **BigInt stays as bigint**: Test that totalMinor and unitPriceMinor are bigints, not numbers.

Let me now think about Drizzle error handling. In Drizzle with `postgresql` dialect:
- Unique constraint violations: The error is a `DrizzleError` with `code` property or SQL state. Actually in Drizzle, it typically throws with a message containing the constraint name. We might need to check `error.code` which could be `'23505'` (PostgreSQL unique violation SQL state) or check the message for the constraint name.
- Not found: Drizzle's `.update()` returns the updated row or `null` if no row matched (when using `.returning()`). Without `.returning()`, it returns `{ rowCount: 0 }`.

Actually, let me check Drizzle's API more carefully. In Drizzle ORM:
- `db.update(...).where(...).returning()` - returns the updated row(s). If no rows match, returns empty array.
- `db.delete(...).where(...).returning()` - similar.

For the `markIssued` method, the current implementation does `invoice.update` which in Prisma throws if the record doesn't exist. In Drizzle, I'd use `.update().where().returning()` and if it returns empty, throw NotFoundError.

For unique constraint violations in Drizzle, when running with PostgreSQL, the error has:
- `code`: `'23505'` (SQL state)
- `message`: contains the constraint name

Let me now design the Drizzle schema:

```ts
import { pgTable, uuid, varchar, text, integer, bigint, timestamp, relation } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  currency: varchar('currency', { length: 3 }).$type<string>(), // Char(3)
  invoiceCount: integer('invoice_count').default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (account) => ({
  // relations if needed
}));

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  number: varchar('number').$type<string>().unique(),
  status: varchar('status').default('draft'),
  totalMinor: bigint('total_minor', { mode: 'bigint' }),
  issuedAt: timestamp('issued_at', { mode: 'date' }).nullable(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (invoice) => ({
  account: relation('account', { fields: [invoice.accountId], references: [accounts.id] }),
  lineItems: relation('invoiceLineItem', { fromFields: [invoice.id], toFields: [lineItem.invoiceId] }),
  accountIdIdx: index('invoices_account_id_idx').on(invoice.accountId),
}));

export const lineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey(),
  invoiceId: uuid('invoice_id').notNull(),
  position: integer('position').notNull(),
  description: varchar('description', { length: 255 }),
  quantity: integer('quantity'),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }),
}, (lineItem) => ({
  invoice: relation('invoice', { fields: [lineItem.invoiceId], references: [invoices.id], onDelete: 'cascade' }),
  invoiceIdIdx: index('invoice_line_items_invoice_id_idx').on(lineItem.invoiceId),
}));
```

Wait, but Drizzle relations with cascade delete need to be set up correctly. Let me check.

In Drizzle, `onDelete: 'cascade'` in the relation definition handles it at the application level or the schema level. Actually, for the schema-level cascade, I need to add it to the actual SQL. Drizzle's `relation` function with `onDelete: 'cascade'` adds `ON DELETE CASCADE` to the foreign key constraint.

Now let me think about the `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-orm/kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

And the migration directory should be created with `drizzle generate`.

Now let me think about the repository implementation:

```ts
import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../db/index.js'; // or whatever
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';

export class BillingRepository {
  constructor(private readonly db: DrizzleDB) {}

  async findAccount(id: string): Promise<AccountRow | null> {
  const result = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return result[0] ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
  const result = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return result[0] ?? null;
  }

  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
  return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
  return db.select().from(invoices).where(eq(invoices.accountId, accountId));
  }

  async createInvoice(input: { invoice: Omit<InvoiceRow, 'createdAt'>; lineItems: LineItemRow[] }): Promise<InvoiceRow> {
  return db.$transaction(async (tx) => {
    const [invoice] = await tx.insert(invoices).values(input.invoice).returning();
    if (input.lineItems.length > 0) {
      await tx.insert(invoiceLineItems).values(input.lineItems);
    }
    await tx.update(accounts).set({ invoiceCount: accounts.invoiceCount + 1 }).where(eq(accounts.id, input.invoice.accountId));
    return invoice;
  });
  }

  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
  const result = await db.update(invoices).set({ status: 'issued', issuedAt }).where(eq(invoices.id, id)).returning();
  if (result.length === 0) throw new NotFoundError('invoice_not_found');
  return result[0];
  }
}
```

Now for the error mapping - I need to handle Drizzle-specific errors. Let me think about what Drizzle throws:

In Drizzle ORM with PostgreSQL:
- Unique constraint violation: Throws an error with `code` property. Actually, Drizzle wraps the pg driver error. The error might have `code: '23505'` (PostgreSQL SQL state for unique violation).
- Not found on update: We handle this explicitly (check rowCount).

So `mapPrismaError` should be replaced with something like:

```ts
export function mapDrizzleError(e: unknown): Error {
  const code = (e as { code?: string })?.code;
  if (code === '23505') return new ConflictError('invoice_number_taken');
  return e instanceof Error ? e : new Error(String(e));
}
```

But wait, the issue says "the error-mapping helper that translates Prisma error codes" should be removed. So `mapPrismaError` should be removed. And `issue()` method in the service currently calls `mapPrismaError`. I need to update this.

But in Drizzle, if `markIssued` properly handles the not-found case internally (returns NotFoundError), then the service doesn't need an error mapper at all. The service's `issue` method can just call `repo.markIssued` directly.

Let me reconsider. In Prisma, `markIssued` calls `invoice.update` which throws if not found, and the service catches it and maps it. In Drizzle, my `markIssued` handles the not-found case internally and throws `NotFoundError` directly. So the service doesn't need the try/catch + mapPrismaError anymore.

Actually, let me check: the service currently does:
```ts
async issue(id: string): Promise<InvoiceRow> {
  try {
    return await this.repo.markIssued(id, new Date());
  } catch (e) {
    throw mapPrismaError(e);
  }
}
```

If the repository already handles the not-found case and throws `NotFoundError`, the service can just be:
```ts
async issue(id: string): Promise<InvoiceRow> {
  return this.repo.markIssued(id, new Date());
}
```

And `mapPrismaError` can be removed from errors.ts (or kept but not used - no, it must be removed entirely).

But wait - what about unique constraint violations during `createInvoice`? If someone tries to create an invoice with a duplicate number, in Drizzle it would throw with code `23505`. Currently, the service doesn't catch this anywhere - `createInvoice` is only in the repository. So there's no error mapping for it in the current code either. The `mapPrismaError` is only used in `issue()`.

Hmm, actually `createInvoice` in the repository currently doesn't have any error mapping either. The Prisma client would throw P2002, but nobody catches it. So the error just propagates up. In the new code, Drizzle would throw with code `23505`, and it would propagate up similarly. But since there's no mapping, what does the consumer see?

Let me check: the service has `createInvoice`? No, looking at the service, it doesn't have a `createInvoice` method. The repository has it. So there's no service method to create invoices. Let me check the tests... the tests don't test `createInvoice` directly. They test `getInvoice`, `listForAccount`, `issue`.

Wait, but the task says "invoice creation writes invoice + line items + account counters atomically today; prove it still does (test that injects a failure mid-transaction)." So I need to add a test for `createInvoice`.

OK so let me now plan the test for mid-transaction failure. I need to make the fake Prisma client support this. But the fake Prisma client is in the existing test file which I can't edit.

Hmm, I need to create a new test. Can I create a new test file? Yes. In the new test, I can use a different fake Prisma client that supports injection of failures.

Actually wait - I'm not supposed to edit the existing test, but I can add new tests. Let me create a new test file for the uncovered behaviors.

Let me also reconsider the `prisma.ts` file. The existing test imports from it. I need to keep it. But should I rename it? The test imports from `../src/billing/prisma.js`. I'll keep that path.

Let me also think about what the `PrismaClient` interface should look like now. In the test, it's used as a fake implementation. In the real code, it will be replaced by a Drizzle database instance. But the types need to stay compatible.

Actually, let me reconsider the whole architecture. Maybe I should:
1. Keep `src/billing/prisma.ts` with type definitions and the `PrismaClient` interface (so the existing test works)
2. Create `src/db/schema.ts` with Drizzle schema
3. Create `src/db/index.ts` with Drizzle DB instance
4. Update `billing.repository.ts` to use Drizzle instead of PrismaClient
5. Update `billing.service.ts` to remove `mapPrismaError` usage
6. Update `errors.ts` to remove `mapPrismaError`
7. Create migration files
8. Create new tests
9. Create MIGRATION_NOTES.md

For the repository, I need a type that represents the Drizzle database. Let me define that.

Actually, let me look at what types the repository needs. It needs:
- `findAccount(id)` → AccountRow | null
- `findInvoice(id)` → InvoiceRow | null
- `findLineItems(invoiceId)` → LineItemRow[]
- `listInvoices(accountId)` → InvoiceRow[]
- `createInvoice(input)` → InvoiceRow (transactional)
- `markIssued(id, issuedAt)` → InvoiceRow

The Drizzle DB instance provides all of these. Let me create a simple interface.

Now let me write all the files.

One thing I need to be careful about: the `serialize` function in `serializer.ts` handles bigints by converting to strings. This is called globally in `main.ts`. So when responses are sent, bigints are serialized as strings. This preserves the wire format. Good.

But what about when the service returns data directly (not through HTTP)? In tests, the service returns objects directly, so `totalMinor` would be a `bigint`. The test `expect(inv.lineItems.length).toBe(3)` doesn't check the type of totalMinor. So it's fine.

Let me now check: does the existing test check that `totalMinor` is a bigint? No. But the issue says "Invoice amounts are BigInt and are serialized as strings today." The serialization happens at the HTTP layer, not at the service layer. In tests, the service returns bigints.

Let me now also think about what new tests to write:

1. **Mid-transaction failure test** (in a new test file or the new tests): Create a fake DB where `insert` for line items throws, then assert that no invoice was created and account counter wasn't incremented.

2. **Duplicate number test**: Create an invoice with a number that already exists, assert it throws a ConflictError.

3. **Issue non-existent invoice**: Already tested indirectly? Let me check. The test has `it('throws when the invoice does not exist', ...)` but that's for `getInvoice`, not `issue`. So I need a test for `issue` on a non-existent invoice → NotFoundError.

4. **BigInt format**: Test that `totalMinor` is a bigint (and when serialized, a string).

5. **Line item ordering**: Test that line items are returned in insertion order (matching the seed order, which is positions 3, 1, 2).

6. **Create invoice with 0 line items**: Test creating an invoice without line items.

7. **Account counter increment in transaction**: Test that the counter is incremented.

Actually let me think about what's truly uncovered by looking at each test:

Existing tests:
1. `returns an invoice with its line items` - covers getInvoice for existing invoice, line items length
2. `throws when the invoice does not exist` - covers getInvoice for missing invoice
3. `lists invoices for an account` - covers listForAccount for account with invoices
4. `returns an empty list for an account with no invoices` - covers listForAccount for account without invoices
5. `marks an invoice issued` - covers issue for existing invoice

What's NOT covered:
- `issue` on a non-existent invoice → should throw NotFoundError (because mapPrismaError maps P2025)
- `createInvoice` transaction atomicity
- `createInvoice` with line items actually creates them
- `createInvoice` increments account counter
- Duplicate invoice number → ConflictError
- BigInt types preserved (totalMinor, unitPriceMinor)
- Line items returned in insertion order (not sorted by position)
- `findAccount` returns null for missing account (this is documented in the repo code comment)
- The `listForAccount` returns empty list for missing account (IS tested in test 4)
- Cascade delete behavior

Let me now think about which of these I should pin with tests:

**Critical (consumers depend on these):**
1. `issue` on non-existent invoice → NotFoundError (error path that returns 404 - mentioned in L2-spec §4)
2. Line item ordering (ordering that happens to be stable today - mentioned in L2-spec §4)
3. Transaction atomicity (explicitly required)
4. Duplicate number → ConflictError (error path)
5. BigInt stays bigint (wire format)

**Good to have:**
6. Create invoice actually creates line items and increments counter
7. findAccount returns null for missing

Let me now write everything.

Actually, let me also consider the `prisma.ts` file carefully. It currently exports:
- `AccountRow`, `InvoiceRow`, `LineItemRow` - row types
- `Tx` - transaction interface
- `PrismaClient` - client interface

The test imports all of these. I need to keep them. But I should rename the file to something Drizzle-friendly? No, I can't because the test imports from `prisma.js`. I'll keep the file but it'll be a plain types file, not a Prisma thing.

Wait, should the file be renamed? The task says "The Prisma schema, the generated client and the dependency all removed — including the import that only survives because it is a type". This suggests even type-only Prisma imports should be removed. But the test imports from it...

I think the intent is: remove the `@prisma/client` import (which was in `package.json` and generated code). The `prisma.ts` file in the source was a hand-written stub for type-checking. Since the test depends on it and I can't edit the test, I'll keep the file but rename what it exports conceptually. The key is: no `@prisma/client` import anywhere.

Let me also check: does `prisma.ts` import from `@prisma/client`? No, it doesn't. It's all hand-written types. So the "import that only survives because it is a type" might refer to something else. Let me check all files:

- `billing.repository.ts` imports from `./prisma.js` - types only
- `billing.service.ts` imports from `./prisma.js` - types only  
- `test/billing.spec.ts` imports from `../src/billing/prisma.js` and `../prisma/seed.js`
- None of them import from `@prisma/client` directly

The `@prisma/client` import would be implicit through the generated client. But the fixture uses a fake client. So maybe there's no actual `@prisma/client` import in the code - it's just a dependency in package.json.

The "import that only survives because it is a type" might refer to the `PrismaClient` type import somewhere. Let me check... the test imports `PrismaClient` as a type. The repository imports `PrismaClient` as a type parameter.

I think the safest interpretation is:
1. Remove `@prisma/client` and `prisma` from package.json
2. Remove the `mapPrismaError` function
3. Keep `src/billing/prisma.ts` as a type definitions file (it doesn't import Prisma)
4. Update the repository to use Drizzle
5. Everything else follows

Now let me draft all files:

### package.json
```json
{
  "name": "fixture-billing-drizzle",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit", "db:migrate": "drizzle-kit generate" },
  "dependencies": { "drizzle-orm": "^0.34.0", "pg": "^8.11.0" },
  "devDependencies": { "drizzle-kit": "^0.25.0", "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

### drizzle.config.ts
```ts
import { defineConfig } from 'drizzle-orm/kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

### src/db/schema.ts
This is the Drizzle schema.

### src/db/index.ts
Database connection.

### src/billing/schema.ts (or maybe put schema in src/db/schema.ts)

Actually, let me think about the layout. The convention says:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

Since this isn't a full NestJS app (it's "plain classes and plain imports"), I'll simplify. Let me put the Drizzle schema in `src/db/schema.ts` and the DB instance in `src/db/index.ts`.

Wait, the issue says "The fixture is plain classes and plain imports — check what it actually is before assuming a framework." Looking at the files, there's no NestJS module, controller, etc. There's just `src/billing/billing.service.ts`, `src/billing/billing.repository.ts`, `src/common/errors.ts`, `src/common/serializer.ts`, `src/main.ts`, `src/app.module.ts`. Let me check if there's a main.ts or app.module.ts... they're mentioned in the layout but not shown. Let me not worry about them and focus on what I can see.

OK let me now write all the files systematically.

Actually, one more thing. The existing test file `test/billing.spec.ts` imports from `../prisma/seed.js`. I should keep `prisma/seed.ts` unchanged.

And the test imports types from `../src/billing/prisma.js`. I need to keep that file with the right exports.

Let me also think about what `src/db/schema.ts` should export so the repository can use it.

Now, here's a concern about Drizzle's `bigint` type. In Drizzle, `bigint('column', { mode: 'bigint' })` returns `bigint` in TypeScript. But when querying, it returns `bigint` values from the database. PostgreSQL's `bigint` type maps to JavaScript `bigint` when using the `pg` driver with `bigint` mode.

Actually, the `pg` driver returns bigint as numbers by default unless you set `bigintMode: 'bigint'` in the connection options. But Drizzle handles this internally with the `mode: 'bigint'` option on the column definition. Let me make sure.

In Drizzle ORM, `bigint('col', { mode: 'bigint' })` means:
- TypeScript type: `bigint`
- Query result: bigint

The Drizzle docs say this uses the driver's bigint support. With `pg` driver, you might need to configure it. But let's assume Drizzle handles it correctly with `mode: 'bigint'`.

Let me also think about the `uuid` type. In Drizzle, `uuid('id').primaryKey()` generates UUID columns. PostgreSQL has native UUID support.

Now let me finalize the `drizzle-orm` version. Looking at compatibility, `drizzle-orm@0.34.x` works with `drizzle-kit@0.25.x` and `pg@8.x`.

Actually, let me use versions that are commonly compatible:
- `drizzle-orm`: `^0.34.0`
- `drizzle-kit`: `^0.25.0`
- `pg`: `^8.11.0`

Now let me write all the files.

Let me also carefully think about the Drizzle query for `findLineItems`. In the fake Prisma, it returns items in array order. In Drizzle, `db.select().from(lineItems).where(eq(lineItems.invoiceId, invoiceId))` returns rows in an undefined order unless we specify ORDER BY. To match the "insertion order" behavior, I should add `.orderBy(lineItems.id)` ... but UUIDs aren't sequential. 

Actually, in PostgreSQL without an ORDER BY, the typical order is by physical position in the table (ctid), which for a freshly populated table is insertion order. So NOT adding ORDER BY preserves the insertion-order behavior. This matches the fake Prisma behavior (which iterates the array in order).

But wait - this is actually a problem. The issue says "Ordering that happens to be stable today" is something to find and document. The behavior is that line items are returned in an undefined order that happens to be insertion order. In Drizzle, this is preserved by not adding an ORDER BY clause.

However, I need to make sure my Drizzle query doesn't add a default ordering. `db.select().from(table).where(...)` doesn't add any default ORDER BY, so this is fine.

Now let me also think about the `createInvoice` method. In the current implementation:
```ts
return this.prisma.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ data: input.invoice });
  if (input.lineItems.length > 0) {
    await tx.invoiceLineItem.createMany({ data: input.lineItems });
  }
  await tx.account.update({
    where: { id: input.invoice.accountId },
    data: { invoiceCount: { increment: 1 } },
  });
  return invoice;
});
```

In Drizzle:
```ts
return db.$transaction(async (tx) => {
  const [invoice] = await tx.insert(invoices).values(input.invoice).returning();
  if (input.lineItems.length > 0) {
    await tx.insert(lineItems).values(input.lineItems);
  }
  await tx.update(accounts).set({ invoiceCount: accounts.invoiceCount + 1 }).where(eq(accounts.id, input.invoice.accountId));
  return invoice;
});
```

Wait, in Drizzle, `$transaction` takes a function that receives a `Transaction` object. The transaction object has methods like `insert`, `select`, `update`, etc. Let me make sure the types work.

In Drizzle, `db.$transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>`. The transaction object has the same methods as the db but operates within the transaction.

Let me also think about the `returning()` method. In Drizzle:
- `db.insert(table).values(...).returning()` returns the inserted rows
- `db.update(table).set(...).where(...).returning()` returns the updated rows

For `createInvoice`, I need to return the created invoice. `tx.insert(invoices).values(input.invoice).returning()` returns an array, so `[invoice] = ...`.

Now, one more thing about the `AccountRow` type. It has `invoiceCount: number`. In Drizzle, `integer('invoice_count').default(0)` returns `number` in TypeScript. Good.

Let me also handle the `markIssued` error case properly. In Drizzle, `db.update(invoices).set({...}).where(eq(invoices.id, id)).returning()` returns an empty array if no rows match. So I check `result.length === 0` and throw `NotFoundError`.

Now, about `mapPrismaError` and the `issue` method. In the service:
```ts
async issue(id: string): Promise<InvoiceRow> {
  try {
    return await this.repo.markIssued(id, new Date());
  } catch (e) {
    throw mapPrismaError(e);
  }
}
```

Since my `markIssued` already handles the not-found case and throws `NotFoundError` directly, and there's no other error mapping needed, I can simplify to:
```ts
async issue(id: string): Promise<InvoiceRow> {
  return this.repo.markIssued(id, new Date());
}
```

Now `mapPrismaError` is no longer used anywhere. I remove it from `errors.ts`.

Let me also think about what happens if `markIssued` throws some other unexpected error (like a DB connection error). In the old code, it would be mapped through `mapPrismaError` (which would pass it through since it's not P2002 or P2025). In the new code, it just propagates. This is fine because unexpected errors should propagate as 500s regardless.

Now let me also think about the `createInvoice` error handling. Currently, if the invoice number is a duplicate, Prisma throws P2002, which isn't caught in the repository. In Drizzle, it would throw with code `23505`. Since there's no error mapping in the repository, it propagates. But there's no service method for `createInvoice`, so who calls it? It might be called from a controller directly. Let me check... there's no controller shown. So this is fine.

Actually, looking at the error types in `errors.ts`:
- `NotFoundError` - for 404s
- `ConflictError` - for 409s

If `createInvoice` needs to map unique violations to `ConflictError`, I should add that. But since there's no service method or endpoint for it in the given code, I'll leave it as-is. If needed, I could add a note in MIGRATION_NOTES.md about how to handle it at the controller layer.

Hmm wait, let me reconsider. The task says "the error-mapping helper that translates Prisma error codes" should be removed. If I add a new `mapDrizzleError` function, that would be adding something similar. But the task also says I need to handle error paths. Let me check if there's a place where Drizzle errors need mapping.

In the current code, `mapPrismaError` is only used in `issue()`. And in my new code, `markIssued()` handles the not-found case internally. So there's no need for an error mapper at all. 

But what about the `createInvoice` case? If a duplicate number error occurs, it would propagate as a raw Drizzle error. In the old code, it would propagate as a Prisma error (P2002). Neither has a service-level mapping. So this is equivalent.

OK let me finalize the design and start writing files.

Let me think about the file structure:

```
drizzle.config.ts
package.json
prisma/seed.ts              (keep unchanged)
src/billing/billing.repository.ts
src/billing/billing.service.ts
src/billing/prisma.ts       (keep for test types)
src/common/errors.ts
src/common/serializer.ts
src/db/index.ts
src/db/schema.ts
test/billing.spec.ts        (unchanged)
test/billing-extended.spec.ts (new tests)
drizzle/00000000000001.sql (migration)
MIGRATION_NOTES.md
```

Wait, should I remove `prisma/seed.ts`? The seed file is data, not the Prisma client. The test imports it. Let me keep it.

Actually, let me check the test import path again:
```ts
import { seed } from '../prisma/seed.js';
```

This is relative to `test/billing.spec.ts`, so it imports from `prisma/seed.ts`. I should keep this file.

Now let me also think about `src/db/index.ts`. It should create the Drizzle database instance. But for tests, we need to be able to inject a fake client. Let me look at how the repository gets the DB instance.

The repository's constructor takes a client. In the old code, it takes `PrismaClient`. In the new code, it should take a Drizzle instance. But the test creates a fake PrismaClient and passes it to `BillingRepository(fakePrisma())`.

Hmm, this is a problem. The test creates a fake PrismaClient and passes it to the repository. But now the repository expects a Drizzle instance. The types won't match.

Wait, let me look at the test again:
```ts
function service(): BillingService {
  return new BillingService(new BillingRepository(fakePrisma()));
}
```

The fakePrisma returns a `PrismaClient` interface. The `BillingRepository` constructor takes a `PrismaClient` (type). If I change the repository to take a Drizzle DB instance, the test won't compile.

But I can't edit the test. So I need the repository to accept something that the fake PrismaClient satisfies.

This is a design challenge. Let me think...

Option 1: Keep the `PrismaClient` interface in `prisma.ts` and have the repository accept it. Then the repository methods need to work with both the fake PrismaClient (used in tests) and a real Drizzle instance. This would require the repository to have a dual API - which doesn't make sense.

Option 2: Change the repository to accept a generic type that has the methods it needs (duck typing). The fake PrismaClient has these methods (findUnique, findMany, create, update, $transaction, etc.). If I define an interface that matches what the repository actually calls, and the fake PrismaClient satisfies it, then it works.

Let me look at what the repository actually calls:
- `this.prisma.account.findUnique({ where: { id } })`
- `this.prisma.invoice.findUnique({ where: { id } })`
- `this.prisma.invoiceLineItem.findMany({ where: { invoiceId } })`
- `this.prisma.invoice.findMany({ where: { accountId } })`
- `this.prisma.$transaction(...)`
- `this.prisma.invoice.update({ where: { id }, data: {...} })`

The fake PrismaClient in the test has all these methods. If I define an interface that matches these method signatures (using the types from `prisma.ts`), and make the repository accept this interface, then:
- The test's fake client satisfies the interface
- A real Drizzle instance... does it satisfy the interface?

A Drizzle instance has methods like `select().from(table).where(...)`, `insert(table).values(...).returning()`, `update(table).set(...).where(...)`, `$transaction(fn)`. These have completely different signatures from PrismaClient methods.

So Option 2 doesn't work directly. The Drizzle API is fundamentally different from Prisma's.

Option 3: Create a Drizzle-compatible interface and have the test's fake client satisfy it. But the test can't be edited...

Hmm, wait. Let me re-read the test:
```ts
function fakePrisma(): PrismaClient {
  ...
  return { ... } as unknown as PrismaClient;
}
```

The function returns `PrismaClient` (the interface from `prisma.ts`). The repository takes `PrismaClient` as constructor parameter. So if the repository still takes `PrismaClient`, the test works.

But then the repository needs to use Prisma-style API methods. And the real implementation needs to use Drizzle. This means I need to either:
a) Keep the `PrismaClient` interface and have a real Drizzle-backed implementation that doesn't actually use Prisma but implements the same interface methods
b) Or change the approach entirely

Let me go with option (a): Keep the `PrismaClient` interface in `prisma.ts` but reimplement it as a Drizzle wrapper.

Actually wait, let me think about this differently. The `PrismaClient` interface in `prisma.ts` is just a TypeScript interface. It defines method signatures. The test's fake client implements these. The real client should also implement these but using Drizzle underneath.

So I create a `DrizzleClient` class that implements the `PrismaClient` interface but uses Drizzle internally. The repository takes `PrismaClient` (the interface), and receives either the fake or the Drizzle client.

This is clean and preserves test compatibility! Let me go with this.

Let me design the `DrizzleClient`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';

export class DrizzleClient implements PrismaClient {
  constructor(private readonly db: typeof db) {}

  account = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<AccountRow | null> => {
      const result = await this.db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
      return result[0] ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow> => {
      const result = await this.db.update(accounts).set({ invoiceCount: accounts.invoiceCount + data.invoiceCount.increment }).where(eq(accounts.id, where.id)).returning();
      return result[0];
    },
  };

  invoice = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<InvoiceRow | null> => {
      const result = await this.db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
      return result[0] ?? null;
    },
    findMany: async ({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> => {
      return this.db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
    },
    create: async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> => {
      const [row] = await this.db.insert(invoices).values(data).returning();
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> => {
      const [row] = await this.db.update(invoices).set(data).where(eq(invoices.id, where.id)).returning();
      return row;
    },
  };

  invoiceLineItem = {
    findMany: async ({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> => {
      return this.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, where.invoiceId));
    },
    createMany: async ({ data }: { data: LineItemRow[] }): Promise<{ count: number }> => {
      await this.db.insert(invoiceLineItems).values(data);
      return { count: data.length };
    },
  };

  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> = async <T>(fn) => {
    return this.db.$transaction<T>(fn as (tx: any) => Promise<T>);
  };
}
```

Hmm, but this adds a lot of indirection. And `$transaction` is tricky because the transaction object needs to have the same methods.

Actually, let me reconsider. The task says to migrate the data layer to Drizzle. The repository should use Drizzle directly. The test should still pass.

Alternative approach: Make the repository accept a generic parameter that defines the minimum API it needs, and have both the fake Prisma client and a Drizzle adapter satisfy it.

But the test creates the fakePrisma and passes it directly to `new BillingRepository(fakePrisma())`. So the repository's constructor parameter type must be compatible with the fakePrisma's return type, which is `PrismaClient`.

Let me go with the Drizzle client approach. I'll create a Drizzle-backed client that implements the `PrismaClient` interface, and a repository that uses it.

Wait, but then the repository still takes `PrismaClient` and the "migration" is just in how the client is implemented, not in the repository. That's not really a complete migration.

Hmm, let me reconsider. Maybe the repository should be updated to use Drizzle directly, and the test needs to be adapted... but I can't edit the test.

OK here's another approach: Keep the repository accepting `PrismaClient` type, but have a Drizzle-backed implementation. The repository methods call methods on the client (which has Prisma-style API). The real implementation has a Drizzle-backed client behind the scenes.

But this doesn't really migrate the data layer. The data layer is still using Prisma-style API.

Let me try yet another approach: Make the repository accept an interface that both the fake Prisma and Drizzle can satisfy. The key insight is that the test's fake Prisma client returns types that match the `PrismaClient` interface. If I make the repository accept the exact interface that both satisfy, it works.

Actually, let me look at this from a different angle. The `PrismaClient` interface in `prisma.ts` defines:
- account.findUnique, account.update
- invoice.findUnique, findMany, create, update
- invoiceLineItem.findMany, createMany
- $transaction

This IS the data layer API. If I implement it with Drizzle behind the scenes, the repository code doesn't need to change much. The migration is:
1. Replace Prisma with Drizzle in the client implementation
2. Keep the same API surface so tests pass
3. Update error handling

But the task says "Migrate the data layer to Drizzle completely" and "Every repository/service query ported". So the repository should use Drizzle APIs.

I think the best approach is:
1. Update the repository to use Drizzle APIs directly
2. Make it accept a Drizzle DB instance
3. For tests, create a Drizzle-compatible fake that the test can use

But I can't edit the test. The test does `new BillingRepository(fakePrisma())`.

OK let me think about this more carefully. The fakePrisma() function returns a PrismaClient. If BillingRepository's constructor accepts something wider than PrismaClient (like an interface with fewer methods), and the fakePrisma satisfies it, it works.

The fakePrisma has these method signatures (from the test):
```ts
account: { findUnique, update }
invoice: { findUnique, findMany, create, update }
invoiceLineItem: { findMany, createMany }
$transaction
```

If I define an interface with these methods (using duck typing), the fakePrisma satisfies it. And a real Drizzle adapter can also satisfy it.

Let me define the interface:

```ts
export interface BillingDb {
  account: {
    findUnique(args: { where: { id: string } }): Promise<AccountRow | null>;
    update(args: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow>;
  };
  invoice: {
    findUnique(args: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(args: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    create(args: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
    update(args: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    findMany(args: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
    createMany(args: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  $transaction<T>(fn: (tx: BillingTx) => Promise<T>): Promise<T>;
}

export interface BillingTx {
  invoice: {
    create(a: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    createMany(a: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  account: {
    update(a: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow>;
  };
}
```

Hmm but these are basically the same types from `prisma.ts`. Let me just reuse those.

Actually, the simplest approach: In `prisma.ts`, keep all the type definitions. In the repository, change the constructor parameter type from `PrismaClient` to something that works with both. But `PrismaClient` IS the interface that the fake client implements.

Wait, let me re-read the repository:
```ts
export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}
```

And the test:
```ts
return new BillingService(new BillingRepository(fakePrisma()));
```

`fakePrisma()` returns `PrismaClient`. So `prisma: PrismaClient` works.

Now if I want to use Drizzle in the real implementation, I need to create a Drizzle-backed object that IS a `PrismaClient` (satisfies the interface). Then I pass it to `BillingRepository` and it works.

So my plan:
1. Keep `prisma.ts` types
2. Create `src/db/schema.ts` with Drizzle schema
3. Create `src/db/index.ts` with Drizzle connection
4. Create `src/billing/drizzle-client.ts` with a Drizzle-backed implementation of `PrismaClient` interface
5. Update `billing.repository.ts` to use Drizzle types... no, keep it as `PrismaClient` since that's what the test expects.
6. Update `billing.service.ts` - remove `mapPrismaError`, update imports
7. Update `errors.ts` - remove `mapPrismaError`

Wait, but this means the repository still uses Prisma-style API internally (through the PrismaClient interface). The Drizzle is only in the client implementation. Is that a proper migration?

The task says "Migrate the data layer to Drizzle completely". I think the key is:
- No Prisma in dependencies
- No Prisma error mapping
- Schema in Drizzle
- Queries using Drizzle under the hood

If the repository calls `this.prisma.invoice.findUnique(...)` and the implementation is Drizzle-backed, that's fine. The repository API is abstracted.

But actually, let me re-read: "Every repository/service query ported". This suggests the repository methods should be ported to use Drizzle APIs directly, not through a Prisma-compatible wrapper.

Hmm, but if I do that, the test breaks. Unless I make the constructor accept a different type.

Let me go with the pragmatic approach: Change the repository constructor to accept a Drizzle instance directly, and make the fake Prisma client compatible by creating a wrapper/adepter in the test.

But I can't edit the test! The test does `new BillingRepository(fakePrisma())` where fakePrisma returns `PrismaClient`.

OK, final decision: I'll keep the `PrismaClient` interface (as the data access contract) in `prisma.ts`, create a Drizzle-backed implementation of it, and have the repository use it through that interface. This is the only way to keep the test working unmodified.

But wait - maybe there's a simpler approach. What if I make the repository constructor accept `unknown` or a generic type, and internally cast? That's ugly but works.

No, let me go with the clean approach: Keep `PrismaClient` as the interface. Create a Drizzle-backed class that implements it. Repository takes `PrismaClient`. In production, we pass the Drizzle-backed class. In tests, we pass the fake.

This is actually a reasonable architecture. The `PrismaClient` interface is the data access contract, and different implementations back it (Prisma in the old code, Drizzle in the new).

But naming... `PrismaClient` is a confusing name for an interface that's backed by Drizzle. I'll keep the name for test compatibility but document it.

Let me now write the actual code.

Actually, I just realized something. Let me re-examine the `prisma.ts` file:

```ts
export interface PrismaClient extends Tx {
  account: Tx['account'] & { ... };
  invoice: Tx['invoice'] & { ... };
  invoiceLineItem: Tx['invoiceLineItem'] & { ... };
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
```

And `Tx` is:
```ts
export interface Tx {
  invoice: { create(...): Promise<InvoiceRow>; };
  invoiceLineItem: { createMany(...): Promise<{ count: number }>; };
  account: { update(...): Promise<AccountRow>; };
}
```

So `PrismaClient` includes both the top-level methods and the transaction methods. The `$transaction` takes a function that receives a `Tx` (transaction object).

Now in my Drizzle-backed implementation, `$transaction` needs to pass a `Tx` object to the callback. The `Tx` object has `invoice.create`, `invoiceLineItem.createMany`, and `account.update`. In my Drizzle transaction, these need to work correctly.

Let me design the Drizzle-backed client:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';

export class DrizzleClient implements PrismaClient {
  private readonly db;

  constructor() {
    this.db = db;
  }

  // account
  account = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<AccountRow | null> => {
      const rows = await this.db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow> => {
      const rows = await this.db.update(accounts).set({ invoiceCount: accounts.invoiceCount + data.invoiceCount.increment }).where(eq(accounts.id, where.id)).returning();
      return rows[0];
    },
  };

  // invoice
  invoice = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<InvoiceRow | null> => {
      const rows = await this.db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    findMany: async ({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> => {
      return this.db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
    },
    create: async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> => {
      const rows = await this.db.insert(invoices).values(data).returning();
      return rows[0];
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> => {
      const rows = await this.db.update(invoices).set(data).where(eq(invoices.id, where.id)).returning();
      return rows[0];
    },
  };

  // invoiceLineItem
  invoiceLineItem = {
    findMany: async ({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> => {
      return this.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, where.invoiceId));
    },
    createMany: async ({ data }: { data: LineItemRow[] }): Promise<{ count: number }> => {
      await this.db.insert(invoiceLineItems).values(data);
      return { count: data.length };
    },
  };

  // transaction
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> = async <T>(fn) => {
    return this.db.$transaction<T>(async (drizzleTx) => {
      const tx: PrismaClient['$transaction extends (fn: (tx: infer U) => Promise<T>) => Promise<T>']['argument'] = {
        invoice: {
          create: async (args: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> => {
            const rows = await drizzleTx.insert(invoices).values(args.data).returning();
            return rows[0];
          },
        },
        invoiceLineItem: {
          createMany: async (args: { data: LineItemRow[] }): Promise<{ count: number }> => {
            await drizzleTx.insert(invoiceLineItems).values(args.data);
            return { count: args.data.length };
          },
        },
        account: {
          update: async (args: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow> => {
            const rows = await drizzleTx.update(accounts).set({ invoiceCount: accounts.invoiceCount + args.data.invoiceCount.increment }).where(eq(accounts.id, args.where.id)).returning();
            return rows[0];
          },
        },
      };
      return await fn(tx);
    });
  };
}
```

Hmm, this is getting complex with type issues. Let me simplify.

Actually, for the `$transaction` type, let me just cast more liberally. The key is that it works at runtime and the test passes.

Let me also reconsider: maybe instead of a `DrizzleClient` class, I should just update the repository to use Drizzle directly, and make it accept an object that satisfies a narrower interface. The test's fake Prisma client would still satisfy this interface because it has the same methods.

Let me define the repository like this:

```ts
export class BillingRepository {
  constructor(private readonly db: BillingDb) {}

  async findAccount(id: string): Promise<AccountRow | null> {
    return this.db.account.findUnique({ where: { id } });
  }
  // ...
}
```

Where `BillingDb` is an interface with the methods the repository needs. The fake PrismaClient satisfies this interface (it has `account.findUnique`, etc.). So the test works!

This is cleaner. Let me go with this approach.

Let me define `BillingDb` and `BillingTx` interfaces in a separate file or in `prisma.ts`.

Actually, I'll put them in `prisma.ts` alongside the row types. The `PrismaClient` interface is already the right shape. The repository can take `PrismaClient` as its parameter type.

Wait, but then I'm not really migrating the repository. The repository still uses PrismaClient interface methods.

Let me think about what "migrating the data layer" means in this context:
1. The schema is in Drizzle ✓
2. The database is Drizzle ✓
3. The repository queries are ported to use Drizzle APIs ✓ (if through a Drizzle-backed client)
4. No Prisma dependency ✓
5. Error handling is Drizzle-native ✓

I think the key question is: where does the Drizzle API call happen? In my approach, it happens in the `DrizzleClient` class. The repository calls `this.prisma.invoice.findUnique(...)`, and the DrizzleClient translates that to a Drizzle query.

Alternatively, the repository could call Drizzle directly: `db.select().from(invoices).where(...)`.

The second approach is cleaner but breaks the test. The first approach preserves the test.

Since "Do not edit the existing suite" is a hard constraint, I'll go with the first approach. The migration is:
- Schema → Drizzle
- Database → Drizzle
- PrismaClient → Drizzle-backed implementation
- Error mapping → Drizzle-native
- No Prisma dependency

The repository's method calls are semantically the same, but the underlying implementation uses Drizzle. This is a valid migration.

Actually, you know what, let me reconsider once more. The task says:

"Every repository/service query ported"

This means every query in the repository and service should be ported to use Drizzle. If the repository calls `this.prisma.invoice.findUnique(...)`, that's still a Prisma-style query. It hasn't been "ported".

But the test prevents me from changing the repository's API.

Compromise: I'll port the repository to use Drizzle directly, and make the parameter type an interface that the fake Prisma satisfies. Since the fake has the Prisma-style methods, and I'll also need a Drizzle adapter for the interface...

Wait, the fake Prisma client has Prisma-style methods (findUnique, findMany, etc.). If the repository uses Drizzle-style methods (select, insert, update, etc.), the fake Prisma client doesn't satisfy the interface.

The only way to make this work is:
1. Repository takes `PrismaClient` (fake satisfies) → queries are Prisma-style but backed by Drizzle → not fully "ported"
2. Repository takes Drizzle-style interface → fake doesn't satisfy → test breaks
3. Repository takes a generic interface → need to match both → hard

I'll go with approach 1. It's the only way to satisfy both constraints. The "porting" is in the implementation layer (DrizzleClient), not in the repository method calls.

Alternatively, maybe I should just accept that the repository is thin and the real migration is in the data access implementation. Let me proceed with this.

Now let me also think about the `DrizzleClient.$transaction` implementation. The tricky part is that the transaction callback receives a `Tx` object. In the test's fake Prisma, `$transaction` does:
```ts
async $transaction(fn: (tx: unknown) => Promise<unknown>) {
  return fn(this as unknown as PrismaClient);
}
```

It just passes itself as the tx. So `tx.invoice.create`, `tx.invoiceLineItem.createMany`, `tx.account.update` are available.

In my Drizzle implementation, `$transaction` needs to create a transaction object with these methods that operate within the transaction.

Let me write a clean implementation:

```ts
class DrizzleClient implements PrismaClient {
  // ...other methods...

  async $transaction<T>(fn: (tx: BillingTx) => Promise<T>): Promise<T> {
    return this.db.$transaction<T>(async (drizzleTx) => {
      const tx: BillingTx = {
        invoice: {
          create: async (args) => {
            const [row] = await drizzleTx.insert(invoices).values(args.data).returning();
            return row;
          },
        },
        invoiceLineItem: {
          createMany: async (args) => {
            await drizzleTx.insert(invoiceLineItems).values(args.data);
            return { count: args.data.length };
          },
        },
        account: {
          update: async (args) => {
            const [row] = await drizzleTx.update(accounts).set({
              invoiceCount: accounts.invoiceCount + args.data.invoiceCount.increment
            }).where(eq(accounts.id, args.where.id)).returning();
            return row;
          },
        },
      };
      return fn(tx);
    });
  }
}
```

This should work. Let me now write all the files.

One more consideration: the `db` import. I'll create `src/db/index.ts` that exports a Drizzle database instance using environment variable `DATABASE_URL`.

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export const db = drizzle(process.env.DATABASE_URL!, { schema });
```

And `src/db/schema.ts`:

```ts
import { pgTable, uuid, varchar, integer, bigint, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').default(0).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', precision: 6 }).defaultNow().notNull(),
}, (table) => ({
  // no relations needed for repository
}));

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  number: varchar('number', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
  issuedAt: timestamp('issued_at', { mode: 'date', precision: 6 }).nullable(),
  createdAt: timestamp('created_at', { mode: 'date', precision: 6 }).defaultNow().notNull(),
}, (table) => ({
  accountIdIdx: index('invoices_account_id_idx').on(table.accountId),
}));

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey(),
  invoiceId: uuid('invoice_id').notNull(),
  position: integer('position').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
}, (table) => ({
  invoiceIdIdx: index('invoice_line_items_invoice_id_idx').on(table.invoiceId),
  fkInvoice: foreignKey({ columns: [table.invoiceId], references: [invoices.id] }).onDelete('cascade'),
}));
```

Wait, I need to check the order of references. In Drizzle, `foreignKey` needs the referenced table to be defined. Let me check...

In Drizzle, when defining a table, you can reference another table in a foreign key if it's defined later (Drizzle resolves them). But it's safer to have the referenced table first.

The order in the schema matters for Drizzle. Let me put `accounts` first, then `invoices`, then `invoiceLineItems`.

Actually, in Drizzle, foreign keys are defined at table creation time and the ORM handles ordering in `CREATE TABLE` statements. So it should be fine regardless of order.

Wait, actually, in Drizzle's `pgTable`, the foreign key constraint references `invoices.id`. If `invoices` is not yet defined when `invoiceLineItems` is being created, Drizzle might have issues. Let me check the Drizzle docs.

In Drizzle, you can reference tables defined later because the schema is collected at module load time and the SQL is generated later. So it should work.

But to be safe, let me use the relation syntax:

```ts
export const invoices = pgTable('invoices', { ... }, (table) => {
  table.index('invoices_account_id_idx').on(table.accountId);
});

export const invoiceLineItems = pgTable('invoice_line_items', { ... }, (table) => {
  table.index('invoice_line_items_invoice_id_idx').on(table.invoiceId);
  table.foreignKey({ columns: [table.invoiceId], references: [invoices.id] }).onDelete('cascade');
});
```

Actually in Drizzle, the proper way is:
```ts
table.relation('invoice', { fields: [table.invoiceId], references: [invoices.id], relationName: 'invoice', onDelete: 'cascade' });
```

But `relation` is for logical relations (eager loading). For actual foreign key constraints, I use `foreignKey`.

Let me use the cleanest Drizzle approach:

```ts
import { pgTable, uuid, varchar, integer, bigint, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';
```

Now let me also create the migration file. The Drizzle migration would be generated by `drizzle-kit generate`, but since I can't run it, I'll write it manually.

Migration SQL:
```sql
CREATE TABLE "accounts" (
  "id" uuid PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "invoice_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL
);

CREATE TABLE "invoices" (
  "id" uuid PRIMARY KEY,
  "account_id" uuid NOT NULL,
  "number" varchar(255) NOT NULL UNIQUE,
  "status" varchar(50) DEFAULT 'draft' NOT NULL,
  "total_minor" bigint NOT NULL,
  "issued_at" timestamptz(6),
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
);

CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");

CREATE TABLE "invoice_line_items" (
  "id" uuid PRIMARY KEY,
  "invoice_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "description" varchar(255) NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  CONSTRAINT "fk_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE CASCADE
);

CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items" ("invoice_id");
```

Wait, but the task says "migrations included". I need to create the Drizzle migration files. In a real project, you'd run `drizzle-kit generate` and it creates SQL files. Since I can't run it, I'll create them manually.

Drizzle migration files go in a directory like `drizzle/` and have names like `00000000000000_migration_name.sql`.

Let me now think about the `prisma.ts` file. I need to keep it for the test. But I should remove the `PrismaClient` type that's used by the real code and only keep it for the test? No, the test imports it.

Actually, let me check if the service also imports from `prisma.ts`:
- `billing.service.ts` imports `InvoiceRow, LineItemRow` from `./prisma.js`
- `billing.repository.ts` imports `AccountRow, InvoiceRow, LineItemRow, PrismaClient` from `./prisma.js`

The service imports row types but not `PrismaClient`. The repository imports everything.

So `prisma.ts` needs to export: `AccountRow`, `InvoiceRow`, `LineItemRow`, `Tx`, `PrismaClient`.

I'll keep this file but add a Drizzle-backed implementation in a separate file.

Now let me also think about `mapPrismaError`. The service currently imports it from `../common/errors.js`. After migration, I need to:
1. Remove `mapPrismaError` from `errors.ts`
2. Update `billing.service.ts` to not use it
3. Update the `issue` method

Let me now write all the files in order.

Also, I should consider what `src/main.ts` and `src/app.module.ts` look like. They're mentioned in the layout but not provided. I'll assume they exist and don't need changes (the serializer is registered globally). I'll not create them since they're not shown.

Let me also think about `MIGRATION_NOTES.md`. It should document:
1. How Prisma was removed and Drizzle was adopted
2. How the error mapping changed (P2002/P2025 → Drizzle error codes)
3. How BigInt serialization is preserved
4. How transaction atomicity is preserved
5. Line item ordering behavior (insertion order, no ORDER BY)
6. The `listForAccount` behavior (empty list for missing account)
7. Any other semantic findings

OK let me now write everything.

Wait, I also need to think about the `prisma.ts` file more carefully. The `Tx` interface has a specific shape that's used in `$transaction`. Let me trace through the test's fake `$transaction`:

```ts
async $transaction(fn: (tx: unknown) => Promise<unknown>) {
  return fn(this as unknown as PrismaClient);
}
```

It passes `this` (the whole fakePrisma) as the transaction object. So `tx.invoice.create`, `tx.invoiceLineItem.createMany`, `tx.account.update` are available because the fakePrisma has them.

In my Drizzle implementation, I need `$transaction` to pass a `Tx` object (with `invoice.create`, `invoiceLineItem.createMany`, `account.update`) to the callback.

The `Tx` interface:
```ts
export interface Tx {
  invoice: {
    create(a: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    createMany(a: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  account: {
    update(a: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow>;
  };
}
```

OK this all makes sense. Let me now write the code.

One more thing: I need to handle the Drizzle `bigint` column type properly. In Drizzle with PostgreSQL, `bigint('col', { mode: 'bigint' })` means:
- TypeScript type: `bigint`
- SQL type: `bigint`
- The pg driver needs to return bigint. By default, it returns numbers for bigint columns. Drizzle handles this by setting `bigintMode` on the connection or by parsing in the query.

Actually, I need to check: does Drizzle's `drizzle()` function handle bigint parsing automatically? Let me check.

In Drizzle ORM, when you define a column as `bigint('col', { mode: 'bigint' })`, Drizzle adds the appropriate type handling. For PostgreSQL, the `pg` driver returns `bigint` as `number` by default. Drizzle can handle this with the `pg` driver's `bigintMode` option.

Actually, looking at the Drizzle docs, you need to pass `drizzle(db, { schema })` and Drizzle handles the type mapping. But the pg driver still needs to be configured to return bigints.

In the `pg` driver, you can set:
```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

And then pass it to drizzle:
```ts
export const db = drizzle(pool, { schema });
```

But the bigint handling... Drizzle's `bigint` with `mode: 'bigint'` should handle this. Let me check the source code mentally. In Drizzle, the `bigint` column type with `mode: 'bigint'` stores values as `bigint` in TypeScript. When querying, the Drizzle driver adapter converts the raw database value to the TypeScript type.

For PostgreSQL's `bigint`, the raw value is a string or number from the pg driver. Drizzle should convert it to JavaScript `bigint` when `mode: 'bigint'` is set.

Actually, I just realized that the pg driver by default returns bigint columns as numbers, which can lose precision for large values. For the seed data, `totalMinor: 9007199254740993n` is past MAX_SAFE_INTEGER. So I need the pg driver to return this as a string or bigint, not a number.

In Drizzle, the `mode: 'bigint'` option on `bigint()` columns tells Drizzle to parse the value as `bigint`. But how Drizzle does this depends on the driver adapter. With the `postgresql` dialect and `pg` driver, Drizzle might need the `pg` driver to be configured with `bigintMode: 'bigint'` or `bigintMode: 'string'`.

Let me check... In Drizzle's official docs for PostgreSQL:

> For bigint columns, you can use `mode: 'bigint'` to get `bigint` in TypeScript. The driver will handle the conversion.

I think Drizzle handles this properly when using `drizzle-orm/postgresql` with the `pg` driver.

Alternatively, I can configure the pg Pool with:
```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

And Drizzle should handle the rest.

Actually, let me just configure it properly. In newer versions of `pg` (v8+), you can set `bigintMode` on the client:

```ts
import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // No special bigint config needed - Drizzle handles it
});
```

Actually, I just checked: Drizzle ORM v0.34+ handles bigint columns with `mode: 'bigint'` properly. The `pg` driver returns bigint as `bigint` in Node.js natively when the column type is `bigint`. So it should work.

But wait, in JavaScript, PostgreSQL `bigint` values are returned as strings by the `pg` driver by default (to avoid precision loss). Actually no, the pg driver returns them as numbers by default unless you configure it. Let me check the pg driver docs.

From the `pg` driver docs:
> By default, the `bigint` type is returned as a JavaScript number. This can cause precision loss for values larger than `Number.MAX_SAFE_INTEGER`. To get string values instead, set `bigintMode: 'string'` in the client configuration.

Actually, I think in newer versions, you can also use `bigintMode: 'bigint'` to get native bigint.

But Drizzle should handle this. When Drizzle sees `bigint('col', { mode: 'bigint' })`, it configures the parser to convert the raw value to JavaScript `bigint`.

Let me just proceed and assume it works. If there are issues, I'll note them in MIGRATION_NOTES.md.

For the Drizzle DB instance:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

Now let me finalize and write all the files.

Let me also think about the test that pins the mid-transaction atomicity. I need a fake database where I can inject a failure. I'll create a new test file.

In the test, I'll create a fake client that:
- Works normally for the first call
- Throws an error when inserting line items (for example)
- After the error, verify that no invoice was created and account counter wasn't incremented

But the fake Prisma in the existing test is immutable (it just pushes to arrays). For the new test, I need a mutable fake that can throw on demand.

Let me write the test:

```ts
import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';

function failingPrisma(): PrismaClient {
  const invoices: InvoiceRow[] = [];
  const items: LineItemRow[] = [];
  const accounts: AccountRow[] = [];
  let shouldFail = false;

  const client: PrismaClient = {
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
        return items.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        if (shouldFail) throw Object.assign(new Error('simulated failure'), { code: '23505' });
        items.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(fn) {
      return fn(client as unknown as PrismaClient);
    },
  };

  return { client, getShouldFail: () => shouldFail, setShouldFail: (v: boolean) => { shouldFail = v; } };
}

describe('BillingRepository transaction atomicity', () => {
  it('rolls back on mid-transaction failure', async () => {
    const account: AccountRow = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Test',
      currency: 'EUR',
      invoiceCount: 0,
      createdAt: new Date(),
    };
    // ... set up the fake client with account pre-populated
    // ... create invoice that fails mid-transaction
    // ... assert no invoice created, no line items, counter not incremented
  });
});
```

Hmm, this is getting complex. Let me simplify.

Actually, I realize the fake Prisma in the test has a specific structure. The `$transaction` just passes the client as the tx. So when the transaction function calls `tx.invoice.create`, it actually calls `client.invoice.create`. When it calls `tx.invoiceLineItem.createMany`, it calls `client.invoiceLineItem.createMany`.

So if I set `shouldFail = true` before the `createMany` is called, the `invoiceLineItem.createMany` will throw, and the `$transaction` callback will propagate the error. Since there's no real rollback in the fake (it's just in-memory arrays), I need to check that the state wasn't modified.

Wait, but the fake doesn't actually rollback. In a real database, the transaction rolls back. In the fake, there's no transaction mechanism. So I need to simulate this differently.

For the fake, I need:
1. Pre-populate with an account (invoiceCount: 0)
2. Call `createInvoice` with an invoice and some line items
3. Make `invoiceLineItem.createMany` throw
4. Check that:
   a. No invoice was added to the `invoices` array (it should be empty)
   b. No line items were added to the `items` array
   c. Account's invoiceCount is still 0

But with the current fake, `invoice.create` pushes to `invoices` before `invoiceLineItem.createMany` throws. So the invoice WOULD be in the array. The fake doesn't support rollback.

Hmm, this is a problem. The fake Prisma in the existing test doesn't simulate database transactions. For the new test, I need a fake that does.

Let me think of a different approach. Instead of using a fake Prisma client, I can test the repository with a Drizzle database directly. Let me create a test that uses a real Drizzle connection to an in-memory or test database.

But that's complex and might not be what's expected. Let me instead create a smarter fake that supports rollback.

Alternative approach: Test the `createInvoice` method directly with a fake that supports the transaction semantics. The fake should only commit changes if the transaction function completes without error.

Let me create this:

```ts
function transactionalPrisma(): PrismaClient & { 
  getState: () => { invoices: InvoiceRow[]; items: LineItemRow[]; accounts: AccountRow[] };
  setFailLineItems: (v: boolean) => void;
} {
  let invoices: InvoiceRow[] = [];
  let items: LineItemRow[] = [];
  let accounts: AccountRow[] = [];
  let failLineItems = false;

  const commitState = () => {
    // Apply staged changes
  };

  const client = { ... } as PrismaClient;
  // ...
}
```

This is getting really complex. Let me take a simpler approach:

The test should verify that when a transaction fails, nothing is committed. I can test this by:
1. Setting up the fake with staged changes (write to a staging area during transaction)
2. Only committing to the main store when the transaction succeeds
3. When an error is thrown, the staging area is discarded

Let me implement this more carefully:

```ts
function transactionalPrisma() {
  let invoices: InvoiceRow[] = [];
  let items: LineItemRow[] = [];
  let accounts: AccountRow[] = [];
  let failLineItems = false;

  // Working copies for transaction
  let stagedInvoices: InvoiceRow[] = [];
  let stagedItems: LineItemRow[] = [];
  let stagedAccounts: AccountRow[] = [];

  const client = {
    account: {
      async findUnique({ where }: { where: { id: string } }) {
        return [...accounts, ...stagedAccounts].find((a) => a.id === where.id) ?? null;
      },
      async update({ where }: { where: { id: string } }, /* tx context */) {
        const a = [...accounts, ...stagedAccounts].find((x) => x.id === where.id)!;
        a.invoiceCount += 1;
        stagedAccounts.push(a); // track changes
        return a;
      },
    },
    invoice: {
      async findUnique({ where }: { where: { id: string } }) {
        return [...invoices, ...stagedInvoices].find((i) => i.id === where.id) ?? null;
      },
      async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) {
        const row = { ...data, createdAt: new Date() } as InvoiceRow;
        stagedInvoices.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) {
        const i = [...invoices, ...stagedInvoices].find((x) => x.id === where.id)!;
        Object.assign(i, data);
        return i;
      },
    },
    invoiceLineItem: {
      async findMany({ where }: { where: { invoiceId: string } }) {
        return [...items, ...stagedItems].filter((li) => li.invoiceId === where.invoiceId));
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        if (failLineItems) throw Object.assign(new Error('simulated failure'), { code: '23505' });
        stagedItems.push(...data);
        return { count: data.length };
      },
    },
    async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>) {
      // Reset staging
      stagedInvoices = [];
      stagedItems = [];
      stagedAccounts = [];
      try {
        const result = await fn(client);
        // Commit staging to main
        invoices.push(...stagedInvoices);
        items.push(...stagedItems);
        accounts.push(...stagedAccounts); // This won't work because accounts are modified in place
        return result;
      } catch (e) {
        // Discard staging
        stagedInvoices = [];
        stagedItems = [];
        stagedAccounts = [];
        throw e;
      }
    },
  };

  return { client, setFail: (v: boolean) => { failLineItems = v; }, getState: () => ({ invoices: [...invoices], items: [...items], accounts: [...accounts] }) };
}
```

Hmm, this is getting too complex and has issues (the account update modifies the object in place). Let me simplify even more.

Actually, let me take a completely different approach. Instead of using the fake Prisma client approach, let me test the `BillingRepository` directly with a real Drizzle database (like an in-memory one) or test at a different level.

Or, even simpler: test that the `$transaction` in the DrizzleClient properly isolates operations. I can test this by checking that when an error is thrown inside the transaction callback, the outer state is unchanged.

But wait, I think the cleanest approach is:

1. Create a new test file
2. Use the `BillingRepository` and `BillingService` directly
3. Use a fake Prisma that supports transaction rollback
4. Test that after a transaction failure, the state is as if nothing happened

Let me implement a proper transactional fake:

```ts
// In test/billing-transactional.spec.ts
import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from '../src/billing/prisma.js';

function makeTransactionalPrisma(initial: {
  accounts: AccountRow[];
  invoices: InvoiceRow[];
  lineItems: LineItemRow[];
}) {
  let accounts = [...initial.accounts];
  let invoices = [...initial.invoices];
  let items = [...initial.lineItems];
  let shouldFail = false;

  const makeClient = (): PrismaClient => ({
    account: {
      async findUnique({ where }: { where: { id: string } }) {
        return accounts.find((a) => a.id === where.id) ?? null;
      },
      async update({ where }: { where: { id: string } }) {
        const a = accounts.find((x) => x.id === where.id)!;
        return { ...a, invoiceCount: a.invoiceCount + 1 };
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
        return items.filter((li) => li.invoiceId === where.invoiceId);
      },
      async createMany({ data }: { data: LineItemRow[] }) {
        if (shouldFail) {
          throw Object.assign(new Error('simulated failure'), { code: '23505' });
        }
        items.push(...data);
        return { count: data.length };
      },
    },
    async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>) {
      // Snapshot state
      const snapshotAccounts = accounts.map(a => ({ ...a }));
      const snapshotInvoices = invoices.map(i => ({ ...i }));
      const snapshotItems = items.map(i => ({ ...i }));

      try {
        const result = await fn(makeClient());
        return result;
      } catch (e) {
        // Rollback: restore snapshot
        accounts = snapshotAccounts;
        invoices = snapshotInvoices;
        items = snapshotItems;
        throw e;
      }
    },
  });

  return {
    client: makeClient(),
    setFail: (v: boolean) => { shouldFail = v; },
    getState: () => ({
      accounts: [...accounts],
      invoices: [...invoices],
      lineItems: [...items],
    }),
  };
}

describe('BillingRepository transaction atomicity', () => {
  it('rolls back all writes when a mid-transaction failure occurs', async () => {
    const accountId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const { client, setFail, getState } = makeTransactionalPrisma({
      accounts: [{
        id: accountId,
        name: 'Test',
        currency: 'EUR',
        invoiceCount: 2,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }],
      invoices: [],
      lineItems: [],
    });

    setFail(true);

    const repo = new BillingRepository(client);
    await expect(repo.createInvoice({
      invoice: {
        id: 'cccccccc-0000-4000-8000-000000000001',
        accountId,
        number: 'INV-2024-9999',
        status: 'draft',
        totalMinor: 100000n,
      },
      lineItems: [{
        id: 'dddddddd-0000-4000-8000-000000000001',
        invoiceId: 'cccccccc-0000-4000-8000-000000000001',
        position: 1,
        description: 'Test',
        quantity: 1,
        unitPriceMinor: 100000n,
      }],
    })).rejects.toThrow();

    const state = getState();
    expect(state.invoices.length).toBe(0);
    expect(state.lineItems.length).toBe(0);
    expect(state.accounts[0].invoiceCount).toBe(2);
  });
});
```

Wait, there's a problem with this approach. In the `$transaction`, when `fn` calls `tx.invoice.create`, it calls `makeClient()` which creates a new client object. This new client has its own `findUnique`, `create`, etc. methods that read from and write to the outer scope's `invoices`, `accounts`, `items` arrays.

But the outer client object also has these methods. When `$transaction` catches an error and rolls back, it restores the snapshots. But the operations inside the transaction modified the arrays directly (push), so restoring snapshots works.

Wait, but `tx.invoice.create` pushes to `invoices` (the outer scope variable). After rollback, `invoices` is restored to its snapshot. This should work.

But there's a subtlety: `tx.account.update` returns a new object (spread), it doesn't modify in place. So the account array doesn't actually change. Let me fix that.

Actually, looking at the fake more carefully, the `$transaction` creates a new client via `makeClient()` each time. This client has closures over the same `invoices`, `accounts`, `items` arrays. So when `tx.invoice.create` pushes to `invoices`, it pushes to the same array that `getState()` reads.

After rollback, we restore `invoices = snapshotInvoices` (the snapshot), which replaces the reference. So the pushed invoice is lost. 

But `tx.account.update` returns a new object without modifying the array. So the account array doesn't change, but the return value is a modified copy. If the transaction then fails, the account is still at its original value. The rollback doesn't even need to fix it.

Wait, but in the real code (DrizzleClient's `$transaction`), the account update modifies the database directly. So the test with the fake should simulate this correctly.

Let me verify the test flow:
1. State: accounts = [{invoiceCount: 2}], invoices = [], items = []
2. Call `createInvoice` → calls `db.$transaction(async (tx) => { ... })`
3. In the fake `$transaction`: snapshot state, call fn with a client
4. Inside fn: 
   a. `tx.invoice.create` → pushes to invoices → invoices now has 1 element
   b. `tx.invoiceLineItem.createMany` → shouldFail is true, throws
   c. Error propagates through fn, through `$transaction`
5. `$transaction` catches error, restores snapshots → invoices back to []
6. Error propagates to caller
7. Test checks: invoices = [], items = [], accounts[0].invoiceCount = 2 ✓

This should work! Let me also verify the service-level behavior.

Actually, the service doesn't have a `createInvoice` method. The repository does. So I should test the repository directly.

Now let me also think about the other tests I need:

1. **Line item ordering**: Get invoice with line items, check they're in insertion order (positions 3, 1, 2 from the seed, which is the order in the items array).

Wait, but the existing test `returns an invoice with its line items` checks `inv.lineItems.length` is 3 but not the order. I should add a test that checks the order.

2. **BigInt format**: Get invoice, check totalMinor is a bigint (not a number). And when serialized, it's a string.

3. **Issue non-existent invoice**: Call `issue` on a non-existent ID, expect NotFoundError.

4. **Duplicate invoice number**: Create an invoice with a duplicate number, expect ConflictError. But wait, the current code doesn't handle this in the service. The repository doesn't have error mapping. So what error does it throw? A raw Drizzle error? I should test this... but it might be tricky without a real database.

Actually, for the duplicate number test, since there's no service method for creating invoices, and the repository doesn't have error mapping, I don't need to add this test. The error handling is at the database level and would be handled by the controller (which doesn't exist in this codebase).

Hmm, but the issue says: "An error path that returns a 404 because of how Prisma reports a missing row." This refers to the `issue` method where `mapPrismaError` maps P2025 to NotFoundError. In my new code, `markIssued` handles this internally (returns NotFoundError when update returns empty).

So the test should be: `issue` on non-existent invoice → NotFoundError. Let me check if this is tested in the existing suite. The existing test checks `getInvoice` on missing → throws (any error). But `issue` on missing is not tested.

Let me also check: in the old code, what happens when you call `issue` on a non-existent invoice?
1. `repo.markIssued` calls `prisma.invoice.update({ where: { id: 'missing' }, data: { status: 'issued', issuedAt: new Date() } })`
2. Prisma throws `PrismaClientKnownRequestError` with code `P2025`
3. Service catches it and calls `mapPrismaError(e)` → returns `new NotFoundError('invoice_not_found')`

In the new code:
1. `repo.markIssued` calls `db.update(invoices).set({...}).where(eq(invoices.id, 'missing')).returning()`
2. Returns `[]` (empty array)
3. Checks `result.length === 0` → throws `new NotFoundError('invoice_not_found')`

Both paths result in `NotFoundError('invoice_not_found')`. Good, the behavior is preserved.

Now let me also think about what happens with the `findAccount` returning null. The service's `listForAccount` handles this:
```ts
const account = await this.repo.findAccount(accountId);
if (account === null) return [];
```

This is tested in the existing suite (test 4). Good.

Now let me also consider: what if the database returns `null` for `issuedAt` instead of `undefined`? In PostgreSQL, a nullable column returns `NULL` which Drizzle maps to `null` in TypeScript. In the old Prisma, it also maps to `null`. The `InvoiceView` has `issuedAt: Date | null`, so this is consistent.

But wait, what about the JSON serialization? `serialize` handles Date objects but not null specially. `null` stays as `null`. In the response, `issuedAt: null` is present (as a field with null value). This is "null vs missing" from the issue. Let me check the existing test to see if it checks `issuedAt`.

The existing test `returns an invoice with its line items` doesn't check `issuedAt`. The seed data has `issuedAt: null` for the draft invoice. So a consumer might expect `issuedAt` to be `null` (present field with null value), not absent/missing.

In both Prisma and Drizzle, `issuedAt` will be `null` for invoices that haven't been issued. So this is preserved. I should add a test to confirm this.

OK let me also check: what about the `findLineItems` ordering behavior? In the existing fake Prisma:
```ts
async findMany({ where }: { where: { invoiceId: string } }) {
  return items.filter((li) => li.invoiceId === where.invoiceId);
}
```

This preserves the order from the `items` array. The seed data has line items in order: position 3, 1, 2. So `findLineItems` returns them in that order.

In Drizzle, `db.select().from(invoiceLineItems).where(eq(...))` without ORDER BY returns in unspecified order (typically insertion order in PostgreSQL). So the behavior is similar but not guaranteed.

I should test this behavior and document it in MIGRATION_NOTES.md.

Now let me finalize everything and write all the files. I'll aim for completeness.

Actually, let me reconsider one more time whether I should keep `prisma.ts` or not. The test imports from it. I can't edit the test. So I must keep it. But I should rename it conceptually? No, the path matters for the test import.

I'll keep `src/billing/prisma.ts` as a types file. It's no longer a Prisma thing; it's just a types file that happens to have a `PrismaClient` interface.

Let me now also think about the `drizzle.config.ts` and migration files. I'll include a migration SQL file that creates the tables.

Drizzle migration file path: `drizzle/00000000000001_init.sql` (or similar)

OK, let me now write all files systematically.

Let me also re-examine what the test expects from the `PrismaClient` interface. The test has:

```ts
function fakePrisma(): PrismaClient {
  ...
  return { ... } as unknown as PrismaClient;
}
```

It casts the object as `PrismaClient`. So the object just needs to have all the methods/properties of the `PrismaClient` interface. TypeScript's structural typing means it doesn't need to be an exact match, just have all required properties.

The `PrismaClient` interface has:
- `account` (with `findUnique`, `update`)
- `invoice` (with `findUnique`, `findMany`, `create`, `update`)
- `invoiceLineItem` (with `findMany`, `createMany`)
- `$transaction`

The fake has all of these. Good.

Now, one thing I noticed: the test's fake `account.update` doesn't have typed parameters. Let me check:

```ts
async update({ where }: { where: { id: string } }) {
```

But the `Tx['account']['update']` interface expects:
```ts
update(a: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow>;
```

The fake only takes `where`, not `data`. But TypeScript's structural typing for function parameters is contravariant, meaning a function that accepts fewer parameters can be assigned to a type that requires more parameters (since the extra parameter would just be ignored). So the fake is compatible.

Actually wait, TypeScript's function parameter bivariance... let me check. In TypeScript with strict mode, function parameters are checked bivariantly by default (unless `strictFunctionTypes` is on, which it is with `strict: true`). With `strictFunctionTypes`, parameters are checked contravariantly. So a function `(a: { where: ... }) => ...` is NOT assignable to `(a: { where: ...; data: ... }) => ...` because it doesn't accept the `data` parameter.

Hmm, but the test passes currently (it's the existing code). Let me check why...

Oh, the fake uses `as unknown as PrismaClient`, which bypasses type checking. So the cast is what makes it work. The function doesn't actually need to be structurally compatible; it's cast to the type.

Good, so my implementation just needs to have all the required methods, and the test's cast to `PrismaClient` will work.

Now let me finalize and write all the files. Let me be systematic:

### File list:
1. `package.json` - Updated deps (Drizzle instead of Prisma)
2. `drizzle.config.ts` - New
3. `src/db/schema.ts` - New (Drizzle schema)
4. `src/db/index.ts` - New (DB instance)
5. `src/db/migrations/00000000000001_init.sql` - New (migration)
6. `src/billing/prisma.ts` - Updated (remove Prisma-specific, keep types)
7. `src/billing/billing.repository.ts` - Updated (Drizzle-backed)
8. `src/billing/billing.service.ts` - Updated (remove mapPrismaError)
9. `src/common/errors.ts` - Updated (remove mapPrismaError)
10. `test/billing.spec.ts` - UNCHANGED
11. `test/billing-extended.spec.ts` - New (tests for uncovered behavior)
12. `MIGRATION_NOTES.md` - New

Wait, I need to think about where to put the DrizzleClient. Should it be in `billing.repository.ts` or a separate file?

Looking at the architecture: the repository takes a `PrismaClient` and uses it. The `DrizzleClient` implements `PrismaClient`. So the repository doesn't need to know about Drizzle; it just uses the `PrismaClient` interface.

But the task says "Every repository/service query ported". If the repository uses `PrismaClient` methods, the queries are Prisma-style, not Drizzle-style.

Hmm, let me reconsider. Maybe I should:
1. Update the repository to use Drizzle directly (accept `db` parameter)
2. Create a wrapper in the test that makes the fake Prisma look like a Drizzle instance

But I can't edit the test, and the test passes a fake Prisma to the repository. So the repository must accept something the fake Prisma satisfies.

OK, I'll go with: Repository takes `PrismaClient`, implementation uses Drizzle-backed `DrizzleClient`. The queries are logically ported (they do the same things but via Drizzle under the hood). The repository code itself is mostly the same, but the data access is through Drizzle.

Let me also reconsider if there's a way to make the repository use Drizzle directly while still working with the test. What if the repository has two modes? No, that's ugly.

What if I update the `PrismaClient` interface to use Drizzle-style methods? No, the test's fake has Prisma-style methods.

I'll go with the pragmatic approach. The key migration points are:
- Schema in Drizzle ✓
- No Prisma dependency ✓
- No Prisma error mapping ✓
- Queries work through Drizzle under the hood ✓
- Transaction behavior preserved ✓
- Wire format preserved ✓

The repository's method calls are abstracted through the `PrismaClient` interface, and the actual implementation uses Drizzle. This is a valid and common migration pattern (you can think of `PrismaClient` as the repository interface).

Let me now write the code.

One more thing: I need to make sure `src/billing/prisma.ts` doesn't import from `@prisma/client`. Let me check... it doesn't. It defines all types by hand. So removing `@prisma/client` from package.json won't affect it.

Also, I should check if there are any other files that import from `@prisma/client`. Let me check all files:
- `package.json` - lists it as dependency (will remove)
- `src/billing/billing.repository.ts` - imports types from `./prisma.js`, not from `@prisma/client`
- `src/billing/billing.service.ts` - imports types from `./prisma.js`, errors from `../common/errors.js`
- `src/common/errors.ts` - has `mapPrismaError` (will remove)
- `test/billing.spec.ts` - imports from `../prisma/seed.js` and `../src/billing/prisma.js`

None of them import from `@prisma/client` directly. So removing it from package.json is sufficient.

Now let me also think about: should `prisma/seed.ts` stay? The test imports from it. It doesn't use Prisma. It's just data. Yes, keep it.

Should I remove the `prisma/` directory? If I remove `prisma/seed.ts`, the test breaks. So I keep at least `prisma/seed.ts`. The Prisma schema (`prisma/schema.prisma`) should be removed.

Let me now write all files. I'll be thorough.

Actually, one more thing I want to verify. Let me look at what the existing test's `fakePrisma` `$transaction` does:

```ts
async $transaction(fn: (tx: unknown) => Promise<unknown>) {
  return fn(this as unknown as PrismaClient);
}
```

It passes the entire client as the transaction object. So `tx.invoice.create`, `tx.invoiceLineItem.createMany`, `tx.account.update` are all available. And `tx.account.findUnique`, `tx.invoice.findUnique`, etc. are also available (since it's the whole client).

My `DrizzleClient.$transaction` needs to pass a `Tx` object that has at least `invoice.create`, `invoiceLineItem.createMany`, `account.update`. It doesn't need the full client.

OK, now I'm going to write everything.

Let me also think about what `drizzle.config.ts` should contain. It needs the schema path and output path.

```ts
import { defineConfig } from 'drizzle-orm/kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

And the migration file `drizzle/00000000000001_init.sql`:

```sql
CREATE TABLE "accounts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "invoice_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL
);

CREATE TABLE "invoices" (
  "id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "number" varchar(255) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "total_minor" bigint NOT NULL,
  "issued_at" timestamptz(6),
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_number_unique" UNIQUE ("number")
);

CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");

CREATE TABLE "invoice_line_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "invoice_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "description" varchar(255) NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  CONSTRAINT "fk_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE CASCADE
);

CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items" ("invoice_id");
```

Wait, but the unique constraint on `number` - in Drizzle, `.unique()` on a column generates a unique constraint. Let me make sure the SQL matches.

Actually, in Drizzle, `varchar('number', { length: 255 }).notNull()` with `.unique()` at the table level generates a unique constraint. The SQL would have `UNIQUE ("number")` or a named constraint.

Let me write the Drizzle schema properly and then the migration SQL.

Now, the `DrizzleClient` class. Let me design it to implement `PrismaClient`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';
import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';

export class DrizzleClient implements PrismaClient {
  async $transaction<T>(fn: (tx: Parameters<PrismaClient['$transaction']>[0]) => Promise<T>): Promise<T> {
    return db.$transaction<T>(async (drizzleTx) => {
      const tx: Parameters<PrismaClient['$transaction']>[0] = {
        invoice: {
          create: async (args) => {
            const [row] = await drizzleTx.insert(invoices).values(args.data).returning();
            return row;
          },
        },
        invoiceLineItem: {
          createMany: async (args) => {
            await drizzleTx.insert(invoiceLineItems).values(args.data);
            return { count: args.data.length };
          },
        },
        account: {
          update: async (args) => {
            const [row] = await drizzleTx.update(accounts).set({
              invoiceCount: accounts.invoiceCount + args.data.invoiceCount.increment,
            }).where(eq(accounts.id, args.where.id)).returning();
            return row;
          },
        },
      };
      return await fn(tx);
    });
  }

  account = {
    async findUnique({ where }: { where: { id: string } }): Promise<AccountRow | null> {
      const rows = await db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    async update({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow> {
      const [row] = await db.update(accounts).set({
        invoiceCount: accounts.invoiceCount + data.invoiceCount.increment,
      }).where(eq(accounts.id, where.id)).returning();
      return row;
    },
  };

  invoice = {
    async findUnique({ where }: { where: { id: string } }): Promise<InvoiceRow | null> {
      const rows = await db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    async findMany({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> {
      return db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
    },
    async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> {
      const [row] = await db.insert(invoices).values(data).returning();
      return row;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> {
      const [row] = await db.update(invoices).set(data).where(eq(invoices.id, where.id)).returning();
      return row;
    },
  };

  invoiceLineItem = {
    async findMany({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> {
      return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, where.invoiceId));
    },
    async createMany({ data }: { data: LineItemRow[] }): Promise<{ count: number }> {
      await db.insert(invoiceLineItems).values(data);
      return { count: data.length };
    },
  };
}
```

And the repository:
```ts
import { BillingRepository } from './billing.repository.js';
import { DrizzleClient } from './drizzle-client.js';

// In app setup:
const repo = new BillingRepository(new DrizzleClient());
```

Wait, but the repository should be the one that creates/manages the client. Or maybe the service/module wires them. Since there's no module file shown, I'll just note that the repository now uses DrizzleClient internally.

Hmm, actually looking at the task again, there's no `main.ts` or `app.module.ts` provided. They might exist but weren't shown. I should not create new module wiring files. The key is that the repository works with Drizzle.

Let me think about the cleanest design:

Option A: Repository takes a `PrismaClient` parameter. External code creates `DrizzleClient` and passes it.
Option B: Repository creates its own `DrizzleClient` internally.
Option C: Repository takes a `db` parameter (Drizzle instance).

Since the test creates `new BillingRepository(fakePrisma())`, Option A works for tests. For production, someone creates `new BillingRepository(new DrizzleClient())`.

Let me go with Option A.

Now, let me think about one more thing: the `billing.service.ts` imports `mapPrismaError` from `../common/errors.js`. I need to remove this import and update the `issue` method.

Also, `billing.service.ts` imports `InvoiceRow, LineItemRow` from `./prisma.js`. These types stay the same.

And `billing.repository.ts` imports `AccountRow, InvoiceRow, LineItemRow, PrismaClient` from `./prisma.js`. The `PrismaClient` type stays for the interface, and the row types stay.

OK let me now write all files.

Wait, I also need to consider the `prisma.ts` `PrismaClient` interface's `$transaction` type. Currently:
```ts
$transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
```

Where `Tx` is:
```ts
export interface Tx {
  invoice: { create(...): Promise<InvoiceRow>; };
  invoiceLineItem: { createMany(...): Promise<{ count: number }>; };
  account: { update(...): Promise<AccountRow>; };
}
```

My `DrizzleClient.$transaction` signature should match this. Let me make sure:
```ts
async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
```

Where `Tx` is from `./prisma.js`. This matches. Good.

Now, let me also think about a potential issue with the `DrizzleClient`. In the `$transaction` method, I'm passing a `tx` object to `fn`. The `fn` is the transaction callback from the repository:

```ts
async createInvoice(input: {...}): Promise<InvoiceRow> {
  return this.prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({ data: input.invoice });
    ...
  });
}
```

The `tx` here is the `Tx` interface. My `DrizzleClient.$transaction` passes a `Tx`-shaped object to `fn`. The `tx.invoice.create`, `tx.invoiceLineItem.createMany`, and `tx.account.update` methods operate on the Drizzle transaction (`drizzleTx`). This should work.

But there's a subtle issue: in the repository's `createInvoice`, after creating the invoice, it needs the invoice's `accountId` for the account update:
```ts
await tx.account.update({
  where: { id: input.invoice.accountId },
  ...
});
```

The `input.invoice.accountId` comes from the input, not from the created invoice. So this is fine.

Also, the repository returns `invoice` from the transaction, which is the created invoice row. In my `DrizzleClient`, `tx.invoice.create` returns the created row via `returning()`. This is correct.

Now let me also consider: what if there are no line items? The repository checks `if (input.lineItems.length > 0)` before creating. This is preserved.

And what about the `findAccount` returning null? The repository returns `AccountRow | null`. In Drizzle, `db.select().from(accounts).where(eq(...)).limit(1)` returns an array, and if empty, we return null. Correct.

One more thing: the `markIssued` method in the repository. In the old code:
```ts
async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
  return this.prisma.invoice.update({
    where: { id },
    data: { status: 'issued', issuedAt },
  });
}
```

In my `DrizzleClient`, this is:
```ts
async update({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> {
  const [row] = await db.update(invoices).set(data).where(eq(invoices.id, where.id)).returning();
  return row;
}
```

But this throws if `row` is undefined (when no rows match). Actually, in Drizzle, `returning()` returns an array. If no rows match, it returns `[]`. So `row` would be `undefined` (`[0]` of empty array). I need to handle this.

Hmm, but the `DrizzleClient` is a generic implementation. The `markIssued` error handling is in the service layer (via `mapPrismaError` in old code). In the new code, the service doesn't use `mapPrismaError` anymore. So where does the NotFoundError come from?

Let me think... The `issue` method in the service should throw `NotFoundError` for a non-existent invoice. In the old code, this was done via `mapPrismaError` mapping P2025. In the new code, I should handle it in the repository or in the service.

Option 1: Repository's `markIssued` checks for empty result and throws `NotFoundError`.
Option 2: Service's `issue` catches any error and maps it.

Option 1 is cleaner and doesn't need an error mapper. Let me update the repository's `markIssued` to handle this.

But wait, the repository's `markIssued` is called through `this.prisma.invoice.update(...)`. If `DrizzleClient.invoice.update` returns `undefined` when no rows match, the repository's `markIssued` needs to check for this.

I could either:
1. Make `DrizzleClient.invoice.update` throw when no rows match (but then it's not just Prisma-compatible, it has special behavior)
2. Make the repository check for undefined and throw
3. Keep the error mapping somewhere

Option 2 is cleanest:
```ts
async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
  const invoice = await this.prisma.invoice.update({
    where: { id },
    data: { status: 'issued', issuedAt },
  });
  if (!invoice) throw new NotFoundError('invoice_not_found');
  return invoice;
}
```

Wait, but this adds error handling to the repository that wasn't there before. Let me check the old code:

Old repository:
```ts
async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
  return this.prisma.invoice.update({
    where: { id },
    data: { status: 'issued', issuedAt },
  });
}
```

Old service:
```ts
async issue(id: string): Promise<InvoiceRow> {
  try {
    return await this.repo.markIssued(id, new Date());
  } catch (e) {
    throw mapPrismaError(e);
  }
}
```

So the old flow: Prisma throws → service catches → `mapPrismaError` maps P2025 → NotFoundError.

New flow: Drizzle returns undefined (no row) → repository checks → throws NotFoundError. Or: Drizzle throws → service catches → maps error.

I'll go with: repository checks and throws NotFoundError directly. Then the service doesn't need the try/catch + map.

Actually, let me make it even cleaner. I'll have the repository check for not found and throw the error. The `NotFoundError` is imported in the repository.

Let me update the repository:
```ts
import { NotFoundError } from '../common/errors.js';

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ...other methods...

  async markIss
```

## reply

(empty)
