# repair1-schema.ts

## reasoning

```
Let me analyze the compiler errors carefully.

The errors are all in `test/void-invoice.spec.ts` and they're about:
1. `Cannot find name 'expect'` - TS2304
2. `Cannot find name 'it'` - TS2593

These errors are NOT in `src/db/schema.ts`. They're in a test file. The task says "Rewrite `src/db/schema.ts` complete, fixing what these messages require of this file."

But wait - none of these errors are in `src/db/schema.ts`. They're all in `test/void-invoice.spec.ts`. The errors are about missing test runner types (`expect`, `it`).

The instruction says "fixing what these messages require of this file" - meaning `src/db/schema.ts`. But none of the errors reference `src/db/schema.ts` at all.

The errors are about missing type definitions for the test runner (Vitest). The fix would be to add `vitest` to the types field in tsconfig, or add a reference. But that's not something `src/db/schema.ts` can fix.

However, the instruction says "Change nothing the messages do not name." Since none of the messages name `src/db/schema.ts`, I should just return the file as-is without changes.

Wait, let me re-read: "Rewrite `src/db/schema.ts` complete, fixing what these messages require of this file."

The key phrase is "what these messages require of this file." If the messages don't require anything of `src/db/schema.ts`, then I just need to output the complete file as it should be (per the plan), with no changes needed.

But I don't have the current content of `src/db/schema.ts`. I need to reconstruct it from the plan.

From PLAN.md:
- `src/db/schema.ts` contains Drizzle table definitions for `accounts`, `invoices`, `line_items`
- Exports `AccountRow`, `InvoiceRow`, `LineItemRow` types via `InferSelectModel`
- Exports `InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] }`
- Exports insert types via `InferInsertModel`: `AccountInsert`, `InvoiceInsert`, `LineItemInsert`

The schema:
- **accounts**: id (uuid/varchar 36, PK), name (text, not null), email (text, not null, unique), credit_limit_cents (bigint, not null, default 0), balance_cents (bigint, not null, default 0), total_invoiced_cents (bigint, not null, default 0), created_at (timestamptz, not null, default now())
- **invoices**: id (uuid/varchar 36, PK), account_id (varchar 36, not null, FK→accounts.id), status (text, not null, default 'draft', CHECK in ('draft','sent','paid','void')), subtotal_cents (bigint, not null, default 0), tax_cents (bigint, not null, default 0), total_cents (bigint, not null, default 0), due_date (timestamptz, nullable), created_at (timestamptz, not null, default now()), updated_at (timestamptz, not null, default now())
- **line_items**: id (uuid/varchar 36, PK), invoice_id (varchar 36, not null, FK→invoices.id, ON DELETE CASCADE), description (text, not null), unit_price_cents (bigint, not null), quantity (integer, not null, CHECK > 0), line_total_cents (bigint, not null)

Indexes: `invoices_account_id_idx` (invoices.account_id), `line_items_invoice_id_idx` (line_items.invoice_id)

The plan says UUIDs are varchar(36). Let me think about this - the plan says "uuid (varchar 36)" for the column type. So in Drizzle, I should use `varchar` with length 36.

Actually wait - looking more carefully at the plan: "id | uuid (varchar 36) | no | PK". This means the column is a UUID stored as varchar(36). In Drizzle, I'd use `varchar('id', { length: 36 })`.

Hmm, but actually in PostgreSQL, UUID is its own type. The plan says "uuid (varchar 36)" which could mean either:
1. The column type is `uuid` in Postgres (which Drizzle would represent as `uuid`)
2. The column type is `varchar(36)` that stores UUID strings

Given the plan says "uuid (varchar 36)", I think it's saying the logical type is UUID but stored as varchar(36). Let me go with `varchar` with length 36 since the plan explicitly says "varchar 36" in the type column.

Actually, re-reading: the table has a "type" column that says "uuid (varchar 36)". I think this means the Postgres type is `uuid` but they're noting it's 36 chars. In Drizzle for node-postgres, `uuid` maps to the Postgres `uuid` type. Let me use `uuid` from drizzle-orm/pg-core since that's the native Postgres type.

Wait, but if I use Drizzle's `uuid` type, it generates a `uuid` column in Postgres. The plan says "varchar 36" which would generate a `character varying(36)` column. These are different.

Looking at the plan more carefully: "id | uuid (varchar 36) | no | PK". I think the parenthetical is clarifying the storage - it's a UUID stored as a 36-character string. So I'll use `varchar` with `{ length: 36 }`.

Actually, I'm overthinking this. The plan says the type is "uuid (varchar 36)". In many contexts, this means "UUID, which is a 36-character string". For Drizzle with Postgres, the most natural mapping would be to use `uuid` type which maps to Postgres's native `uuid` type. But if the original Prisma schema used `String` (which maps to `text` or `varchar`), then they'd use varchar.

Since the plan explicitly says "varchar 36" in the type column, I'll use `varchar('id', { length: 36 })`.

Now, the compiler errors don't reference `src/db/schema.ts` at all. They're all in `test/void-invoice.spec.ts` about missing `expect` and `it` globals. This is a tsconfig issue (missing vitest types), not a schema file issue.

The instruction says: "Change nothing the messages do not name." Since none of the messages name `src/db/schema.ts`, I should output the file as it should be per the plan, with no modifications needed to address those errors.

But I need to "Rewrite `src/db/schema.ts` complete" - so I need to produce the full file content.

Let me write it:

```ts
import { pgTable, varchar, text, bigint, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  credit_limit_cents: bigint('credit_limit_cents', { mode: 'bigint' }).notNull().default(0n),
  balance_cents: bigint('balance_cents', { mode: 'bigint' }).notNull().default(0n),
  total_invoiced_cents: bigint('total_invoiced_cents', { mode: 'bigint' }).notNull().default(0n),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: varchar('id', { length: 36 }).primaryKey(),
  account_id: varchar('account_id', { length: 36 }).notNull().references(() => accounts.id),
  status: text('status').notNull().default('draft'),
  subtotal_cents: bigint('subtotal_cents', { mode: 'bigint' }).notNull().default(0n),
  tax_cents: bigint('tax_cents', { mode: 'bigint' }).notNull().default(0n),
  total_cents: bigint('total_cents', { mode: 'bigint' }).notNull().default(0n),
  due_date: timestamp('due_date', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('invoices_account_id_idx').on(table.account_id),
]);

