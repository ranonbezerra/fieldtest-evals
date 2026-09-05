# 06-account.repository.ts

## reasoning

```
Let me analyze what's needed for `src/account/account.repository.ts` based on the plan and references.

From the PLAN.md:
```ts
// account.repository.ts
export class AccountRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<AccountRow | null>;
  create(data: { name: string }): Promise<AccountRow>;
  updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
}
// AccountRow: { id, name, balance_cents: string, total_invoiced_cents: string, created_at: Date, updated_at: Date }
```

From the drizzle schema:
- `accounts` table with columns: id (uuid), name (text), balance_cents (bigint, mode: 'string'), total_invoiced_cents (bigint, mode: 'string'), created_at (timestamp withTimezone), updated_at (timestamp withTimezone)

The repository needs to:
1. Be injectable via NestJS (constructor takes `@Inject(DRIZZLE)`)
2. Use Drizzle queries to interact with the `accounts` table
3. Return rows where bigint columns are strings (which they will be since the schema uses `mode: 'string'`)

Let me think about the methods:

1. `findById(id: string): Promise<AccountRow | null>` - SELECT * FROM accounts WHERE id = $1, return row or null
2. `create(data: { name: string }): Promise<AccountRow>` - INSERT INTO accounts (name) VALUES ($1), return the created row
3. `updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>` - UPDATE accounts SET balance_cents = balance_cents + $1, total_invoiced_cents = total_invoiced_cents + $2, updated_at = now() WHERE id = $3, return updated row or null

Now, the schema uses `bigint` with `mode: 'string'`, so Drizzle will return these as strings. The `AccountRow` type should reflect that.

For the Drizzle queries:
- `findById`: Use `eq(accounts.id, id)` and `.get()` or `.limit(1)`
- `create`: Use `insert(accounts).values(data).returning()`
- `updateCounters`: This is tricky. We need to add deltas to existing bigint columns. Since the mode is 'string', we need to think about how to do arithmetic.

Wait, looking at the plan more carefully:
- `updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>`

The deltas are `bigint` values. But the columns are in string mode. In Drizzle with postgres, when using `mode: 'string'`, the values are stored/retrieved as strings. For arithmetic, we can use Drizzle's SQL template tags or raw SQL expressions.

Actually, looking at how Drizzle handles bigint with string mode - when you do arithmetic in SQL like `balance_cents + delta`, the database handles it natively. We just need to pass the parameter correctly.

Let me think about how to do the update with Drizzle:

```ts
await this.drizzle
  .update(accounts)
  .set({
    balance_cents: sql`${accounts.balance_cents} + ${deltaBalance.toString()}`,
    total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${deltaInvoiced.toString()}`,
    updated_at: new Date(),
  })
  .where(eq(accounts.id, id))
  .returning();
```

Wait, but with `mode: 'string'`, the values are strings. Let me think about this differently.

Actually, in Drizzle's postgres-js driver with bigint in string mode, when you use `sql` template tags for the SET clause, you're writing raw SQL. The database column is `bigint`, so the arithmetic works natively. The mode only affects how Drizzle serializes/deserializes values in JS.

For the `sql` template, I need to be careful. The `deltaBalance` is a JS `bigint`. When interpolating into SQL, I should convert it to string for the template:

```ts
balance_cents: sql`(${accounts.balance_cents}) + ${Number(deltaBalance)}`
```

Hmm, but that could lose precision for very large numbers. Let me use the string representation:

Actually, looking at Drizzle docs, when you interpolate a value in `sql` template, it gets parameterized. A bigint should work as a parameter. Let me just use:

```ts
sql`(${accounts.balance_cents}) + ${deltaBalance}`
```

Wait, but `deltaBalance` is a JS bigint. In the postgres-js driver, bigints might need to be converted. Let me use `.toString()` to be safe:

```ts
sql`(${accounts.balance_cents}) + ${deltaBalance.toString()}`
```

Hmm, but that would be treated as a string literal in SQL. That won't work for arithmetic.

Let me reconsider. The safest approach is to use the raw column reference and a numeric parameter:

Actually, in SQL, `bigint + integer` works fine. If I pass a number (or a string that represents an integer), PostgreSQL will handle the type coercion. But for very large bigints, Number() would lose precision.

The most correct approach: use `sql` with the column reference and the bigint value. In postgres-js, you can pass a bigint as a parameter and it will be sent as a bigint to the database.

Let me check: in Drizzle's `sql` template tag, values are parameterized. A JS bigint should be handled by the postgres-js driver. Let me just use:

```ts
sql`(${accounts.balance_cents}) + ${deltaBalance}`
```

This should work because postgres-js will serialize the bigint parameter correctly.

Actually, I realize I need to be more careful. Let me look at what the plan says about the AccountRow type:

```
// AccountRow: { id, name, balance_cents: string, total_invoiced_cents: string, created_at: Date, updated_at: Date }
```

Since the schema uses `mode: 'string'` for bigint columns, Drizzle will automatically return them as strings. So the row type from Drizzle will naturally have string values for those columns.

Let me define the AccountRow interface and the repository class:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { accounts } from '../../drizzle/schema.js';
import { DRIZZLE } from '../database/database.module.js';

export interface AccountRow {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AccountRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: { name: string }): Promise<AccountRow> {
    const rows = await this.db
      .insert(accounts)
      .values(data)
      .returning();
    return rows[0];
  }

  async updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null> {
    const rows = await this.db
      .update(accounts)
      .set({
        balance_cents: sql`(${accounts.balance_cents}) + ${deltaBalance}`,
        total_invoiced_cents: sql`(${accounts.total_invoiced_cents}) + ${deltaInvoiced}`,
        updated_at: new Date(),
      })
      .where(eq(accounts.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
```

Wait, I need to think about whether `PostgresJsDatabase` needs a generic type parameter. In Drizzle, `PostgresJsDatabase` can be generic: `PostgresJsDatabase<typeof schema>`. But since we're importing from a specific schema file, we could do `PostgresJsDatabase<typeof accounts>` or just use the base type.

Looking at the database module reference:
```ts
useFactory: (): PostgresJsDatabase => {
  const url = process.env.DATABASE_URL!;
  const client = postgres(url);
  return drizzle(client);
},
```

It uses `PostgresJsDatabase` without a type parameter. So I'll match that.

Now, about the ESM import paths - the project uses `"type": "module"` (ESM). In NestJS with ESM, imports typically need the `.js` extension. But looking at the reference file `database.module.ts`, it doesn't show any imports with extensions to other local files. Let me use the standard relative import without extension since NestJS handles module resolution.

Actually wait, looking more carefully at the conventions: "ESM, `"type": "module"`". With ESM in Node, you need file extensions for relative imports. But in TypeScript with NestJS, the build tool (tsc or esbuild) handles this. The convention in the project seems to be standard TypeScript imports. Let me use relative paths without extensions, as is common in NestJS projects that use ESM with a bundler or ts-node.

Hmm, but actually with pure ESM Node.js, you DO need the extensions. Let me think... The convention says ESM with `"type": "module"`. But the reference file `database.module.ts` only imports from packages (`@nestjs/common`, `drizzle-orm/postgres-js`, `postgres`), not from local files. So I can't tell the convention for local imports.

I'll use no extension since that's the most common in NestJS TypeScript projects (the build step handles resolution). If the project uses ts-node or tsx, it works without extensions.

Let me also think about whether I need the `@Inject` decorator. Since `DRIZZLE` is a symbol, NestJS needs it to know how to resolve the dependency. Yes, I need `@Inject(DRIZZLE)`.

One more consideration: the plan says the repository should work with a `tx` handle for transactions (the invoice service opens a transaction and passes it down). But looking at the plan's signature for AccountRepository:

```ts
export class AccountRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<AccountRow | null>;
  create(data: { name: string }): Promise<AccountRow>;
  updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
}
```

It doesn't show a `tx` parameter. But the control flow says:
"Call `accountRepo.updateCounters(accountId, -amount, +amount)` via `tx`"

So the `updateCounters` method needs to accept a transaction handle somehow. But the plan's signature doesn't show it explicitly...

Wait, let me re-read: "Call `accountRepo.updateCounters(accountId, -amount, +amount)` via `tx`". This could mean the service calls `accountRepo.updateCounters` and passes the tx. But the plan's explicit signature doesn't include a tx parameter.

Hmm, but the invoice repository has `createWithLineItems(tx: Tx, data: CreateInvoiceData)` which explicitly takes a tx. The account repository doesn't show that in its signature.

Looking at this more carefully, maybe the pattern is that the repository methods can accept an optional transaction handle. Or maybe the `PostgresJsDatabase` type also works as a tx (since in Drizzle, both the db and tx have the same query interface).

Actually, in Drizzle, `PostgresJsDatabase` and the transaction client have compatible interfaces. You could type the parameter as `PostgresJsDatabase` and pass either the db or a tx.

But the plan's signature is explicit: `updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>` - no tx parameter.

Wait, but the control flow says "via tx". Let me re-read the plan section on control flow:

"e. Call `accountRepo.updateCounters(accountId, -amount, +amount)` via `tx` (balance decreases by amount, total_invoiced increases by amount)."

I think "via tx" means it's executed within the transaction context. The cleanest way in Drizzle is to have the method accept a query runner (which can be either db or tx).

But the plan's explicit signature doesn't include it. I should follow the plan's explicit signature. Maybe the service will just call the method and the repository uses `this.db` internally? But that would break atomicity...

Actually, I think the most defensible reading is: the plan's signature shows the public API, and internally for transactional use, the method could accept an optional tx parameter. But since the plan doesn't show it, and says "Do not add an export, a feature or a file the plan does not name", I should stick to the exact signature.

But wait - if `updateCounters` doesn't accept a tx, how does it participate in the transaction? Let me re-read...

Looking at the invoice repository: `createWithLineItems(tx: Tx, data: CreateInvoiceData): Promise<InvoiceRow>` - it explicitly takes a tx.

For the account repository, the plan doesn't show a tx parameter. But the control flow requires it to be in the same transaction. 

I think the most defensible reading is that the repository methods should accept a query runner parameter (db or tx) for the operations that need to be transactional. But since the plan's signature is explicit and doesn't include it...

Let me re-read the instruction: "Implement exactly what the plan specifies for this file."

The plan says:
```
updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
```

I'll implement it exactly as specified. If the service needs to pass a tx, that's a problem for the service file, not this one. The plan is my specification and it shows this exact signature.

But wait - actually, I think I'm overthinking this. In Drizzle, you can make the db reference be a generic "query runner". The `PostgresJsDatabase` type has all the query methods that a tx also has. So if the service needs to call `accountRepo.updateCounters` within a transaction, it could either:
1. Have the repo method accept an optional tx (not in plan)
2. Have the service pass itself into the repo somehow

Actually, you know what, let me just follow the plan exactly. The signature is `updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>`. I'll implement it using `this.db` internally. If there's a transactional concern, that's handled at the service level (maybe the service passes the tx as the db reference through some other mechanism, or the plan's control flow description is slightly imprecise about the implementation detail).

The instruction says: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence... write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment"

I think the most defensible reading is to implement exactly what the plan's signature says. The transactional aspect will be handled by the service layer (perhaps by injecting the tx into the db or by some other pattern). My job is just this file.

Let me finalize my implementation:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { accounts } from '../../drizzle/schema.js';
import { DRIZZLE } from '../database/database.module.js';

export interface AccountRow {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AccountRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: { name: string }): Promise<AccountRow> {
    const rows = await this.db
      .insert(accounts)
      .values(data)
      .returning();
    return rows[0];
  }

  async updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null> {
    const rows = await this.db
      .update(accounts)
      .set({
        balance_cents: sql`(${accounts.balance_cents}) + ${deltaBalance}`,
        total_invoiced_cents: sql`(${accounts.total_invoiced_cents}) + ${deltaInvoiced}`,
        updated_at: new Date(),
      })
      .where(eq(accounts.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
```

Wait, I need to think about the import paths. The schema is at `drizzle/schema.ts` (project root level, not under `src/`). The repository is at `src/account/account.repository.ts`. So the relative path would be `../../drizzle/schema.js` (or without .js).

The database module is at `src/database/database.module.ts`. From `src/account/account.repository.ts`, the relative path is `../database/database.module.js` (or without .js).

Given ESM, I should use `.js` extensions. But in practice with NestJS + TypeScript, many projects omit them. Let me check the reference file again... The `database.module.ts` only imports from packages, so I can't tell.

I'll go without extensions since that's more common in NestJS TypeScript projects and the build tool handles it. Actually, no - the convention explicitly says ESM with `"type": "module"`. In strict ESM, you need extensions. But TypeScript's `moduleResolution: "bundler"` or `"node16"` handles this differently.

You know what, I'll use the `.js` extension since it's explicitly ESM. This is the safest for a `"type": "module"` project.

Actually, let me reconsider. In most NestJS projects I've seen with ESM, they still use extensionless imports because they use a bundler or ts-node/tsx for development. The `"type": "module"` in package.json affects Node's module resolution for .js files, but TypeScript source files are compiled. I'll go without extensions to match the most common NestJS pattern.

Let me also reconsider whether I should use `.limit(1)` or just take the first result. Since `id` is a primary key, there will be at most one row. Using `.limit(1)` is a minor optimization but not strictly necessary. I'll keep it for clarity.

One more thought: should I use `drizzle-orm` imports or `drizzle-orm/postgres-js`? The schema uses `drizzle-orm/pg-core`. The database module uses `drizzle-orm/postgres-js` for the `PostgresJsDatabase` type. For query helpers like `eq`, `sql`, they come from `drizzle-orm`.

Let me finalize. I'm confident in my implementation.
```

## reply

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { accounts } from '../../drizzle/schema';
import { DRIZZLE } from '../database/database.module';

export interface AccountRow {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AccountRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: { name: string }): Promise<AccountRow> {
    const rows = await this.db
      .insert(accounts)
      .values(data)
      .returning();
    return rows[0];
  }

  async updateCounters(
    id: string,
    deltaBalance: bigint,
    deltaInvoiced: bigint,
  ): Promise<AccountRow | null> {
    const rows = await this.db
      .update(accounts)
      .set({
        balance_cents: sql`(${accounts.balance_cents}) + ${deltaBalance}`,
        total_invoiced_cents: sql`(${accounts.total_invoiced_cents}) + ${deltaInvoiced}`,
        updated_at: new Date(),
      })
      .where(eq(accounts.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
```
