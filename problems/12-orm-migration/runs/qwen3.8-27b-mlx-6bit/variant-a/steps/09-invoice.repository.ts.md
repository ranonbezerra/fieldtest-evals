# 09-invoice.repository.ts

## reasoning

```
Let me analyze what I need to write for `src/invoice/invoice.repository.ts`.

From the PLAN.md:
- This file handles: Invoice + line-item queries, createWithLineItems accepting a tx handle
- It imports from: `src/database/database.module.ts` (for DRIZZLE token and PostgresJsDatabase type), `drizzle/schema.ts` (for table definitions)

From the plan's types and signatures:

```ts
// invoice.repository.ts
export class InvoiceRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<InvoiceRow | null>;
  findByAccount(accountId: string, page?: number, pageSize?: number): Promise<InvoiceRow[]>;
  createWithLineItems(tx: Tx, data: CreateInvoiceData): Promise<InvoiceRow>;
  getLineItems(invoiceId: string): Promise<LineItemRow[]>;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

// InvoiceRow: { id, account_id, amount_cents: string, status, created_at: Date, updated_at: Date }
// LineItemRow: { id, invoice_id, description, amount_cents: string, created_at: Date }
```

Now let me look at the schema (drizzle/schema.ts):
- `accounts` table with: id, name, balance_cents (bigint mode string), total_invoiced_cents (bigint mode string), created_at, updated_at
- `invoices` table with: id, account_id (FK to accounts.id), amount_cents (bigint mode string), status (text, default 'pending'), created_at, updated_at
- `line_items` table with: id, invoice_id (FK to invoices.id), description, amount_cents (bigint mode string), created_at

Since the bigint columns use `mode: 'string'`, they'll be returned as strings by Drizzle. This aligns with the plan's InvoiceRow and LineItemRow types where `amount_cents` is a string.

For the `Tx` type, in Drizzle with postgres-js, the transaction type is `PostgresJsTransaction`. Let me think about what to import.

In drizzle-orm/postgres-js, the transaction callback receives a `PostgresJsTransaction` which is a subset of the database interface. I can type it as:

```ts
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
```

And for the tx parameter, I can use a type that represents the transaction context. In drizzle-orm, when you call `db.transaction(async (tx) => {...})`, the `tx` parameter is typed as `PostgresJsTransaction<...>`. 

Actually, looking at drizzle-orm types more carefully, the transaction type for postgres-js is typically accessible as:

```ts
import { PostgresJsTransaction } from 'drizzle-orm/pg-core';
```

Wait, let me think about this differently. The plan says `createWithLineItems(tx: Tx, data: CreateInvoiceData)`. The `Tx` type needs to support the query operations that Drizzle provides (insert, select, etc.). 

In drizzle-orm/pg-core, there's a type `PgTransactionConfig` but more practically, the transaction object passed to the callback has the same query interface as the database minus some methods. The cleanest approach would be to define a minimal type or use the actual Drizzle type.

Looking at drizzle-orm's type exports, for postgres-js driver, the transaction type is:
- `PostgresJsDatabase` for the full DB
- The transaction callback parameter is typically typed with the generic constraint

Actually, in drizzle-orm, when you do `db.transaction(async (tx) => { ... })`, the `tx` is a `PostgresJsTransaction` which extends from the same base. The type I can use is:

```ts
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

Hmm, but I'm not 100% sure that's the exact export name. Let me think about what's most defensible.

Actually, in drizzle-orm, the common pattern is:

```ts
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = PostgresJsTransaction; // from drizzle-orm/pg-core
```

Wait, I think the cleaner approach that's commonly used in Drizzle is to type the tx parameter using a generic or the specific transaction type. Let me look at what drizzle-orm exports:

From `drizzle-orm/pg-core`:
- `PgTransactionConfig`
- The transaction type is usually inferred

From `drizzle-orm/postgres-js`:
- `PostgresJsDatabase`
- The transaction callback parameter type

Actually, the most common pattern I've seen in Drizzle projects is:

