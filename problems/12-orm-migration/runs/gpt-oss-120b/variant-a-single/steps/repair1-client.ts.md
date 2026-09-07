# repair1-client.ts

## reasoning

```
We need to rewrite client using Drizzle better-sqlite3. Provide proper imports. Likely need to create a Database instance. Use drizzle-orm.

Implement something simple: import { drizzle } from 'drizzle-orm/better-sqlite3'; import Database from 'better-sqlite3'; import * as schema from './schema'; const client = drizzle(new Database(':memory:'), { schema }); export default client;

Also need type for SQLWrapper? Probably using drizzle's sql tag. So we can import { sql } from 'drizzle-orm'; and export that.

Implement functions? The errors show code passing string where SQLWrapper expected; maybe they used client.executeRaw? We'll just export a function raw(sql: string) { return client.run(sql as any); } but better to expose client directly.

Simplify: export const db = drizzle(new Database(process.env.DATABASE_URL ?? ':memory:'), { schema });

Also export const sql = drizzle.sql? Actually from drizzle-orm.

Write:

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database, type SQLWrapper } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database(process.env.DATABASE_URL ?? ':memory:');
const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });

export default db;

Also export sql tag:

import { sql } from 'drizzle-orm';

export { sql, type SQLWrapper };

That should satisfy types.
```

## reply

```ts
// src/db/client.ts

/**
 * Database client built with Drizzle ORM and better-sqlite3.
 *
 * The original Prisma client was removed in favour of Drizzle. This file
 * provides a `BetterSQLite3Database` instance that the rest of the codebase
 * (repositories, services, tests) can import.
 *
 * The environment variable `DATABASE_URL` points at a SQLite file. If it is not
 * set we fall back to an in‑memory database – this mirrors the behaviour of the
 * original test setup.
 *
 * The exported `db` value satisfies the same type contract that the previous
 * Prisma client exposed, i.e. it is the only object that touches the database.
 * All queries should go through the repository layer.
 */

import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
  type SQLWrapper,
} from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';

// The schema generated in `src/db/schema.ts` (tables, columns, constraints)
// must be imported so Drizzle can type‑check queries.
import * as schema from './schema';

// Initialise the SQLite driver. The driver accepts a file path; we use the
// `DATABASE_URL` env var or default to an in‑memory database.
const sqlite = new Database(process.env.DATABASE_URL ?? ':memory:');

// Create a typed Drizzle database instance.
const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, {
  schema,
});

/**
 * Export the typed database instance for use throughout the application.
 *
 * Repositories should import this default export and never call any raw SQL
 * directly; they should use Drizzle's query builder or the `sql` tag for
 * parameterised statements.
 */
export default db;

// Re‑export the `sql` tag and its type for callers that need to build raw
// fragments (e.g., complex WHERE clauses). This mirrors the previous pattern
// where callers passed a string that was expected to be an `SQLWrapper`.
export { sql, type SQLWrapper };
```
