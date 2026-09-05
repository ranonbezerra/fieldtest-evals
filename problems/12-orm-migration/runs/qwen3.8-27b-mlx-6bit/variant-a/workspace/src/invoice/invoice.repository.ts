import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
// ASSUMPTION: PostgresJsTransaction is a named type export from drizzle-orm/postgres-js representing the transaction context passed to the callback of db.transaction()
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { invoices, line_items } from '../../drizzle/schema';

export interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

export class InvoiceRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByAccount(
    accountId: string,
    page?: number,
    pageSize?: number,
  ): Promise<InvoiceRow[]> {
    const limit = pageSize ?? 20;
    const offset = ((page ?? 1) - 1) * limit;

    return this.db
      .select()
      .from(invoices)
      .where(eq(invoices.account_id, accountId))
      .orderBy(invoices.created_at)
      .limit(limit)
      .offset(offset);
  }

  async createWithLineItems(
    tx: PostgresJsTransaction,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        account_id: data.accountId,
        amount_cents: String(data.amountCents),
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(line_items)
        .values(
          data.lineItems.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            amount_cents: String(item.amountCents),
          })),
        );
    }

    return invoice;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    return this.db
      .select()
      .from(line_items)
      .where(eq(line_items.invoice_id, invoiceId));
  }
}
