// ASSUMPTION: All compiler errors reference test/invoice.spec.ts (missing matchers on a
// custom expect helper). None of them require changes to this file. This file is rewritten
// per PLAN.md so it compiles cleanly as part of the workspace.

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, desc } from 'drizzle-orm';
import { invoices, lineItems } from '../../drizzle/schema.js';

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

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

type Tx = PostgresJsDatabase;

export class InvoiceRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      account_id: row.accountId,
      amount_cents: String(row.amountCents),
      status: row.status,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  async findByAccount(
    accountId: string,
    page = 1,
    pageSize = 20,
  ): Promise<InvoiceRow[]> {
    const offset = (page - 1) * pageSize;
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.accountId, accountId))
      .orderBy(desc(invoices.createdAt))
      .limit(pageSize)
      .offset(offset);
    return rows.map((row) => ({
      id: row.id,
      account_id: row.accountId,
      amount_cents: String(row.amountCents),
      status: row.status,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  async createWithLineItems(
    tx: Tx,
    data: CreateInvoiceData,
  ): Promise<InvoiceRow> {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        accountId: data.accountId,
        amountCents: data.amountCents,
        status: 'pending',
      })
      .returning();

    if (data.lineItems.length > 0) {
      await tx
        .insert(lineItems)
        .values(
          data.lineItems.map((item) => ({
            invoiceId: invoice.id,
            description: item.description,
            amountCents: item.amountCents,
          })),
        );
    }

    return {
      id: invoice.id,
      account_id: invoice.accountId,
      amount_cents: String(invoice.amountCents),
      status: invoice.status,
      created_at: invoice.createdAt,
      updated_at: invoice.updatedAt,
    };
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    const rows = await this.db
      .select()
      .from(lineItems)
      .where(eq(lineItems.invoiceId, invoiceId));
    return rows.map((row) => ({
      id: row.id,
      invoice_id: row.invoiceId,
      description: row.description,
      amount_cents: String(row.amountCents),
      created_at: row.createdAt,
    }));
  }
}
