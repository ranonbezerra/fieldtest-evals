# repair2-client.ts

## reasoning

```
We need to rewrite client.ts to use Drizzle, proper imports, types. Probably define schema and export db client. Provide types for AccountRow etc maybe re-export from schema. Simplify: export const db = drizzle(new BetterSqlite3(...)). Need types. Also need to export AccountRow, InvoiceRow, LineItemRow types matching previous. Use drizzle-orm with better-sqlite3. Add tsconfig node types. We'll just add import type definitions.

Implement:

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { eq } from 'drizzle-orm';
export type AccountRow = typeof schema.accounts.$inferSelect;
... similarly.

export const db = drizzle(new Database(process.env.DATABASE_URL ?? ':memory:'), { schema });

Also export transaction function similar to Prisma's $transaction: function $transaction<T>(fn: (tx: typeof db) => Promise<T>) { return db.transaction(fn); }

Need to match repository usage: they expect db.account.findUnique etc. We'll provide wrapper methods? Maybe repository imports directly from client.ts expecting same interface as Prisma client? The errors were about missing exported members InvoiceRow etc. So we need to export those types.

Also need to export Tx type? Not required.

Provide placeholder for SQLWrapper removal.

Also need to ensure file extensions .js in imports. Use './schema.js'.

Add // ASSUMPTION: ... for any unknown shapes.

Let's produce file.
```

## reply

```ts
// src/db/client.ts
// This file provides a Drizzle‑ORM client that mimics the minimal Prisma‑like
// interface used by the rest of the codebase.  Only the symbols required by the
// compilation errors are exported.  Any behaviour not exercised by the existing
// test‑suite is left to the original implementation – see MIGRATION_NOTES.md.

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js'; // explicit .js extension for ESM

// ---------------------------------------------------------------------------
// Type helpers – expose row types that the repository/service layers import.
// ---------------------------------------------------------------------------
export type AccountRow = typeof schema.accounts.$inferSelect;
export type InvoiceRow = typeof schema.invoices.$inferSelect;
export type LineItemRow = typeof schema.lineItems.$inferSelect;

// ---------------------------------------------------------------------------
// Drizzle client instance
// ---------------------------------------------------------------------------
// The DATABASE_URL environment variable points at a SQLite file in the test
// environment (or defaults to an in‑memory DB).  This mirrors the previous
// Prisma‑based configuration.
const sqlite = new Database(process.env.DATABASE_URL ?? ':memory:');
export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, {
  schema,
});

// ---------------------------------------------------------------------------
// Transaction helper – mirrors PrismaClient.$transaction
// ---------------------------------------------------------------------------
export async function $transaction<T>(
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  // Drizzle’s transaction method expects a callback that receives a
  // transaction‑scoped database instance.
  return db.transaction(fn);
}

// ---------------------------------------------------------------------------
// Minimal façade to keep existing repository code type‑compatible.
// ---------------------------------------------------------------------------
// The repository accesses `db.account.findUnique`, `db.invoice.findMany` etc.
// Drizzle already provides these methods on the generated table objects, but
// their signatures differ slightly from the Prisma ones.  We re‑export a thin
// wrapper object that forwards calls while preserving the expected return
// shapes.  Only the methods that are used in the current codebase are wrapped.
//
// NOTE: If new repository methods are added later they should be added here
//       following the same pattern.
export const account = {
  async findUnique(args: { where: { id: string } }): Promise<AccountRow | null> {
    const result = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, args.where.id))
      .limit(1);
    return result[0] ?? null;
  },

  async update(args: {
    where: { id: string };
    data: { invoiceCount: { increment: number } };
  }): Promise<AccountRow> {
    // Increment is the only supported operation in the current code.
    const inc = args.data.invoiceCount.increment;
    await db
      .update(schema.accounts)
      .set({ invoiceCount: schema.accounts.invoiceCount + inc })
      .where(eq(schema.accounts.id, args.where.id));
    // Return the updated row.
    const updated = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, args.where.id))
      .limit(1);
    // The original Prisma client always resolves to a row; we assume it exists.
    return updated[0] as AccountRow;
  },
};

export const invoice = {
  async create(args: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> {
    const [row] = await db
      .insert(schema.invoices)
      .values({
        ...args.data,
        // `createdAt` is auto‑filled by the DB default (NOW()).
      })
      .returning();
    return row as InvoiceRow;
  },

  async findUnique(args: {
    where: { id: string };
    include?: { lineItems: boolean };
  }): Promise<(InvoiceRow & { lineItems?: LineItemRow[] }) | null> {
    const invoices = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, args.where.id))
      .limit(1);
    const invoiceRow = invoices[0];
    if (!invoiceRow) return null;

    if (args.include?.lineItems) {
      const items = await db
        .select()
        .from(schema.lineItems)
        .where(eq(schema.lineItems.invoiceId, invoiceRow.id));
      return { ...invoiceRow, lineItems: items as LineItemRow[] };
    }
    return invoiceRow as InvoiceRow;
  },

  async findMany(args: { where: { accountId: string } }): Promise<InvoiceRow[]> {
    const rows = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.accountId, args.where.accountId));
    return rows as InvoiceRow[];
  },

  async update(args: {
    where: { id: string };
    data: Partial<InvoiceRow>;
  }): Promise<InvoiceRow> {
    await db
      .update(schema.invoices)
      .set(args.data)
      .where(eq(schema.invoices.id, args.where.id));
    const updated = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, args.where.id))
      .limit(1);
    return updated[0] as InvoiceRow;
  },
};

export const invoiceLineItem = {
  async createMany(args: { data: LineItemRow[] }): Promise<{ count: number }> {
    const result = await db.insert(schema.lineItems).values(args.data);
    // Drizzle returns the number of inserted rows via `rowCount` on the
    // `Result` object.
    const count = (result?.rowCount as number) ?? args.data.length;
    return { count };
  },

  async findMany(args: { where: { invoiceId: string } }): Promise<LineItemRow[]> {
    const rows = await db
      .select()
      .from(schema.lineItems)
      .where(eq(schema.lineItems.invoiceId, args.where.invoiceId));
    return rows as LineItemRow[];
  },
};

// ---------------------------------------------------------------------------
// Export a Prisma‑like namespace to keep existing imports happy.
// ---------------------------------------------------------------------------
export const prisma = {
  account,
  invoice,
  invoiceLineItem,
  $transaction,
} as const;

// ---------------------------------------------------------------------------
// ASSUMPTION:
// The rest of the codebase imports the row types directly from
// "../db/client.js".  By re‑exporting `AccountRow`, `InvoiceRow` and `LineItemRow`
// we satisfy those imports.  If additional fields or tables are added later they
// should be reflected in `src/db/schema.ts` and the corresponding `$inferSelect`
// types will automatically propagate.
// ---------------------------------------------------------------------------
```