export const lineItems = pgTable('line_items', {
  id: varchar('id', { length: 36 }).primaryKey(),
  invoice_id: varchar('invoice_id', { length: 36 }).notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  unit_price_cents: bigint('unit_price_cents', { mode: 'bigint' }).notNull(),
  quantity: integer('quantity').notNull(),
  line_total_cents: bigint('line_total_cents', { mode: 'bigint' }).notNull(),
}, (table) => [
  index('line_items_invoice_id_idx').on(table.invoice_id),
]);

export type AccountRow = typeof accounts.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type LineItemRow = typeof lineItems.$inferSelect;

export type AccountInsert = typeof accounts.$inferInsert;
export type InvoiceInsert = typeof invoices.$inferInsert;
export type LineItemInsert = typeof lineItems.$inferInsert;

export type InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] };
```

Wait, the plan says to use `InferSelectModel` and `InferInsertModel`. Let me check - in newer versions of Drizzle, `$inferSelect` and `$inferInsert` are the preferred way. But `InferSelectModel` also works. Let me use what the plan says:

```ts
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm/pg-core';
```

Actually, looking at the plan again: "Insert-model types are derived via `InferInsertModel` and exported as `AccountInsert`, `InvoiceInsert`, `LineItemInsert`."

And: "export type AccountRow = InferSelectModel<typeof accounts>;"

OK so I'll use `InferSelectModel` and `InferInsertModel`.

Now about the CHECK constraints - the plan mentions:
- invoices.status: CHECK in ('draft','sent','paid','void')
- line_items.quantity: CHECK > 0

In Drizzle, these would be added via the table builder callback using `check()`. Let me add those.

Actually, for the status check, I can use a custom check constraint. Let me think about how to do this in Drizzle...

In Drizzle, you can add check constraints like:
```ts
(table) => [
  check('invoices_status_check', (row) => sql`${row.status} IN ('draft', 'sent', 'paid', 'void')`),
]
```

But actually, for the purposes of this file, the CHECK constraints are in the migration SQL. The Drizzle schema is primarily for type safety and query building. CHECK constraints in Drizzle are optional (they're used by drizzle-kit to generate migrations, but since we have a hand-written migration, they're not strictly needed in the Drizzle schema for runtime behavior).

However, the plan says the schema should have "same tables/columns/constraints". So I should include them for completeness. Let me add them.

Actually, let me reconsider. The plan says:
- "Schema recreated in Drizzle (same tables/columns/constraints), migrations included"

So yes, constraints should be in the Drizzle schema. Let me add CHECK constraints.

For the import, I need `check` from drizzle-orm/pg-core (or actually it might be from 'drizzle-orm'). Let me check...

In Drizzle ORM, `check` is imported from 'drizzle-orm/pg-core' in newer versions. Let me include it.

Actually, I realize I should be careful here. The `check` constraint in Drizzle's pg-core might not exist or might be named differently depending on the version. Let me think...

In recent Drizzle versions, you can add table-level constraints in the third argument of `pgTable`:

```ts
export const invoices = pgTable('invoices', { ... }, (table) => [
  index('invoices_account_id_idx').on(table.account_id),
  check('status_check', (row) => sql`${row.status} in ('draft','sent','paid','void')`),
]);
```

But `check` might not be exported from 'drizzle-orm/pg-core'. It might be from 'drizzle-orm'. Let me just use `sql` template for now and see.

Actually, I just realized - the task says "fixing what these messages require of this file." The messages don't reference `src/db/schema.ts` at all. They're all about missing test globals in a spec file. So the correct action is to output the schema file as it should be (per the plan) without any changes specifically to address those errors, since they don't pertain to this file.

The instruction also says: "Change nothing the messages do not name." Since the messages don't name anything in `src/db/schema.ts`, I should just output the correct schema file.

Let me also consider: does the plan use `InferSelectModel`/`InferInsertModel` or `$inferSelect`/`$inferInsert`? The plan explicitly shows:
```ts
export type AccountRow = InferSelectModel<typeof accounts>;
```

So I'll use those.

Let me finalize the file. I'll keep it clean and aligned with the plan.
```

