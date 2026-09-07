# repair2-schema.ts

## reasoning

```
Let me analyze the compiler errors in `drizzle/schema.ts`:

1. `drizzle/schema.ts(10,19): error TS2345: Argument of type 'string' is not assignable to parameter of type 'PgBigIntConfig<"number" | "bigint">'.`
2. `drizzle/schema.ts(10,48): error TS2345: Argument of type 'bigint' is not assignable to parameter of type '(bigint | SQL<unknown>) & (number | SQL<unknown>)'.`
3. `drizzle/schema.ts(18,18): error TS2345: Argument of type 'string' is not assignable to parameter of type 'PgBigIntConfig<"number" | "bigint">'.`
4. `drizzle/schema.ts(28,18): error TS2345: Argument of type 'string' is not assignable to parameter of type 'PgBigIntConfig<"number" | "bigint">'.`
5. `src/main.ts(9,33): error TS2554: Expected 1-3 arguments, but got 0.` — This is in `main.ts`, not in `drizzle/schema
```

## reply

```typescript
import { pgTable, serial, text, timestamp, integer, bigint, doublePrecision, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const lineItems = pgTable('line_items', {
  id: serial('id').primaryKey(),
  invoice_id: integer('invoice_id').notNull(),
  description: text('description').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});
```
