import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BillingTx, PrismaClient } from './prisma.js';
import { accounts, invoiceLineItems, invoices } from './schema.js';
import * as schema from './schema.js';

export type BillingDb = PostgresJsDatabase<typeof schema>;

interface Delegates {
  account: PrismaClient['account'];
  invoice: PrismaClient['invoice'];
  invoiceLineItem: PrismaClient['invoiceLineItem'];
}

/**
 * Drizzle implementation of the data-access seam.
 *
 * Deliberate fidelity choices (see MIGRATION_NOTES.md):
 * - No ORDER BY anywhere: the legacy queries returned rows in natural
 *   (insertion) order and the wire format depends on that.
 * - Money columns are read back as bigint (schema uses mode 'bigint'), so
 *   the serializer keeps shipping exact decimal strings.
 * - `update` uses `.returning()`: an empty result means "no row matched"
 *   (Prisma used to raise P2025) and is resolved as null.
 */
function makeDelegates(db: BillingDb): Delegates {
  return {
    account: {
      async findUnique({ where }) {
        const rows = await db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
        return rows[0] ?? null;
      },
      async update({ where, data }) {
        const rows = await db
          .update(accounts)
          .set({ invoiceCount: sql`${accounts.invoiceCount} + ${data.invoiceCount.increment}` })
          .where(eq(accounts.id, where.id))
          .returning();
        const [row] = rows;
        if (!row) throw new Error(`account ${where.id} not found`);
        return row;
      },
    },
    invoice: {
      async findUnique({ where }) {
        const rows = await db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
        return rows[0] ?? null;
      },
      async findMany({ where }) {
        return db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
      },
      async create({ data }) {
        const rows = await db.insert(invoices).values(data).returning();
        const [row] = rows;
        if (!row) throw new Error('invoice insert returned no row');
        return row;
      },
      async update({ where, data }) {
        const rows = await db
          .update(invoices)
          .set(data as Partial<typeof invoices.$inferInsert>)
          .where(eq(invoices.id, where.id))
          .returning();
        return rows[0] ?? null;
      },
    },
    invoiceLineItem: {
      async findMany({ where }) {
        return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, where.invoiceId));
      },
      async createMany({ data }) {
        if (data.length === 0) return { count: 0 };
        await db.insert(invoiceLineItems).values(data);
        return { count: data.length };
      },
    },
  };
}

export class DrizzleBillingClient implements PrismaClient {
  private readonly root: Delegates;

  constructor(private readonly db: BillingDb) {
    this.root = makeDelegates(db);
  }

  get account() {
    return this.root.account;
  }

  get invoice() {
    return this.root.invoice;
  }

  get invoiceLineItem() {
    return this.root.invoiceLineItem;
  }

  async $transaction<T>(fn: (tx: BillingTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // A Drizzle transaction is queryable exactly like the database
      // (select/insert/update/delete), so the same delegates work on it.
      const d = makeDelegates(tx as unknown as BillingDb);
      return fn({ invoice: d.invoice, invoiceLineItem: d.invoiceLineItem, account: d.account });
    });
  }
}
