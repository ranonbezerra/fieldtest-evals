import { eq, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { accounts, invoiceLineItems, invoices } from './schema.js';
import type { AccountRow, InvoiceRow, LineItemRow } from './schema.js';

export class BillingRepository {
  constructor(private readonly db: Db) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return rows[0] ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id));
    return rows[0] ?? null;
  }

  // No ORDER BY, exactly like the old findMany: callers get storage order.
  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.db.select().from(invoices).where(eq(invoices.accountId, accountId));
  }

  /**
   * Invoice, its line items and the account counter, atomically.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    return this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values(input.invoice).returning();
      if (input.lineItems.length > 0) {
        // Drizzle's insert().values([]) throws where Prisma's createMany no-op'd,
        // so the guard is preserved.
        await tx.insert(invoiceLineItems).values(input.lineItems);
      }
      await tx.update(accounts)
        .set({ invoiceCount: sql`invoice_count + 1` })
        .where(eq(accounts.id, input.invoice.accountId));
      return invoice;
    });
  }

  /**
   * Returns null when the invoice does not exist: Drizzle's update resolves
   * with an empty array instead of throwing Prisma's P2025. Callers convert
   * null into the same public error they got before.
   */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow | null> {
    const rows = await this.db
      .update(invoices)
      .set({ status: 'issued', issuedAt })
      .where(eq(invoices.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
