# 02-client.ts

## reasoning

```
The task is to write exactly one file: `src/db/client.ts`.

From the PLAN.md, section 3 specifies:

```ts
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { QueryResultHOC } from 'drizzle-orm';

export type DrizzleDb = NodePgDatabase<Schema>; // Schema = { accounts, invoices, line_items }
export function createDb(): DrizzleDb;          // reads DATABASE_URL, returns connected instance
```

The plan says:
- `src/db/client.ts` reads: `src/db/schema.ts`
- It's a "createDb factory returning connected DrizzleDb"

So I need to:
1. Import `drizzle` and `NodePgDatabase` from `drizzle-orm/node-postgres`
2. Import `Pool` from `pg`
3. Import the schema tables from `./schema.js` (ESM, so `.js` extension)
4. Define the schema type as an object with the three tables
5. Export `DrizzleDb` type
6. Export `createDb()` function that reads `DATABASE_URL`, creates a `pg.Pool`, and returns `drizzle(pool, { schema })`

Wait, let me think about the Drizzle API. With `drizzle-orm/node-postgres`, you do:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
```

The type would be `NodePgDatabase<typeof schema>` where schema is the object of tables.

Let me look at what the plan says more carefully:

```ts
export type DrizzleDb = NodePgDatabase<Schema>; // Schema = { accounts, invoices, line_items }
export function createDb(): DrizzleDb;          // reads DATABASE_URL, returns connected instance
```

So `Schema` is `{ accounts, invoices, line_items }`. I need to import the table objects from `./schema.js` and construct this schema object.

The import path: since the file is at `src/db/client.ts` and the schema is at `src/db/schema.ts`, the relative import would be `./schema.js` (ESM convention with `.js` extension for TypeScript).

Let me also consider: the plan mentions `import type { QueryResultHOC } from 'drizzle-orm';` but I'm not sure if that's actually needed. Looking at the plan's signature block, it lists that import but the actual usage might not require it. Let me re-read...

The plan shows:
```ts
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { QueryResultHOC } from 'drizzle-orm';

export type DrizzleDb = NodePgDatabase<Schema>; // Schema = { accounts, invoices, line_items }
export function createDb(): DrizzleDb;          // reads DATABASE_URL, returns connected instance
```

The `QueryResultHOC` import is listed in the plan's signature block. But does it actually get used? The plan says "Implement exactly what the plan specifies for this file." The plan's signature block includes that import, so I should include it. But wait - the instruction says "Do not add an export, a feature or a file the plan does not name." It doesn't say don't include imports the plan names. The plan's signature block for this file includes that import, so I'll include it.

Actually, let me reconsider. The plan shows the file's contents in a sketch form. The `QueryResultHOC` might be used internally or might just be part of the type setup. Since the plan explicitly lists it in the import for this file, I'll include it. But if it's not used, it might cause a lint warning. However, the instructions say to implement exactly what the plan specifies. Let me include it since the plan lists it.

Wait, actually re-reading more carefully - the plan says these are the signatures for `src/db/client.ts`. The import of `QueryResultHOC` is part of the plan's specification for this file. I'll include it.

Now, for the schema object: I need to import `accounts`, `invoices`, `lineItems` from `./schema.js`. The schema object for Drizzle's `drizzle()` function is `{ accounts, invoices, line_items: lineItems }` — wait, no. In Drizzle, the schema object keys should match how you reference them in queries. Looking at the schema.ts file, the exported variable names are `accounts`, `invoices`, `lineItems`. 

In Drizzle's node-postgres, the schema parameter is an object where keys are used to type the relations. The convention is:

```ts
import * as schema from './schema.js';
const db = drizzle(pool, { schema });
```

Or:

```ts
import { accounts, invoices, lineItems } from './schema.js';
const schema = { accounts, invoices, lineItems };
const db = drizzle(pool, { schema });
```

Actually, the most common pattern with Drizzle is to use `import * as schema` or pass an object. Let me think about what makes the type work correctly.

For `NodePgDatabase<typeof schema>`, the schema needs to be a const object mapping names to table definitions. The keys in this object become property names on the db instance for querying (e.g., `db.query.accounts.findMany()`).

Looking at the plan: `Schema = { accounts, invoices, line_items }` — but the exported variable is `lineItems` (camelCase). The table name in the DB is `line_items` but the JS variable is `lineItems`. 

Hmm, the plan comment says `Schema = { accounts, invoices, line_items }` but that's just a comment annotation. The actual keys would be the variable names used as object keys. Let me think...

If I do:
```ts
const schema = { accounts, invoices, lineItems };
```

Then the type would be `NodePgDatabase<typeof schema>` and you'd access as `db.query.lineItems`. 

If I do:
```ts
const schema = { accounts, invoices, line_items: lineItems };
```

Then you'd access as `db.query.line_items`.

The plan comment says `{ accounts, invoices, line_items }` which suggests the key is `line_items`. But that's just a comment. In practice, for Drizzle, the key in the schema object determines how you access it via `db.query.<key>`. 

