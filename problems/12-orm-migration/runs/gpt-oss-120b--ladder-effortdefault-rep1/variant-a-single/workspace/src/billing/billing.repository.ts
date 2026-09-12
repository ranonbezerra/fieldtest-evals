import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns null when the account does not exist. Callers branch on that. */
  async findAccount(id: string): Promise<AccountRow | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    return this.prisma.invoice.findUnique({ where: { id } });
  }

  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.prisma.invoiceLineItem.findMany({ where: { invoiceId } });
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.prisma.invoice.findMany({ where: { accountId } });
  }

  /**
   * Invoice, its line items and the account counter, atomically.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    return this.prisma.$transaction(async (tx) => {
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

  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
    return this.prisma.invoice.update({
      where: { id },
      data: { status: 'issued', issuedAt },
    });
  }
}
