import { asc, eq, sql } from 'drizzle-orm';
import { NotFoundError, mapDbError } from '../common/errors.js';
import type { Db } from './db.js';
import {
  accounts,
  invoiceLineItems,
  invoices,
  type AccountRow,
  type InvoiceRow,
  type LineItemRow,
} from './schema.js';

export interface CreateInvoiceInput {
  invoice: Omit<InvoiceRow, 'createdAt'>;
  lineItems: LineItemRow[];
}

export class BillingRepository {
  constructor(private readonly db: Db) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Line items in `position` order. The Prisma query had no ORDER BY, which
   * left the row order to the database (storage order in the seed data: 3, 1,
   * 2); callers render line items in the order the API returns, so the stable
   * contract is position order. See MIGRATION_NOTES.md.
   */
  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceLineItems.position));
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.db.select().from(invoices).where(eq(invoices.accountId, accountId));
  }

  /**
   * The invoice, its line items and the account counter, atomically.
   */
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceRow> {
    try {
      return await this.db.transaction(async (tx) => {
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
    } catch (e) {
      throw mapDbError(e);
    }
  }

  /**
   * Prisma used to throw P2025 when an update matched nothing; Drizzle
   * resolves with zero rows instead. Keep the old contract: a missing invoice
   * is a NotFoundError, not an empty result.
   */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
    const rows = await this.db
      .update(invoices)
      .set({ status: 'issued', issuedAt })
      .where(eq(invoices.id, id))
      .returning();
    if (rows.length === 0) throw new NotFoundError('invoice_not_found');
    return rows[0];
  }
}
