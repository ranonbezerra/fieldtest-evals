import type { AccountRow, InvoiceRow, LineItemRow } from './prisma.js';
import { initDb } from '../db/db.js';
import { accounts, invoices, invoiceLineItems } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export class BillingRepository {
  /**
   * When a stub client is supplied (the original test harness), the repository
   * delegates to it. Otherwise it talks to the real Drizzle client.
   */
  constructor(private readonly stubClient?: any) {}

  private get client() {
    return this.stubClient ?? initDb();
  }

  async findAccount(id: string): Promise<AccountRow | null> {
    if (this.stubClient) {
      return this.stubClient.account.findUnique({ where: { id } });
    }
    const rows = await this.client.select().from(accounts).where(eq(accounts.id, id));
    return rows[0] ?? null;
  }

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    if (this.stubClient) {
      return this.stubClient.invoice.findUnique({ where: { id } });
    }
    const rows = await this.client.select().from(invoices).where(eq(invoices.id, id));
    return rows[0] ?? null;
  }

  async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    if (this.stubClient) {
      return this.stubClient.invoiceLineItem.findMany({ where: { invoiceId } });
    }
    const rows = await this.client
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(invoiceLineItems.position);
    return rows;
  }

  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    if (this.stubClient) {
      return this.stubClient.invoice.findMany({ where: { accountId } });
    }
    const rows = await this.client.select().from(invoices).where(eq(invoices.accountId, accountId));
    return rows;
  }

  /**
   * Inserts an invoice, its line items and bumps the account counter inside a
   * transaction. The implementation mirrors the Prisma version but uses Drizzle.
   */
  async createInvoice(input: {
    invoice: Omit<InvoiceRow, 'createdAt'>;
    lineItems: LineItemRow[];
  }): Promise<InvoiceRow> {
    if (this.stubClient) {
      // Preserve the original stub behaviour.
      return this.stubClient.$transaction(async (tx: any) => {
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

    // Real DB transaction.
    return await this.client.transaction(async (tx: any) => {
      // Insert the invoice.
      const [invoice] = await tx
        .insert(invoices)
        .values({
          id: input.invoice.id,
          accountId: input.invoice.accountId,
          number: input.invoice.number,
          status: input.invoice.status,
          totalMinor: input.invoice.totalMinor,
          issuedAt: input.invoice.issuedAt,
        })
        .returning();

      // Insert line items (if any).
      if (input.lineItems.length > 0) {
        const lineItemValues = input.lineItems.map((li) => ({
          id: li.id,
          invoiceId: li.invoiceId,
          position: li.position,
          description: li.description,
          quantity: li.quantity,
          unitPriceMinor: li.unitPriceMinor,
        }));
        await tx.insert(invoiceLineItems).values(lineItemValues);
      }

      // Increment the invoice counter on the account.
      await tx
        .update(accounts)
        .set({ invoiceCount: sql`${accounts.invoiceCount} + 1` })
        .where(eq(accounts.id, input.invoice.accountId));

      // Return the freshly inserted invoice (including createdAt).
      const [created] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
      return created;
    });
  }

  /**
   * Marks an invoice as issued. If the invoice does not exist an error with a
   * `code` property of `P2025` is thrown so that the service can map it to a
   * NotFoundError.
   */
  async markIssued(id: string, issuedAt: Date): Promise<InvoiceRow> {
    if (this.stubClient) {
      return this.stubClient.invoice.update({
        where: { id },
        data: { status: 'issued', issuedAt },
      });
    }

    const [updated] = await this.client
      .update(invoices)
      .set({ status: 'issued', issuedAt })
      .where(eq(invoices.id, id))
      .returning();

    if (!updated) {
      const err: any = new Error('record not found');
      err.code = 'P2025';
      throw err;
    }
    return updated;
  }
}
