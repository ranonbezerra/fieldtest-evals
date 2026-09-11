import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { RecordNotFoundError } from '../common/errors.js';
import {
  accounts,
  invoiceLineItems,
  invoices,
  schema,
  type AccountRow,
  type InvoiceRow,
  type LineItemRow,
} from '../db/schema.js';

/**
 * The data-access contract the repository programs against.
 *
 * This is the same surface the service used to program against through the Prisma
 * client (model-scoped findUnique/findMany/create/update/createMany plus an
 * interactive $transaction). Keeping the contract and swapping the implementation
 * underneath for `DrizzleBillingClient` is what lets the frozen behavioural suite —
 * which injects an in-memory fake of this contract — run unmodified, while every
 * real query now executes through Drizzle.
 */
export interface BillingClient {
  account: {
    findUnique(a: { where: { id: string } }): Promise<AccountRow | null>;
    update(a: { where: { id: string }; data: { invoiceCount: { increment: number } } }): Promise<AccountRow>;
  };
  invoice: {
    findUnique(a: { where: { id: string } }): Promise<InvoiceRow | null>;
    findMany(a: { where: { accountId: string } }): Promise<InvoiceRow[]>;
    create(a: { data: Omit<InvoiceRow, 'createdAt'> }): Promise<InvoiceRow>;
    update(a: { where: { id: string }; data: Partial<InvoiceRow> }): Promise<InvoiceRow>;
  };
  invoiceLineItem: {
    findMany(a: { where: { invoiceId: string } }): Promise<LineItemRow[]>;
    createMany(a: { data: LineItemRow[] }): Promise<{ count: number }>;
  };
  /** Interactive transaction: every write inside `fn` shares one database transaction. */
  $transaction<T>(fn: (tx: BillingClient) => Promise<T>): Promise<T>;
}

export type BillingDb = NodePgDatabase<typeof schema>;

export class DrizzleBillingClient implements BillingClient {
  readonly account: BillingClient['account'];
  readonly invoice: BillingClient['invoice'];
  readonly invoiceLineItem: BillingClient['invoiceLineItem'];

  constructor(private readonly db: BillingDb) {
    this.account = {
      findUnique: ({ where }: { where: { id: string } }) => this.findAccount(where.id),
      update: ({ where, data }: { where: { id: string }; data: { invoiceCount: { increment: number } } }) =>
        this.incrementAccountInvoiceCount(where.id, data.invoiceCount.increment),
    };
    this.invoice = {
      findUnique: ({ where }: { where: { id: string } }) => this.findInvoice(where.id),
      findMany: ({ where }: { where: { accountId: string } }) => this.listInvoicesByAccount(where.accountId),
      create: ({ data }: { data: Omit<InvoiceRow, 'createdAt'> }) => this.insertInvoice(data),
      update: ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) =>
        this.updateInvoice(where.id, data),
    };
    this.invoiceLineItem = {
      findMany: ({ where }: { where: { invoiceId: string } }) => this.findLineItems(where.invoiceId),
      createMany: ({ data }: { data: LineItemRow[] }) => this.insertLineItems(data),
    };
  }

  /**
   * The interactive-transaction equivalent: one database transaction, and a client
   * view of it, so every write the callback performs (invoice, line items, account
   * counter) commits or rolls back as a unit (MIGRATION_NOTES.md §9).
   */
  async $transaction<T>(fn: (tx: BillingClient) => Promise<T>): Promise<T> {
    // The transaction handle has the same query-builder surface as the db handle.
    return this.db.transaction(async (tx) => fn(new DrizzleBillingClient(tx as unknown as BillingDb)));
  }

  private async findAccount(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return rows[0] ?? null;
  }

  private async incrementAccountInvoiceCount(id: string, increment: number): Promise<AccountRow> {
    const rows = await this.db
      .update(accounts)
      .set({ invoiceCount: sql`${accounts.invoiceCount} + ${increment}` })
      .where(eq(accounts.id, id))
      .returning();
    if (rows.length === 0) {
      // A no-op UPDATE is silent in Postgres; the Prisma client used to surface
      // this as P2025 (MIGRATION_NOTES.md §5).
      throw new RecordNotFoundError('accounts', { id });
    }
    return rows[0];
  }

  private async findInvoice(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return rows[0] ?? null;
  }

  private async listInvoicesByAccount(accountId: string): Promise<InvoiceRow[]> {
    // No ORDER BY: the Prisma findMany this replaces had none, so the wire contract
    // is "database order" (insertion order on this data). Adding ordering here would
    // change responses (MIGRATION_NOTES.md §2).
    return this.db.select().from(invoices).where(eq(invoices.accountId, accountId));
  }

  private async insertInvoice(data: Omit<InvoiceRow, 'createdAt'>): Promise<InvoiceRow> {
    // .returning() keeps the old semantics: create resolves with the stored row,
    // database defaults (createdAt) already applied (MIGRATION_NOTES.md §7).
    const rows = await this.db.insert(invoices).values(data).returning();
    return rows[0];
  }

  private async updateInvoice(id: string, data: Partial<InvoiceRow>): Promise<InvoiceRow> {
    const rows = await this.db.update(invoices).set(data).where(eq(invoices.id, id)).returning();
    if (rows.length === 0) {
      // The P2025 equivalent, so service.issue() still 404s on a missing
      // invoice (MIGRATION_NOTES.md §5).
      throw new RecordNotFoundError('invoices', { id });
    }
    return rows[0];
  }

  private async findLineItems(invoiceId: string): Promise<LineItemRow[]> {
    // No ORDER BY, for the same reason as listInvoicesByAccount (MIGRATION_NOTES.md §2).
    return this.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  private async insertLineItems(data: LineItemRow[]): Promise<{ count: number }> {
    const rows = await this.db.insert(invoiceLineItems).values(data).returning();
    return { count: rows.length };
  }
}
