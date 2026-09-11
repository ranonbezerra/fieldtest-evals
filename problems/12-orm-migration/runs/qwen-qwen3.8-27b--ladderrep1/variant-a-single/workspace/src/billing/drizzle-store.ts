import { eq, sql } from 'drizzle-orm';
import { RowNotFoundError } from '../common/errors.js';
import type { AccountRow, BillingStore, InvoiceRow, LineItemRow } from './billing-store.js';
import { account, invoice, invoiceLineItem, type BillingDb } from './schema.js';

/**
 * Drizzle implementation of the billing data-access contract.
 *
 * Each method is a one-to-one port of the query the old Prisma client ran:
 *  - findUnique   -> SELECT ... WHERE id = $1 LIMIT 1 (null when missing)
 *  - findMany     -> SELECT ... WHERE ... with NO ORDER BY (storage order is
 *                    the wire contract -- see MIGRATION_NOTES.md)
 *  - create       -> INSERT ... RETURNING
 *  - createMany   -> multi-row INSERT
 *  - update       -> UPDATE ... RETURNING; an update that matches no row
 *                    throws RowNotFoundError (the case Prisma reported as P2025)
 *  - $transaction -> drizzle's db.transaction (the atomicity case)
 */
export class DrizzleBillingStore implements BillingStore {
  readonly account = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<AccountRow | null> => {
      const [row] = await this.db.select().from(account).where(eq(account.id, where.id)).limit(1);
      return row ?? null;
    },

    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { invoiceCount: { increment: number } };
    }): Promise<AccountRow> => {
      // Atomic increment in SQL (the old Prisma `increment: 1`), not a read-modify-write.
      const [row] = await this.db
        .update(account)
        .set({ invoiceCount: sql`${account.invoiceCount} + ${data.invoiceCount.increment}` })
        .where(eq(account.id, where.id))
        .returning();
      if (!row) throw new RowNotFoundError('account');
      return row;
    },
  };

  readonly invoice = {
    findUnique: async ({ where }: { where: { id: string } }): Promise<InvoiceRow | null> => {
      const [row] = await this.db.select().from(invoice).where(eq(invoice.id, where.id)).limit(1);
      return row ?? null;
    },

    findMany: async ({ where }: { where: { accountId: string } }): Promise<InvoiceRow[]> => {
      // No ORDER BY: the Prisma query had none and callers depend on storage order.
      return this.db.select().from(invoice).where(eq(invoice.accountId, where.accountId));
    },

    create: async ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow> => {
      const [row] = await this.db.insert(invoice).values(data).returning();
      return row;
    },

    update: async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow> => {
      const [row] = await this.db
        .update(invoice)
        .set(data)
        .where(eq(invoice.id, where.id))
        .returning();
      // Prisma threw P2025 when an update matched nothing; Drizzle simply
      // returns no row. Signal the same case so the service still maps it to
      // invoice_not_found instead of a generic 500.
      if (!row) throw new RowNotFoundError('invoice');
      return row;
    },
  };

  readonly invoiceLineItem = {
    findMany: async ({ where }: { where: { invoiceId: string } }): Promise<LineItemRow[]> => {
      // No ORDER BY: storage (insertion) order is the contract the API carries.
      return this.db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, where.invoiceId));
    },

    createMany: async ({ data }: { data: LineItemRow[] }): Promise<{ count: number }> => {
      if (data.length > 0) {
        await this.db.insert(invoiceLineItem).values(data);
      }
      return { count: data.length };
    },
  };

  constructor(private readonly db: BillingDb) {}

  async $transaction<T>(fn: (tx: BillingStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(new DrizzleBillingStore(tx as BillingDb)));
  }
}
