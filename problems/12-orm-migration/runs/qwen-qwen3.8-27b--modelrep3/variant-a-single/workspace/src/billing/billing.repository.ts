import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/db.client.js';
import { accounts, invoices, invoiceLineItems } from '../db/db.schema.js';
import type { AccountRow, InvoiceRow, LineItemRow } from '../db/db.schema.js';

export class BillingRepository {
  constructor(private readonly db: Db) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return row ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, id));
    return row ?? null;
  }

  /**
   * Deliberately no ORDER BY: the Prisma repository issued none, so callers
   * received rows in physical (insertion) order. Pinning that output is what
   * keeps the API byte-compatible -- see MIGRATION_NOTES.md.
   */
  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  /** No ORDER BY on purpose -- see findLineItems. */
  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.db.select().from(invoices).where(eq(invoices.accountId, accountId));
  }

  /**
   * The invoice, its line items and the account counter, atomically.
   * The counter is incremented in SQL (no read-modify-write race), the same
   * atomic effect as Prisma's `{ increment: 1 }`.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    return this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values(input.invoice).returning();
      if (input.lineItems.length > 0) {
        await tx.insert(invoiceLineItems).values(input.lineItems);
      }
      await tx
        .update(accounts)
        .set({ invoiceCount: sql`${accounts.invoiceCount} + 1` })
        .where(eq(accounts.id, input.invoice.accountId));
      return invoice;
    });
  }

  /**
   * Returns null when no invoice matches. Drizzle does not throw on a
   * 0-row update the way Prisma did (P2025); the service maps the null to
   * the same invoice_not_found error as before.
   */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow | null> {
    const [row] = await this.db
      .update(invoices)
      .set({ status: 'issued', issuedAt })
      .where(eq(invoices.id, id))
      .returning();
    return row ?? null;
  }
}
