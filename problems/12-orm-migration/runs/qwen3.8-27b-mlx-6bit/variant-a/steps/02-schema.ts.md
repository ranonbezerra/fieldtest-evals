# 02-schema.ts

## reasoning

```
The user wants me to write `drizzle/schema.ts` based on the PLAN.md specification. Let me extract what's needed:

From PLAN.md section 2 (Data model):

### accounts
- id: uuid, PK, default gen_random_uuid()
- name: text, NOT NULL
- balance_cents: bigint, NOT NULL, default 0
- total_invoiced_cents: bigint, NOT NULL, default 0
- created_at: timestamptz, NOT NULL, default now()
- updated_at: timestamptz, NOT NULL, default now()

Table name: `accounts`

### invoices
- id: uuid, PK, default gen_random_uuid()
- account_id: uuid, NOT NULL, FK → accounts.id (ON DELETE RESTRICT)
- amount_cents: bigint, NOT NULL
- status: text, NOT NULL, default 'pending'
- created_at: timestamptz, NOT NULL, default now()
- updated_at: timestamptz, NOT NULL, default now()

Indexes: (account_id), (status). Table name: `invoices`.

### line_items
- id: uuid, PK, default gen_random_uuid()
- invoice_id: uuid, NOT NULL, FK → invoices.id (ON DELETE CASCADE)
- description: text, NOT NULL
- amount_cents: bigint, NOT NULL
- created_at: timestamptz, NOT NULL, default now()

Index: (invoice_id). Table name: `line_items`.

Now for Drizzle pg-core, the imports would be from `drizzle-orm/pg-core`. Let me write the schema:

- `pgTable` for table definitions
- `uuid` for uuid columns (with `.defaultRandom()` for gen_random_uuid())
- `text` for text columns
- `bigint` for bigint columns (with `.notNull()` and `.default(0)`)
- `timestamp` with `{ withTimezone: true }` for timestamptz

For the `default(0)` on bigint - in Drizzle, `.default(0)` works for bigint.

For `gen_random_uuid()` - in Drizzle, `.defaultRandom()` generates a UUID v4 which maps to `gen_random_uuid()` in Postgres.

For `now()` default on timestamps - `.defaultNow()`.

FKs:
- invoices.account_id → accounts.id, ON DELETE RESTRICT
- line_items.invoice_id → invoices.id, ON DELETE CASCADE

Indexes:
- invoices: (account_id), (status)
- line_items: (invoice_id)

Let me write this out:

```ts
import { pgTable, uuid, text, bigint, timestamp, index } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  balance_cents: bigint('balance_cents', { mode: 'string' }).notNull().default(0),
  total_invoiced_cents: bigint('total_invoiced_cents', { mode: 'string' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  account_id: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('invoices_account_id_idx').on(table.account_id),
  index('invoices_status_idx').on(table.status),
]);

export const line_items = pgTable('line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoice_id: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('line_items_invoice_id_idx').on(table.invoice_id),
]);
```

Wait - the plan says the repository returns BigInt amounts as JS strings. Looking at the plan: "Amount columns stay Postgres `bigint` (Drizzle `pgInteger(8)`); the repository returns them as JS strings so the service serialises them byte-identically to today's `BigInt → String()`."

The plan mentions `pgInteger(8)` but that's not a real Drizzle function. The correct Drizzle way is `bigint`. The plan also says the row types have `balance_cents: string`. So using `{ mode: 'string' }` on the bigint column would make Drizzle return strings directly, which matches the plan's requirement that "the repository returns them as JS strings."

Actually, let me re-read: "Drizzle `pgInteger(8)`" - this is clearly a mistake in the plan (there's no `pgInteger(8)` in Drizzle). The correct type is `bigint`. And since the plan says the repository returns them as strings, using `{ mode: 'string' }` makes sense.

Let me also check the index naming convention. In Drizzle, you can either let it auto-generate names or specify them. The plan doesn't specify exact index names, so I'll use descriptive ones.

Actually, looking more carefully at Drizzle's index syntax - in newer versions of drizzle-orm, the third argument to `pgTable` is a function that receives the table and returns an array of index definitions. Let me use that pattern.

Wait, I need to be careful. In drizzle-orm, the `index` is created via:
```ts
(table) => [index('name').on(table.column)]
```

But there's also `pgTable` with the third parameter being either an object or a function. Let me use the function form which is the standard pattern.

Actually, looking at Drizzle docs more carefully, the correct syntax for indexes in the table definition callback is:

```ts
(table) => ({
  accountIdx: index('invoices_account_id_idx').on(table.account_id),
})
```

Or in newer versions it can be an array. Let me use the object form which is more commonly seen:

Actually, both work. The array form is:
```ts
(table) => [index('name').on(table.col)]
```

The object form is:
```ts
(table) => ({ name: index('name').on(table.col) })
```

I'll use the array form as it's more concise for multiple indexes. Actually, let me check - in Drizzle, the callback can return either an array or an object of unique indexes and indexes. Let me use the standard pattern.

Looking at Drizzle docs, the correct way is:
```ts
export const table = pgTable('table_name', { ... }, (table) => [
  index('idx_name').on(table.col),
]);
```

This should work. Let me finalize my answer.

One more consideration: the `bigint` with `{ mode: 'string' }`. In Drizzle, `bigint('col', { mode: 'string' })` will make the column type be `string` in TypeScript and it will handle the conversion. This matches the plan's requirement that amounts are returned as strings from the repository.

I'm confident in this implementation. Let me write it out cleanly.
```

## reply

```ts
import { pgTable, uuid, text, bigint, timestamp, index } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  balance_cents: bigint('balance_cents', { mode: 'string' }).notNull().default(0),
  total_invoiced_cents: bigint('total_invoiced_cents', { mode: 'string' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account_id: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoices_account_id_idx').on(table.account_id),
    index('invoices_status_idx').on(table.status),
  ],
);

export const line_items = pgTable(
  'line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoice_id: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    amount_cents: bigint('amount_cents', { mode: 'string' }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('line_items_invoice_id_idx').on(table.invoice_id),
  ],
);
```
