import { db } from '../database.js';
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import type {
  AccountRow,
  InvoiceRow,
  LineItemRow,
  PrismaClient,
  Tx,
} from './prisma.js';

export class DrizzleAdapter implements PrismaClient {
  // Account operations
  account = {
    async findUnique({ where }: { where: { id: string } }): Promise<AccountRow | null> {
      const rows = await db.select().from(accounts).where(eq(accounts.id, where.id));
      return rows[0] ?? null;
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow> {
      const increment = data.invoiceCount.increment;
      const rows = await db
        .update(accounts)
        .set({
          invoiceCount: sql`${accounts.invoiceCount} + ${increment}`,
        })
        .where(eq(accounts.id, where.id))
        .returning();
      return rows[0];
    },
  };

  // Invoice operations
  invoice = {
    async findUnique({ where }: { where: { id: string } }): Promise<InvoiceRow | null> {
      const rows = await db.select().from(invoices).where(eq(invoices.id, where.id));
      return rows[0] ?? null;
    },

    async findMany({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> {
      return await db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
    },

    async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> {
      const row = {
        ...data,
        createdAt: new Date(),
      } as InvoiceRow;
      const inserted = await db.insert(invoices).values(row).returning();
      return inserted[0];
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<InvoiceRow>;
    }): Promise<InvoiceRow> {
      const rows = await db
        .update(invoices)
        .set(data as any)
        .where(eq(invoices.id, where.id))
        .returning();
      if (rows.length === 0) {
        const err: any = new Error('Record not found');
        err.code = 'P2025';
        throw err;
      }
      return rows[0];
    },
  };

  // Invoice line‑item operations
  invoiceLineItem = {
    async findMany({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> {
      // Order by position to keep a deterministic order
      return await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, where.invoiceId))
        .orderBy(invoiceLineItems.position);
    },

    async createMany({ data }: { data: LineItemRow[] }): Promise<{ count: number }> {
      await db.insert(invoiceLineItems).values(data);
      return { count: data.length };
    },
  };

  async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return await db.transaction(async (txDb) => {
      const tx: Tx = {
        account: {
          async update({
            where,
            data,
          }: {
            where: { id: string };
            data: { invoiceCount: { increment: number } };
          }) {
            const increment = data.invoiceCount.increment;
            const rows = await txDb
              .update(accounts)
              .set({
                invoiceCount: sql`${accounts.invoiceCount} + ${increment}`,
              })
              .where(eq(accounts.id, where.id))
              .returning();
            return rows[0];
          },
        },
        invoice: {
          async create({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) {
            const row = { ...data, createdAt: new Date() } as InvoiceRow;
            const inserted = await txDb.insert(invoices).values(row).returning();
            return inserted[0];
          },
        },
        invoiceLineItem: {
          async createMany({ data }: { data: LineItemRow[] }) {
            await txDb.insert(invoiceLineItems).values(data);
            return { count: data.length };
          },
        },
      };
      return fn(tx);
    });
  }
}
