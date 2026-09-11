import { eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { RowNotFoundError } from '../common/errors.js';
import type { BillingClient, Tx } from './client.js';
import * as schema from './schema.js';
import { accounts, invoices, invoiceLineItems } from './schema.js';

type Db = PgDatabase<any>;

/**
 * The Drizzle-backed data client: the only place in the codebase that talks
 * to the database. Implements BillingClient so the service/repository layers
 * (and the test fakes) are unchanged.
 *
 * Deliberate choices (see MIGRATION_NOTES.md):
 * - no .orderBy() anywhere the old queries had none; storage order is part of
 *   the observed wire contract;
 * - an update that matches no row raises RowNotFoundError, because zero-row
 *   updates do not throw in Drizzle but the old 404 behaviour is part of the
 *   contract.
 */
export class DrizzleClient implements BillingClient {
  constructor(private readonly db: Db) {}

  readonly account: BillingClient['account'] = {
    findUnique: async ({ where }) => {
      const rows = await this.db.select().from(accounts).where(eq(accounts.id, where.id));
      return rows[0] ?? null;
    },
    update: async ({ where, data }) => {
      const rows = await this.db
        .update(accounts)
        .set({ invoiceCount: sql`${accounts.invoiceCount} + ${data.invoiceCount.increment}` })
        .where(eq(accounts.id, where.id))
        .returning();
      if (rows.length === 0) throw new RowNotFoundError('account');
      return rows[0];
    },
  };

  readonly invoice: BillingClient['invoice'] = {
    findUnique: async ({ where }) => {
      const rows = await this.db.select().from(invoices).where(eq(invoices.id, where.id));
      return rows[0] ?? null;
    },
    findMany: async ({ where }) => {
      return this.db.select().from(invoices).where(eq(invoices.accountId, where.accountId));
    },
    create: async ({ data }) => {
      const rows = await this.db.insert(invoices).values(data).returning();
      return rows[0];
    },
    update: async ({ where, data }) => {
      const set: Partial<typeof invoices.$inferInsert> = {};
      if (data.accountId !== undefined) set.accountId = data.accountId;
      if (data.number !== undefined) set.number = data.number;
      if (data.status !== undefined) set.status = data.status;
      if (data.totalMinor !== undefined) set.totalMinor = data.totalMinor;
      if (data.issuedAt !== undefined) set.issuedAt = data.issuedAt;
      if (data.createdAt !== undefined) set.createdAt = data.createdAt;
      const rows = await this.db
        .update(invoices)
        .set(set)
        .where(eq(invoices.id, where.id))
        .returning();
      if (rows.length === 0) throw new RowNotFoundError('invoice');
      return rows[0];
    },
  };

  readonly invoiceLineItem: BillingClient['invoiceLineItem'] = {
    findMany: async ({ where }) => {
      return this.db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, where.invoiceId));
    },
    createMany: async ({ data }) => {
      if (data.length === 0) return { count: 0 };
      const rows = await this.db.insert(invoiceLineItems).values(data).returning();
      return { count: rows.length };
    },
  };

  async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const inner: Tx = {
        invoice: {
          create: async ({ data }) => {
            const rows = await tx.insert(invoices).values(data).returning();
            return rows[0];
          },
        },
        invoiceLineItem: {
          createMany: async ({ data }) => {
            if (data.length === 0) return { count: 0 };
            const rows = await tx.insert(invoiceLineItems).values(data).returning();
            return { count: rows.length };
          },
        },
        account: {
          update: async ({ where, data }) => {
            const rows = await tx
              .update(accounts)
              .set({ invoiceCount: sql`${accounts.invoiceCount} + ${data.invoiceCount.increment}` })
              .where(eq(accounts.id, where.id))
              .returning();
            if (rows.length === 0) throw new RowNotFoundError('account');
            return rows[0];
          },
        },
      };
      return fn(inner);
    });
  }
}
