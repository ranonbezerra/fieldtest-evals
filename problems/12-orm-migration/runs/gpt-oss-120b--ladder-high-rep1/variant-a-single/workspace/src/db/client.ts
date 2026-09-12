import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, invoices, invoiceLineItems } from './schema.js';
import { eq, sql } from 'drizzle-orm';
import type { AccountRow, InvoiceRow, LineItemRow } from '../billing/prisma.js';

// Create a PostgreSQL pool using the DATABASE_URL environment variable.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema: { accounts, invoices, invoiceLineItems } });

export interface DrizzleClient {
  account: {
    findUnique(args: { where: { id: string } }): Promise<AccountRow | null>;
    update(args: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow>;
  };
  invoice: {
    findUnique(args: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(args: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    create(args: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
    update(args: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    findMany(args: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
    createMany(args: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  $transaction<T>(fn: (tx: DrizzleClient) => Promise<T>): Promise<T>;
}

// Production client implementation using Drizzle.
export const client: DrizzleClient = {
  account: {
    async findUnique({ where }) {
      const rows = await db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    async update({ where, data }) {
      const inc = data.invoiceCount.increment;
      await db
        .update(accounts)
        .set({ invoiceCount: sql`${accounts.invoiceCount} + ${inc}` })
        .where(eq(accounts.id, where.id));
      const rows = await db.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
      return rows[0];
    },
  },
  invoice: {
    async findUnique({ where }) {
      const rows = await db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
      return rows[0] ?? null;
    },
    async findMany({ where }) {
      const rows = await db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
      return rows;
    },
    async create({ data }) {
      const [row] = await db.insert(invoices).values(data).returning();
      return row;
    },
    async update({ where, data }) {
      await db.update(invoices).set(data).where(eq(invoices.id, where.id));
      const rows = await db.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
      const row = rows[0];
      if (!row) {
        const err: any = new Error(`Invoice ${where.id} not found`);
        err.code = 'P2025';
        throw err;
      }
      return row;
    },
  },
  invoiceLineItem: {
    async findMany({ where }) {
      const rows = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, where.invoiceId));
      return rows;
    },
    async createMany({ data }) {
      await db.insert(invoiceLineItems).values(data);
      return { count: data.length };
    },
  },
  async $transaction<T>(fn) {
    return await db.transaction(async (tx) => {
      // Build a client that uses the transaction context `tx`.
      const transactionalClient: DrizzleClient = {
        account: {
          async findUnique({ where }) {
            const rows = await tx.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
            return rows[0] ?? null;
          },
          async update({ where, data }) {
            const inc = data.invoiceCount.increment;
            await tx
              .update(accounts)
              .set({ invoiceCount: sql`${accounts.invoiceCount} + ${inc}` })
              .where(eq(accounts.id, where.id));
            const rows = await tx.select().from(accounts).where(eq(accounts.id, where.id)).limit(1);
            return rows[0];
          },
        },
        invoice: {
          async findUnique({ where }) {
            const rows = await tx.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
            return rows[0] ?? null;
          },
          async findMany({ where }) {
            const rows = await tx.select().from(invoices).where(eq(invoices.accountId, where.accountId));
            return rows;
          },
          async create({ data }) {
            const [row] = await tx.insert(invoices).values(data).returning();
            return row;
          },
          async update({ where, data }) {
            await tx.update(invoices).set(data).where(eq(invoices.id, where.id));
            const rows = await tx.select().from(invoices).where(eq(invoices.id, where.id)).limit(1);
            const row = rows[0];
            if (!row) {
              const err: any = new Error(`Invoice ${where.id} not found`);
              err.code = 'P2025';
              throw err;
            }
            return row;
          },
        },
        invoiceLineItem: {
          async findMany({ where }) {
            const rows = await tx
              .select()
              .from(invoiceLineItems)
              .where(eq(invoiceLineItems.invoiceId, where.invoiceId));
            return rows;
          },
          async createMany({ data }) {
            await tx.insert(invoiceLineItems).values(data);
            return { count: data.length };
          },
        },
        async $transaction(innerFn) {
          // Nested transaction support (not used here)
          return await innerFn(transactionalClient);
        },
      };
      return await fn(transactionalClient);
    });
  },
};