```ts
import { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

But I'm not certain `PostgresJsTransaction` is exported from there. Let me think of another approach.

Actually, in many Drizzle projects, the tx parameter is typed using the database's transaction type. The `PostgresJsDatabase` has a `.transaction()` method where the callback receives a transaction object. 

Looking at the drizzle-orm source, the type for the postgres-js transaction is:

```ts
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

Or alternatively, you can use a structural type. But the most practical approach that I've seen in real Drizzle projects is:

```ts
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type DrizzleTx = Parameters<Parameters<PostgresJsDatabase<any>['transaction']>[0]>[0];
```

That's too complex. Let me just use a simpler approach.

Actually, I recall that in drizzle-orm, you can import:

```ts
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

This should work. The `PostgresJsTransaction` type represents the transaction context passed to the callback.

Wait, I need to be more careful. Let me look at what's actually available:

In `drizzle-orm/postgres-js`, the exports include:
- `PostgresJsDatabase`
- `drizzle` (function)

For the transaction type, it might be in `drizzle-orm/pg-core` as part of the internal types. 

Actually, I think the most practical and commonly seen pattern is to just type it structurally or use a type alias. Since I'm not 100% certain of the exact export name, let me use an approach that's most likely to work:

Option 1: Use the database type itself (since a transaction has the same query interface for our purposes):
```ts
type Tx = PostgresJsDatabase;
```
This isn't quite right because a transaction doesn't have `.transaction()` method.

Option 2: Use a specific Drizzle export. I believe `PostgresJsTransaction` is exported from `drizzle-orm/postgres-js`.

Let me go with importing it and add an ASSUMPTION comment if needed.

Actually, looking more carefully at drizzle-orm's type system:

In `drizzle-orm/postgres-js/session.d.ts` or similar, there should be a `PostgresJsTransaction` type. 

I'll go with:
```ts
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

Hmm, but if `PostgresJsTransaction` isn't exported from there, this would fail. 

Let me think of another approach. In the Drizzle docs and examples I've seen, the common pattern for repositories that accept a transaction is:

```ts
// Using the db type as a supertype (since tx has all the query methods)
constructor(private readonly db: PostgresJsDatabase) {}

async createWithLineItems(tx: /* some type */, data: CreateInvoiceData) { ... }
```

Actually, you know what, I think the cleanest approach that's definitely correct is to use a type that represents "something that can do queries". In Drizzle, both `PostgresJsDatabase` and the transaction object have `.insert()`, `.select()`, etc. 

The most type-safe way without guessing the exact export is:

```ts
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// The transaction parameter can be typed as the database type since 
// it shares the same query interface for insert/select operations
```

But that's not ideal. Let me just go with `PostgresJsTransaction` from `drizzle-orm/postgres-js` and add an ASSUMPTION if it's not certain.

Actually, I just recalled - in recent versions of drizzle-orm, the transaction type IS exported. Let me check the typical import pattern:

```ts
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
```

And for transactions, you'd typically just use the callback parameter type inference. But when passing it around to repositories, you need an explicit type.

I'll use this approach: define the tx type as a minimal structural type that has the methods we need (insert, select), or use `PostgresJsTransaction` if it's available.

Let me go with the most defensible approach: I'll import from `drizzle-orm/postgres-js` and use the type. If `PostgresJsTransaction` isn't available as a named export, I'll derive it from the database type.

Actually, let me look at this from a different angle. The drizzle-orm package does export `PostgresJsTransaction` - I've seen it in type definitions. Let me just use it.

Now for the implementation:

1. `findById(id: string)` - SELECT from invoices WHERE id = $1, return row or null
2. `findByAccount(accountId: string, page?, pageSize?)` - SELECT from invoices WHERE account_id = $1 with LIMIT/OFFSET, return array
3. `createWithLineItems(tx, data)` - INSERT invoice, then INSERT line items, return the invoice row
4. `getLineItems(invoiceId: string)` - SELECT from line_items WHERE invoice_id = $1, return array

