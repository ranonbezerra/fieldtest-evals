import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import type { AccountRow, InvoiceRow, LineItemRow } from '../db/schema.js';

/** The Drizzle instance the repository runs against (constructor-injected). */
export type BillingDb = PostgresJsDatabase<typeof schema>;

export class BillingRepository {
  constructor(private readonly db: BillingDb) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    const [row] = await this.db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).limit(1);
    return row ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    const [row] = await this.db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    return row ?? null;
  }

  /**
   * Deliberately has no ORDER BY: the Prisma query had none either, and
   * callers rely on the database's natural (insertion) order -- the seed
   * inserts line items out of position order on purpose. See
   * MIGRATION_NOTES.md before adding an orderBy here.
   */
  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return await this.db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, invoiceId));
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return await this.db.select().from(schema.invoices).where(eq(schema.invoices.accountId, accountId));
  }

  /**
   * Invoice, its line items and the account counter, atomically.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    return await this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(schema.invoices).values(input.invoice).returning();
      // Prisma skipped createMany on an empty list; Drizzle's .values([]) is
      // not a no-op, so the guard is preserved.
      if (input.lineItems.length > 0) {
        await tx.insert(schema.invoiceLineItems).values(input.lineItems);
      }
      await tx
        .update(schema.accounts)
        .set({ invoiceCount: sql`${schema.accounts.invoiceCount} + 1` })
        .where(eq(schema.accounts.id, input.invoice.accountId));
      return invoice;
    });
  }

  /**
   * Returns null when no invoice matched. Prisma threw P2025 here; Drizzle
   * resolves an unmatched update with an empty result instead, so the
   * "not found" decision moved to the caller (the service).
   */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow | null> {
    const rows = await this.db
      .update(schema.invoices)
      .set({ status: 'issued', issuedAt })
      .where(eq(schema.invoices.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
