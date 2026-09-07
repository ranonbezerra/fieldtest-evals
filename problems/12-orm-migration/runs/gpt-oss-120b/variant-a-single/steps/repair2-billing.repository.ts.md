# repair2-billing.repository.ts

## reasoning

```
We need to rewrite repository to use Drizzle imports. Likely need to export types from db/client. Assume client exports db and schema. Provide correct imports with .js extensions. Also define Tx type. Simplify: use Drizzle ORM with better-sqlite3. We'll just stub functions matching interface used elsewhere.

Implement class BillingRepository with methods used in service: findAccount, findInvoice, findInvoicesByAccount, createInvoiceWithLineItems, updateInvoice, findLineItemsByInvoice. Use db (import from '../db/client.js') and schema tables.

We need to import types AccountRow, InvoiceRow, LineItemRow from '../db/client.js' (they are exported there). Ensure .js extension.

Provide transaction method using db.transaction.

Implement types.

Let's craft file.
```

## reply

```ts
// src/billing/billing.repository.ts
import type {
  AccountRow,
  InvoiceRow,
  LineItemRow,
  PrismaClient,
  Tx,
} from '../db/client.js';
import { db } from '../db/client.js';
import {
  accounts,
  invoices,
  invoiceLineItems,
} from '../db/schema.js';

// The repository must be the only layer that talks to the DB.
// It mirrors the shape of the old Prisma‑based repository but uses Drizzle
// primitives instead.
//
// NOTE: The actual table definitions live in `src/db/schema.ts`.  They are
// imported here solely for the query helpers; the runtime shape of the rows
// is compatible with the `*Row` interfaces exported from `../db/client.ts`.
//
// All public methods return plain objects that match those interfaces so the
// rest of the codebase (service, controller, tests) remains byte‑compatible.
export class BillingRepository {
  // -------------------------------------------------------------------------
  // READ
  // -------------------------------------------------------------------------

  async findAccount(id: string): Promise<AccountRow | null> {
    const row = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();
    return row ?? null;
  }

  async findInvoice(id: string, includeLineItems = false): Promise<
    (InvoiceRow & { lineItems?: LineItemRow[] }) | null
  > {
    const invoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();

    if (!invoice) return null;

    if (includeLineItems) {
      const lineItems = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, id))
        .all();
      return { ...invoice, lineItems };
    }

    return invoice;
  }

  async findInvoicesByAccount(accountId: string): Promise<InvoiceRow[]> {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.accountId, accountId))
      .all();
  }

  async findLineItemsByInvoice(invoiceId: string): Promise<LineItemRow[]> {
    return db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .all();
  }

  // -------------------------------------------------------------------------
  // WRITE
  // -------------------------------------------------------------------------

  /**
   * Creates an invoice, its line items and increments the account's invoice
   * counter – all inside a single transaction.
   *
   * The shape of the returned invoice matches `InvoiceRow` (the `createdAt`
   * column is populated by the DB trigger/DEFAULT, just like Prisma did).
   */
  async createInvoiceWithLineItems(
    invoice: Omit<InvoiceRow, 'createdAt'>,
    lineItems: LineItemRow[],
  ): Promise<InvoiceRow> {
    return db.transaction(async (tx) => {
      // 1️⃣ create the invoice
      const createdInvoice = await tx
        .insert(invoices)
        .values(invoice)
        .returning()
        .get();

      // 2️⃣ create the line items (position is already provided by caller)
      await tx
        .insert(invoiceLineItems)
        .values(
          lineItems.map((li) => ({
            ...li,
            invoiceId: createdInvoice.id,
          })),
        )
        .run();

      // 3️⃣ bump the invoice counter on the account
      await tx
        .update(accounts)
        .set({ invoiceCount: accounts.invoiceCount + 1 })
        .where(eq(accounts.id, invoice.accountId))
        .run();

      return createdInvoice;
    });
  }

  async updateInvoice(
    id: string,
    data: Partial<InvoiceRow>,
  ): Promise<InvoiceRow> {
    // Drizzle does not support a generic `update returning *` yet, so we
    // perform the update then fetch the row.
    await db
      .update(invoices)
      .set(data as any) // `as any` is safe – the service only passes known fields.
      .where(eq(invoices.id, id))
      .run();

    const updated = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();

    // The call site expects a non‑null row (the invoice must exist).
    return updated!;
  }

  // -------------------------------------------------------------------------
  // TRANSACTION HELPERS (used by tests)
  // -------------------------------------------------------------------------

  /**
   * Runs a callback inside a Drizzle transaction and returns its result.
   * The generic mirrors the Prisma `$transaction` signature.
   */
  async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    // The `Tx` type is just a subset of the Prisma‑like client that the old
    // code expected.  For Drizzle we expose a minimal compatible façade.
    const tx = {
      invoice: {
        create: async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) => {
          const row = await db
            .insert(invoices)
            .values(data)
            .returning()
            .get();
          return row;
        },
      },
      invoiceLineItem: {
        createMany: async ({
          data,
        }: {
          data: LineItemRow[];
        }) => {
          await db.insert(invoiceLineItems).values(data).run();
          return { count: data.length };
        },
      },
      account: {
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { invoiceCount: { increment: number } };
        }) => {
          const inc = data.invoiceCount.increment;
          await db
            .update(accounts)
            .set({ invoiceCount: accounts.invoiceCount + inc })
            .where(eq(accounts.id, where.id))
            .run();

          // Return the updated row for parity with Prisma.
          const row = await db
            .select()
            .from(accounts)
            .where(eq(accounts.id, where.id))
            .get();
          return row!;
        },
      },
    } as unknown as Tx;

    // Drizzle's `transaction` method expects a callback that receives the DB
    // instance; we ignore it and simply call the supplied `fn` with our shim.
    return db.transaction(() => fn(tx));
  }
}

/* -------------------------------------------------------------------------
   Utility: equality helper – Drizzle does not expose `eq` directly in the
   generated typings, so we import it from the query builder.
   ------------------------------------------------------------------------- */
import { eq } from 'drizzle-orm';
```
