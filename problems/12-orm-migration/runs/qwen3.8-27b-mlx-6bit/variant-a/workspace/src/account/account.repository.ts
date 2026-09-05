import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { accounts } from '../../drizzle/schema.js';

export interface AccountRow {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: Date;
  updated_at: Date;
}

function toAccountRow(row: {
  id: string;
  name: string;
  balanceCents: bigint;
  totalInvoicedCents: bigint;
  createdAt: Date;
  updatedAt: Date;
}): AccountRow {
  return {
    id: row.id,
    name: row.name,
    balance_cents: String(row.balanceCents),
    total_invoiced_cents: String(row.totalInvoicedCents),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export class AccountRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return toAccountRow(rows[0]);
  }

  async create(data: { name: string }): Promise<AccountRow> {
    const result = await this.db
      .insert(accounts)
      .values({ name: data.name })
      .returning();
    return toAccountRow(result[0]);
  }

  async updateCounters(
    id: string,
    deltaBalance: bigint,
    deltaInvoiced: bigint,
  ): Promise<AccountRow | null> {
    const result = await this.db
      .update(accounts)
      .set({
        balanceCents: sql`${accounts.balanceCents} + ${deltaBalance}`,
        totalInvoicedCents: sql`${accounts.totalInvoicedCents} + ${deltaInvoiced}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id))
      .returning();
    if (result.length === 0) return null;
    return toAccountRow(result[0]);
  }
}