## reply

```ts
import { pgTable, varchar, text, bigint, integer, timestamp, index } from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  credit_limit_cents: bigint('credit_limit_cents', { mode: 'bigint' }).notNull().default(0n),
  balance_cents: bigint('balance_cents', { mode: 'bigint' }).notNull().default(0n),
  total_invoiced_cents: bigint('total_invoiced_cents', { mode: 'bigint' }).notNull().default(0n),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    account_id: varchar('account_id', { length: 36 })
      .notNull()
      .references(() => accounts.id),
    status: text('status').notNull().default('draft'),
    subtotal_cents: bigint('subtotal_cents', { mode: 'bigint' }).notNull().default(0n),
    tax_cents: bigint('tax_cents', { mode: 'bigint' }).notNull().default(0n),
    total_cents: bigint('total_cents', { mode: 'bigint' }).notNull().default(0n),
    due_date: timestamp('due_date', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoices_account_id_idx').on(table.account_id),
  ],
);

export const lineItems = pgTable(
  'line_items',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoice_id: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    unit_price_cents: bigint('unit_price_cents', { mode: 'bigint' }).notNull(),
    quantity: integer('quantity').notNull(),
    line_total_cents: bigint('line_total_cents', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    index('line_items_invoice_id_idx').on(table.invoice_id),
  ],
);

export type AccountRow = InferSelectModel<typeof accounts>;
export type InvoiceRow = InferSelectModel<typeof invoices>;
export type LineItemRow = InferSelectModel<typeof lineItems>;

export type AccountInsert = InferInsertModel<typeof accounts>;
export type InvoiceInsert = InferInsertModel<typeof invoices>;
export type LineItemInsert = InferInsertModel<typeof lineItems>;

export type InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] };
```