Looking at the repository files mentioned in the plan, they likely use `db.query.invoices`, `db.query.lineItems` or similar. Since I don't have the repository files to check, and the plan comment uses `line_items`, but the variable name is `lineItems`...

Actually, I think the most defensible reading is to use the variable names as keys since that's the standard Drizzle pattern. The plan comment is just an informal annotation. Let me use:

```ts
const schema = { accounts, invoices, lineItems };
```

This is the most standard Drizzle approach and matches the variable names exported from schema.ts.

Actually wait - I just realized I should use `import * as dbSchema` or similar to avoid naming conflicts. Let me think about the cleanest approach:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as dbSchema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof dbSchema>;

export function createDb(): DrizzleDb {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema: dbSchema });
}
```

Hmm, but `import * as dbSchema` would include all exports from schema.ts, including the types. That's fine because at runtime, type exports don't exist, and Drizzle handles this.

Actually, the more common and explicit pattern is:

```ts
import { accounts, invoices, lineItems } from './schema.js';
const schema = { accounts, invoices, lineItems };
```

But then `typeof schema` gives `{ accounts: typeof accounts, invoices: typeof invoices, lineItems: typeof lineItems }` which is exactly what Drizzle expects.

Let me also consider: should I use `pg.default` or just `pg`? With ESM and `pg`, the import would be:

```ts
import pg from 'pg';
// or
import { Pool } from 'pg';
```

Since we're using ESM (`"type": "module"`), `import { Pool } from 'pg'` should work. Or `import pg from 'pg'` and use `pg.Pool`. Let me go with the named import for clarity.

Actually, looking at how Drizzle's node-postgres example works:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: ... });
```

The `pg` package in ESM... Let me think. The `pg` package exports a default export which is the Client/Pool/etc. In ESM, you can do `import pg from 'pg'` or `import { Pool } from 'pg'`.

I'll use `import pg from 'pg'` since that's the most common pattern in Drizzle examples, and then `new pg.Pool(...)`.

Wait, but with strict TypeScript and ESM, `import pg from 'pg'` might need the default export to be defined. The `pg` package does have a default export in its ESM compatibility layer. Let me just use it.

Actually, for safety and explicitness in a strict TS ESM environment, let me use:

```ts
import { Pool } from 'pg';
```

This is cleaner and avoids any default export ambiguity.

Now let me also consider: the plan says `import type { QueryResultHOC } from 'drizzle-orm';`. Is this actually used anywhere in the file? Looking at the plan, it's listed as an import for this file. I'll include it since the plan specifies it, even if it seems unused. Actually no - if it's truly unused, it would be dead code. Let me re-read the plan...

The plan says:
```ts
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { QueryResultHOC } from 'drizzle-orm';

export type DrizzleDb = NodePgDatabase<Schema>; // Schema = { accounts, invoices, line_items }
export function createDb(): DrizzleDb;          // reads DATABASE_URL, returns connected instance
```

This is a sketch/signature, not the full implementation. The `QueryResultHOC` might be used in the full implementation or might just be part of the type ecosystem. Since I'm writing the complete file and `QueryResultHOC` isn't obviously needed for `createDb()` or the type export, I'll omit it to avoid unused imports. The plan's sketch is not a literal file - it's showing the key signatures.

Wait, but the instruction says "Implement exactly what the plan specifies for this file." Does that mean I must include that import? I think the plan is specifying the *interface* (exports, function signatures) not every single import. The `QueryResultHOC` import in the sketch might just be showing what's available from drizzle-orm. I'll omit it since it's not needed for the actual implementation.

Let me finalize my implementation:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, lineItems } from './schema.js';

const schema = { accounts, invoices, lineItems };

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```

Wait, can I combine the import from 'drizzle-orm/node-postgres'? Yes:
```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
```

That's cleaner. Let me do that.

Also, should `schema` be exported? The plan doesn't say to export it. It's an internal const. I'll keep it local.

One more thought: `process.env.DATABASE_URL` - should I handle the case where it's undefined? The plan says "reads DATABASE_URL, returns connected instance" without mentioning error handling. The convention says "Configuration comes from environment variables only. DATABASE_URL for Postgres." I'll assume it's always set and not add extra validation - keep it simple as the plan specifies.

Let me also double-check: does `drizzle()` from `drizzle-orm/node-postgres` accept a `Pool` instance? Yes, it accepts a `pg.Pool` (or `pg.Client`). The second argument `{ schema }` is optional and used for type-safe relation queries.

Final version:

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, lineItems } from './schema.js';

const schema = { accounts, invoices, lineItems };

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```

This is clean, minimal, and matches the plan exactly. Let me verify against the plan requirements:
- ✅ Reads `src/db/schema.ts` (imports tables from it)
- ✅ Exports `DrizzleDb` type as `NodePgDatabase<Schema>` where Schema = { accounts, invoices, lineItems }
- ✅ Exports `createDb()` function that reads DATABASE_URL and returns connected DrizzleDb
- ✅ No extra exports or features
- ✅ Complete file, first line to last
```

## reply

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, lineItems } from './schema.js';

const schema = { accounts, invoices, lineItems };

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```
