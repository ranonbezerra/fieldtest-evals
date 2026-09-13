import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/pg';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import type {
  AccountRow,
  InvoiceRow,
  LineItemRow,
  PrismaClient,
  Tx,
} from './client.js';

/**
 * Production client that implements the same shape as the old Prisma client,
 * but internally uses Drizzle for all database interactions.
 */
class DrizzleBillingClient implements PrismaClient {
  // ---------------------------------------------------------------------------
  // Account helpers
  // ---------------------------------------------------------------------------
  account = {
    async findUnique({ where }: { where: { id: string } }): Promise<AccountRow | null> {
      const rows = await this.db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, where.id))
        .limit(1);
      return rows[0] ?? null;
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow> {
      const inc = data.invoiceCount.increment;
      await this.db
        .update(schema.accounts)
        .set({ invoiceCount: sql`${schema.accounts.invoiceCount} + ${inc}` })
        .where(eq(schema.accounts.id, where.id));
      const rows = await this.db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, where.id));
      return rows[0] as AccountRow;
    },
  };

  // ---------------------------------------------------------------------------
  // Invoice helpers
  // ---------------------------------------------------------------------------
  invoice = {
    async findUnique({ where }: { where: { id: string } }): Promise<InvoiceRow | null> {
      const rows = await this.db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, where.id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findMany({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> {
      return await this.db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.accountId, where.accountId));
    },

    async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> {
      const rows = await this.db.insert(schema.invoices).values(data).returning();
      return rows[0] as InvoiceRow;
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<InvoiceRow>;
    }): Promise<InvoiceRow> {
      const rows = await this.db
        .update(schema.invoices)
        .set(data)
        .where(eq(schema.invoices.id, where.id))
        .returning();
      const invoice = rows[0];
      if (!invoice) {
        // Mimic Prisma's "record not found" error so `mapPrismaError` works.
        const err = new Error('Invoice not found') as any;
        err.code = 'P2025';
        throw err;
      }
      return invoice as InvoiceRow;
    },
  };

  // ---------------------------------------------------------------------------
  // Invoice line‑item helpers
  // ---------------------------------------------------------------------------
  invoiceLineItem = {
    async findMany({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> {
      return await this.db
        .select()
        .from(schema.invoiceLineItems)
        .where(eq(schema.invoiceLineItems.invoiceId, where.invoiceId));
    },

    async createMany({ data }: { data: LineItemRow[] }): Promise<{ count: number }> {
      const rows = await this.db.insert(schema.invoiceLineItems).values(data).returning();
      return { count: rows.length };
    },
  };

  // ---------------------------------------------------------------------------
  // Transaction support
  // ---------------------------------------------------------------------------
  async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (txDb) => {
      // Build a minimal Tx proxy that forwards to the transaction client.
      const tx: Tx = {
        invoice: {
          async create({ data }) {
            const rows = await txDb.insert(schema.invoices).values(data).returning();
            return rows[0] as InvoiceRow;
          },
        },
        invoiceLineItem: {
          async createMany({ data }) {
            const rows = await txDb.insert(schema.invoiceLineItems).values(data).returning();
            return { count: rows.length };
          },
        },
        account: {
          async update({ where, data }) {
            const inc = data.invoiceCount.increment;
            await txDb
              .update(schema.accounts)
              .set({ invoiceCount: sql`${schema.accounts.invoiceCount} + ${inc}` })
              .where(eq(schema.accounts.id, where.id));
            const rows = await txDb.select().from(schema.accounts).where(eq(schema.accounts.id, where.id));
            return rows[0] as AccountRow;
          },
        },
      };
      return fn(tx);
    });
  }

  // ---------------------------------------------------------------------------
  // Underlying Drizzle DB instance – created once per process.
  // ---------------------------------------------------------------------------
  private readonly db = drizzle(
    new Pool({ connectionString: process.env.DATABASE_URL }),
    { schema: { accounts: schema.accounts, invoices: schema.invoices, invoiceLineItems: schema.invoiceLineItems } },
  );
}

// Export a singleton for convenience – production code can import this.
export const billingClient = new DrizzleBillingClient();
