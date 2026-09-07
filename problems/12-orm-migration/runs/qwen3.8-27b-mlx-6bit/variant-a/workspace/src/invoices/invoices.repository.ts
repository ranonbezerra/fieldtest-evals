import { Injectable, Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { accounts, invoices, lineItems } from '../db/schema.js';
import type { InvoiceRow, InvoiceWithLineItems, InvoiceInsert, LineItemInsert } from '../db/schema.js';

export interface CreateInvoiceTxArgs {
  invoice: InvoiceInsert;
  lineItems: LineItemInsert[];
}

@Injectable()
export class InvoicesRepository {
  constructor(@Inject(DB) private db: DrizzleDb) {}

  async findById(id: string): Promise<InvoiceWithLineItems | null> {
    const [invoice] = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);

    if (!invoice) return null;

    const items = await this.db
      .select()
      .from(lineItems)
      .where(eq(lineItems.invoiceId, id));

    return { ...invoice, line_items: items };
  }

  async findAllByAccount(accountId: string): Promise<InvoiceRow[]> {
    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.accountId, accountId));
  }

  async createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow> {
    return this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values(args.invoice).returning();

      if (args.lineItems.length > 0) {
        const items = args.lineItems.map((item) => ({ ...item, invoiceId: invoice.id }));
        await tx.insert(lineItems).values(items);
      }

      const updated = await tx
        .update(accounts)
        .set({
          totalInvoicedCents: sql`${accounts.totalInvoicedCents} + ${args.invoice.totalCents}`,
          balanceCents: sql`${accounts.balanceCents} - ${args.invoice.totalCents}`,
        })
        .where(eq(accounts.id, args.invoice.accountId))
        .returning();

      if (updated.length === 0) {
        throw new Error(`Account ${args.invoice.accountId} not found`);
      }

      return invoice;
    });
  }

  async updateStatus(id: string, status: string): Promise<InvoiceRow | null> {
    const [updated] = await this.db
      .update(invoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();

    return updated ?? null;
  }
}