For the constructor, the plan says `constructor(drizzle: PostgresJsDatabase)`. But wait - looking at the database.module.ts, the injection token is `DRIZZLE` (a unique symbol). So in NestJS DI, I need to use `@Inject(DRIZZLE)`.

Let me write the repository:

```ts
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = (page ?? 1 - 1) * limit;
    
    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .limit(limit)
      .offset(offset);
  }

  async createWithLineItems(
    tx: /* transaction type */,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: data.amountCents,
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: item.amountCents,
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
```

Wait, I need to think about the `amountCents` type. The plan says `CreateInvoiceData.amountCents: bigint` and `lineItems[].amountCents: bigint`. But the Drizzle schema uses `bigint('...', { mode: 'string' })`. 

When inserting with `mode: 'string'`, Drizzle expects a string value for the column, not a bigint. But the plan explicitly says `amountCents: bigint` in `CreateInvoiceData`.

Hmm, this is a conflict. The plan says the interface uses `bigint` but the Drizzle schema uses string mode. Let me re-read the plan...

The plan says:
```
export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}
```

And the schema uses `{ mode: 'string' }` for bigint columns.

In Drizzle, when you use `bigint('col', { mode: 'string' })`, the insert expects a string (or number that can be converted to string), and the select returns a string.

So if `CreateInvoiceData.amountCents` is `bigint`, I need to convert it to string when inserting:
```ts
amount_cents: String(data.amountCents),
```

Or actually, Drizzle might accept bigint directly and convert it. Let me think...

In Drizzle with `mode: 'string'`, the TypeScript type for insert is `string | number`. A `bigint` might not be directly assignable. To be safe, I'll convert with `String()`.

Actually wait - looking more carefully at Drizzle's types for bigint with string mode:
- Input (insert): `string | number`  
- Output (select): `string`

A `bigint` is neither `string` nor `number` in TypeScript's type system. So I do need to convert it.

I'll use `String(data.amountCents)` for the conversion.

Now, about the transaction type. Let me think about what's most defensible:

The service will call:
```ts
this.db.transaction(async (tx) => {
  // ...
  await this.invoiceRepo.createWithLineItems(tx, data);
});
```

The `tx` in the callback is typed by Drizzle. For `PostgresJsDatabase`, the transaction callback parameter type is the "session" type which has all query methods.

I think the cleanest approach is to use a type that's compatible. In drizzle-orm, I believe you can use:

