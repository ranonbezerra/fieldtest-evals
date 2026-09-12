# repair1-set

## reasoning

```
Let me analyze the two errors:

1. `src/db/db.schema.ts(65,73): error TS2353: Object literal may only specify known properties, and 'onDelete' does not exist in type '{ name?: string | undefined; columns: [ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>]; foreignColumns: [...]; }'`

Looking at the schema file, line 65 is:
```ts
foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], onDelete: 'cascade' }),
```

The issue is that `onDelete` is not a valid option for Drizzle's `foreignKey` function. In Drizzle, `onDelete` is set on the column definition using `.references()` method, not in the `foreignKey()` array callback. However, looking at the current code structure, the foreign key is defined in the array callback form.

Actually, let me reconsider. In Drizzle, there are two ways to define foreign keys:
1. Using `.references()` on the column: `uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' })`
2. Using `foreignKey()` in the table callback array.

The `foreignKey()` in the array callback does NOT accept `onDelete`. The `onDelete` constraint is part of the column's `.references()` call.

So the fix is to remove `onDelete: 'cascade'` from the `foreignKey()` call and instead add it to the column definition using `.references()`.

Wait, but looking more carefully at the Drizzle docs, the `foreignKey()` helper in the array form does support `onDelete` and `onUpdate` options in newer versions. Let me check what version they're using.

Actually, looking at the error message more carefully:
```
'onDelete' does not exist in type '{ name?: string | undefined; columns: [ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>]; foreignColumns: [...]; }'
```

The type only allows `name`, `columns`, and `foreignColumns`. So in this version of Drizzle, `onDelete` is not supported in the `foreignKey()` array callback.

The proper fix is to use `.references()` on the column instead:
```ts
invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
```

But wait, if I use `.references()`, I might not need the separate `foreignKey()` call for that relationship. Let me look at the current code:

```ts
export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
    foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], onDelete: 'cascade' }),
  ],
);
```

The fix: add `.references(() => invoices.id, { onDelete: 'cascade' })` to the `invoiceId` column and remove the `foreignKey()` from the array (or keep it without `onDelete`).

Actually, if I use `.references()`, the foreign key is already defined. Having both would be redundant. Let me just change the column to use `.references()` and remove the `foreignKey()` from the array.

Wait, but the task says "Change exactly what the compiler requires." The compiler only complains about `onDelete` not being in the type. The simplest fix that satisfies the compiler is to either:
1. Remove `onDelete: 'cascade'` from the `foreignKey()` call (but this changes behavior)
2. Move `onDelete: 'cascade'` to the column's `.references()` method (preserves behavior)

Option 2 is the correct one because it preserves the cascade behavior.

2. `test/db.ts(1,10): error TS2724: '"@electric-sql/pglite"' has no exported member named 'Pglite'. Did you mean 'PGlite'?`

The export is `PGlite` not `Pglite`. Simple rename.

So the two distinct mistakes are:
1. `onDelete` placement in Drizzle's foreign key — fix by moving to `.references()` on the column
2. `Pglite` vs `PGlite` — fix the import name

Let me write the fixed files.

For `src/db/db.schema.ts`:
- Change `invoiceId: uuid('invoice_id').notNull()` to `invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' })`
- Remove `foreignKey({ columns: [t.invoiceId], foreignColumns: [invoices.id], onDelete: 'cascade' }),` from the array
- Since we're removing the only `foreignKey` from the array, and the `index` is still there, we keep the array callback but just with the index.
- We can also remove the `foreignKey` import if it's no longer used.

Wait, let me check: is `foreignKey` used anywhere else in the file? Looking at the invoices table:
```ts
foreignKey({ columns: [t.accountId], foreignColumns: [accounts.id] }),
```

Yes! It's used in the invoices table too. So I keep the `foreignKey` import.

For `test/db.ts`:
- Change `import { Pglite } from '@electric-sql/pglite'` to `import { PGLite } from '@electric-sql/pglite'`
- Change `new Pglite(':memory:')` to `new PGLite(':memory:')`

Let me write out the complete files.
```

## reply

### src/db/db.schema.ts
```ts
import {
  bigint,
  char,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of the former prisma/schema.prisma: same tables, columns,
 * and constraints, with the same snake_case mapping. The DDL in
 * drizzle/0000_initial.sql is what actually lands in Postgres.
 *
 * Column modes matter for byte-compatibility with the Prisma contract:
 *  - bigint with mode 'bigint'  -> JS bigint (what Prisma returned)
 *  - timestamp with mode 'date' -> JS Date (what Prisma returned)
 * Drizzle's default modes ('number' / 'string') would have silently changed
 * the serialized wire format.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  invoiceCount: integer('invoice_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').notNull(),
    number: text('number').notNull().unique(),
    status: text('status').notNull().default('draft'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, precision: 6, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('invoices_account_id_idx').on(t.accountId),
    foreignKey({ columns: [t.accountId], foreignColumns: [accounts.id] }),
  ],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof invoiceLineItems.$inferSelect;
```

### test/db.ts
```ts
import { PGLite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/db/db.client.js';
import { accounts, invoices, invoiceLineItems } from '../src/db/db.schema.js';
import { seed } from './seed.js';

/**
 * Test database: a real in-process Postgres (Pglite, WASM) brought up by the
 * same migration SQL that production applies, so the suite exercises real
 * SQL, constraints and transactions with no external server and no
 * DATABASE_URL.
 *
 * The repository is typed against the production node-postgres client (`Db`).
 * Pglite's Drizzle client is structurally compatible for every query the
 * repository issues, so the single cast below is safe.
 */
export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

export async function openTestDb(): Promise<TestDb> {
  const pglite = new PGLite(':memory:');
  await pglite.ready;
  const rawDb = drizzlePglite(pglite);
  await migrate(rawDb, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  const db = rawDb as unknown as Db;
  await resetAndSeed(db);
  return {
    db,
    close: () => pglite.close(),
  };
}

/** Wipe and re-seed in the same order the seed file declares. */
export async function resetAndSeed(db: Db): Promise<void> {
  await db.delete(invoiceLineItems);
  await db.delete(invoices);
  await db.delete(accounts);

  for (const account of seed.accounts) {
    await db.insert(accounts).values({ ...account, createdAt: new Date('2024-01-01T00:00:00Z') });
  }
  for (const invoice of seed.invoices) {
    await db.insert(invoices).values({ ...invoice, createdAt: new Date('2024-04-01T00:00:00Z') });
  }
  // Inserted out of positional order on purpose: rows 3, 1, 2 -- the same
  // physical order the old fixture's fake client produced.
  for (const lineItem of seed.lineItems) {
    await db.insert(invoiceLineItems).values(lineItem);
  }
}
```
