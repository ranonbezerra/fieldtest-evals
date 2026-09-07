import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DatabaseModule, DB } from '../src/db/database.module.js';
import type { DrizzleDb } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { accounts, invoices, lineItems } from '../src/db/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { InvoicesRepository } from '../src/invoices/invoices.repository.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('transaction-failure', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [AccountsRepository, InvoicesRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rolls back invoice on line-item insert failure', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);

    const accountId = randomUUID();
    const invoiceId = randomUUID();
    const lineItemId = randomUUID();

    await acctRepo.create({
      id: accountId,
      name: 'Tx Rollback Account',
      email: `tx-rollback-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 1000n,
    });

    // quantity: 0 violates the CHECK (quantity > 0) constraint,
    // causing the line_items INSERT to fail mid-transaction.
    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: accountId,
          status: 'draft',
          subtotal_cents: 5000n,
          tax_cents: 500n,
          total_cents: 5500n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Triggers CHECK violation',
            unit_price_cents: 2500n,
            quantity: 0,
            line_total_cents: 5000n,
          },
        ],
      }),
    ).rejects.toThrow();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();

    // Account counters must be unchanged
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.total_invoiced_cents).toBe(1000n);
    expect(account.balance_cents).toBe(50000n);
  });

  // ASSUMPTION: Drizzle's node-postgres driver obtains a dedicated pg.Client
  // via pool.connect() for transactions; intercepting at that level lets us
  // simulate the "account vanished between INSERT and UPDATE" race.
  it('rolls back when account row missing', async () => {
    const acctRepo = app.get(AccountsRepository);
    const invRepo = app.get(InvoicesRepository);

    const accountId = randomUUID();
    const invoiceId = randomUUID();
    const lineItemId = randomUUID();

    await acctRepo.create({
      id: accountId,
      name: 'Tx Vanish Account',
      email: `tx-vanish-${accountId}@example.com`,
      credit_limit_cents: 100000n,
      balance_cents: 50000n,
      total_invoiced_cents: 1000n,
    });

    const pool = (db as any).session.client;
    const originalConnect = pool.connect.bind(pool);

    vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      (client as any).query = (...args: any[]) => {
        const sqlText = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.text;
        if (sqlText && /UPDATE\s+"?accounts"?/i.test(sqlText)) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return originalQuery(...args);
      };
      return client;
    });

    await expect(
      invRepo.createWithLineItems({
        invoice: {
          id: invoiceId,
          account_id: accountId,
          status: 'draft',
          subtotal_cents: 3000n,
          tax_cents: 300n,
          total_cents: 3300n,
        },
        lineItems: [
          {
            id: lineItemId,
            invoice_id: invoiceId,
            description: 'Should roll back',
            unit_price_cents: 1500n,
            quantity: 2,
            line_total_cents: 3000n,
          },
        ],
      }),
    ).rejects.toThrow();

    vi.restoreAllMocks();

    // No invoice should have been persisted
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice).toBeUndefined();

    // No line items should have been persisted
    const [lineItem] = await db.select().from(lineItems).where(eq(lineItems.id, lineItemId));
    expect(lineItem).toBeUndefined();

    // Account counters unchanged (UPDATE was intercepted, ROLLBACK undid the INSERTs)
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.total_invoiced_cents).toBe(1000n);
    expect(account.balance_cents).toBe(50000n);
  });
});