```ts
import { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

But I'm not 100% sure this is a public export. Let me think of alternatives:

1. Use `Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0]` - too convoluted
2. Define a minimal interface with just `insert` and `select` - loses type safety
3. Use the database type as a supertype - not accurate
4. Import `PostgresJsTransaction` - most likely correct but I'm adding an assumption

I'll go with option 4 and mark it with an ASSUMPTION comment. Actually, let me reconsider.

Looking at the drizzle-orm npm package structure:
- `drizzle-orm/postgres-js` exports: `drizzle`, `PostgresJsDatabase`, and likely session/transaction types
- The transaction type in postgres-js is typically `PostgresJsTransaction`

I'll use it and add an assumption note since I can't verify the exact export.

Wait, actually there's another common pattern. Some projects just use:

```ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// For the tx parameter, since it shares the query builder interface:
type Tx = PostgresJsDatabase; // structural compatibility for insert/select
```

This works at the type level because `PostgresJsTransaction` is structurally compatible with a subset of `PostgresJsDatabase`. But it's not perfectly accurate.

You know what, I'll just go with the most common pattern I've seen in Drizzle projects. Let me use a type import and add an assumption if needed.

Let me finalize my implementation:

```ts
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = ((page ?? 1) - 1) * limit;

    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .limit(limit)
      .offset(offset);
  }

  async createWithLineItems(
    tx: PostgresJsTransaction,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: String(data.amountCents),
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: String(item.amountCents),
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
```

Hmm wait, I need to double-check the path to drizzle schema. The file is at `src/invoice/invoice.repository.ts` and the schema is at `drizzle/schema.ts`. From `src/invoice/`, going up to root is `../../`, then into `drizzle/` gives `../../drizzle/schema`. Wait no:

- File location: `src/invoice/invoice.repository.ts`
- Schema location: `drizzle/schema.ts`

From `src/invoice/`:
- `../` → `src/`
- `../../` → root
- `../../drizzle/schema` → `drizzle/schema`

So the import should be: `import { invoices, line_items } from '../../drizzle/schema';`

Let me also double-check the database module import:
- File location: `src/invoice/invoice.repository.ts`
- Database module: `src/database/database.module.ts`

From `src/invoice/`:
- `../database/database.module` → `src/database/database.module`

So: `import { DRIZZLE } from '../database/database.module';`

That looks right.

Now, about `PostgresJsTransaction` - I'm going to add an ASSUMPTION comment since I can't verify it's a public export from `drizzle-orm/postgres-js`. Actually, let me think about whether there's a better way...

In the drizzle-orm type definitions, for the postgres-js driver:
- The `transaction` method on `PostgresJsDatabase` takes a callback `(tx) => Promise<void>`
- The `tx` parameter type is the "session" which implements the query interface

Looking at how drizzle-orm structures its types, I believe `PostgresJsTransaction` is indeed exported. But to be safe, I'll add the assumption comment.

Actually, you know what - let me look at this differently. In many Drizzle + NestJS projects I've seen, the pattern is to type the transaction as the database type itself, because the structural types are compatible for the operations we need (insert, select). The transaction object has `.insert()`, `.select()`, `.update()`, `.delete()` just like the database.

But that's not perfectly type-safe. The most correct type would be whatever Drizzle exports for the transaction context.

I'll go with my plan and add a single ASSUMPTION comment about the `PostgresJsTransaction` type.

One more thing - the `and` import from drizzle-orm: I don't actually need it since all my where clauses are single conditions. Let me remove it.

Let me also consider: should `findByAccount` have an ordering? The plan doesn't specify explicit ordering for list queries. I'll leave it without explicit ORDER BY (which means database default order, typically insertion order for PostgreSQL but not guaranteed). Actually, for a billing service, ordering by created_at or id might make sense, but the plan doesn't specify it, so I'll keep it simple.

Wait, actually let me re-read the plan for ordering:
- The plan mentions "Ordering rules" section but it's about transaction ordering, not query ordering.
- The test says "GET /invoices?account_id=… paginates" with "data, page, page_size present; correct slice"

For pagination to be stable, I should probably add an ORDER BY. But the plan doesn't specify it explicitly. I'll add `orderBy(invoices.created_at)` to make pagination deterministic, as this is standard practice. Actually no - the plan says "Do not add an export, a feature or a file the plan does not name." But adding ORDER BY isn't adding a feature, it's part of correct pagination behavior. I'll add it.

Hmm, but the plan says to implement exactly what the plan specifies. The plan's signature is just `findByAccount(accountId: string, page?: number, pageSize?: number): Promise<InvoiceRow[]>`. It doesn't mention ordering. But without ordering, pagination is non-deterministic. I think adding a stable order is part of correct implementation of the stated behavior (pagination with "correct slice").

I'll add `orderBy(invoices.created_at)` and use the `orderBy` import.

Actually, let me reconsider. The original Prisma implementation would have had some ordering (otherwise the tests wouldn't be stable). Since I don't have access to the original code, and the plan doesn't specify ordering, I'll add a reasonable default (by created_at) to ensure stable pagination. This is a defensible implementation choice, not an added feature.

Let me finalize:

```ts
import { Inject } from '@nestjs/common';
import { eq, orderBy } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = ((page ?? 1) - 1) * limit;

    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .orderBy(orderBy(invoices.created_at))  // Hmm, this is wrong syntax
      .limit(limit)
      .offset(offset);
  }

  async createWithLineItems(
    tx: PostgresJsTransaction,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: String(data.amountCents),
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: String(item.amountCents),
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
```

Wait, the Drizzle orderBy syntax is just `.orderBy(invoices.created_at)` not `.orderBy(orderBy(...))`. The `orderBy` function is used when you need to specify direction or use it in a where clause context. For the `.orderBy()` method on the query builder, you just pass column references directly:

```ts
.orderBy(invoices.created_at)
// or for descending:
.orderBy(desc(invoices.created_at))  // using desc from drizzle-orm
```

So I should just use `.orderBy(invoices.created_at)` without importing `orderBy`.

Let me fix that. I'll remove the `orderBy` import and just use the method directly.

Final version:

```ts
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = ((page ?? 1) - 1) * limit;

    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .orderBy(invoices.created_at)
      .limit(limit)
      .offset(offset);
  }

  // ASSUMPTION: PostgresJsTransaction is exported from drizzle-orm/postgres-js as the type of the transaction callback parameter
  async createWithLineItems(
    tx: PostgresJsTransaction,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: String(data.amountCents),
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: String(item.amountCents),
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
```

Wait, I should put the ASSUMPTION comment at the point it matters - at the type import or the parameter. Let me put it at the import line.

Actually, re-reading the instructions: "write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The point it matters is where I use `PostgresJsTransaction` as a type. Let me put the comment right before the import or at the usage site.

I think putting it at the import is most natural:

```ts
// ASSUMPTION: PostgresJsTransaction is a named export from drizzle-orm/postgres-js representing the transaction context type
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
```

Or I could put it at the parameter. Let me put it at the import since that's where the uncertainty is.

Hmm, actually I want to double-check one more thing. The `PostgresJsDatabase` type - does it need generic parameters? In some versions of Drizzle, it's `PostgresJsDatabase<TSchema>` where TSchema is the schema type. If I don't specify it, it might default to `Record<string, never>` or similar.

Looking at the database.module.ts reference:
```ts
useFactory: (): PostgresJsDatabase => { ... }
```

It uses `PostgresJsDatabase` without generics. So I'll do the same.

But wait - if `PostgresJsDatabase` without generics is used, then the `.select()` and `.insert()` methods might not have full type information about which tables exist. In practice, this means the query builder won't know about `invoices` or `line_items` tables for type-checking.

Hmm, but the reference code uses it without generics, so I'll follow suit. The queries will still work at runtime; TypeScript might just be less strict about table/column references.

Actually, looking more carefully at the reference `database.module.ts`:
```ts
const client = postgres(url);
return drizzle(client);
```

The `drizzle()` function without a second argument (schema) would return `PostgresJsDatabase` with an empty schema type. This means the query builder won't have table-specific types. But since we're passing table objects directly to `.from()` and `.insert()`, the types should still work out through the table object's type.

Let me also verify: does `.insert(table).values(...)` work when the table isn't part of the database's schema type? In Drizzle, I believe it does because the table object carries its own type information.

OK, I think my implementation is solid. Let me write the final version.

One last thought: the `returning()` call. In Drizzle, `.returning()` without arguments returns all columns. With a specific column list like `.returning(invoices.id)`, it would return only those. I want all columns, so `.returning()` is correct.

Also, the destructuring `const [invoice] = await ...` - if the insert fails or returns no rows, this would be `undefined`. But since it's a single INSERT with values, it should always return exactly one row. The nullish case is handled by the transaction rollback (if anything goes wrong, the whole tx rolls back).

I'm satisfied with my implementation. Let me write it out cleanly.
```

## reply

```typescript
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
// ASSUMPTION: PostgresJsTransaction is a named type export from drizzle-orm/postgres-js representing the transaction context passed to the callback of db.transaction()
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = ((page ?? 1) - 1) * limit;

    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .orderBy(invoices.created_at)
      .limit(limit)
      .offset(offset);
  }

  async createWithLineItems(
    tx: PostgresJsTransaction,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: String(data.amountCents),
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: String(item.amountCents),
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
```
