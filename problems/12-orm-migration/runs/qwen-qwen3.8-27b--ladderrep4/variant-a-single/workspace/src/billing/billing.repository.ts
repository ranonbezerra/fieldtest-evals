import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';

/**
 * Talks to the data-access seam (`PrismaClient`), implemented by
 * `DrizzleBillingClient` in production. The repository owns the query
 * semantics (which rows, in which order, atomically or not); see
 * MIGRATION_NOTES.md for the preserved wire-format behaviours.
 */
export class BillingRepository {
  constructor(private readonly client: PrismaClient) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    return this.client.account.findUnique({ where: { id } });
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    return this.client.invoice.findUnique({ where: { id } });
  }

  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.client.invoiceLineItem.findMany({ where: { invoiceId } });
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.client.invoice.findMany({ where: { accountId } });
  }

  /**
   * Invoice, its line items and the account counter, atomically. Every
   * write happens inside the single transaction the client opens.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    return this.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({ data: input.invoice });
      if (input.lineItems.length > 0) {
        await tx.invoiceLineItem.createMany({ data: input.lineItems });
      }
      await tx.account.update({
        where: { id: input.invoice.accountId },
        data: { invoiceCount: { increment: 1 } },
      });
      return invoice;
    });
  }

  /** Resolves to null when no invoice matches, so callers can 404. */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow | null> {
    return this.client.invoice.update({ where: { id }, data: { status: 'issued', issuedAt } });
  }
}
