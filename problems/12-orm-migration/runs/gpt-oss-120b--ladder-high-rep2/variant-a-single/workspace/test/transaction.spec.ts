import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DrizzleAdapter } from '../src/billing/drizzleAdapter.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import { seed } from '../prisma/seed.js';
import { db, pool } from '../src/database.js';
import { accounts, invoices, invoiceLineItems } from '../src/db/schema.js';
import { sql } from 'drizzle-orm';

describe('Transactional behavior', () => {
  const adapter = new DrizzleAdapter();
  let repo: BillingRepository;
  let service: BillingService;

  beforeAll(async () => {
    // Clean any existing tables
    await db.execute(sql`DROP TABLE IF EXISTS invoice_line_items CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS invoices CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS accounts CASCADE`);

    // Re‑create tables (same as migration)
    await db.execute(sql`
      CREATE TABLE accounts (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        currency CHAR(3) NOT NULL,
        invoice_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE invoices (
        id UUID PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft',
        total_minor BIGINT NOT NULL,
        issued_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE invoice_line_items (
        id UUID PRIMARY KEY,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_minor BIGINT NOT NULL
      );
      CREATE INDEX invoices_account_id_idx ON invoices(account_id);
      CREATE INDEX invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);
    `);

    // Seed initial data
    await db.insert(accounts).values(seed.accounts);
    await db.insert(invoices).values(
      seed.invoices.map((i) => ({
        ...i,
        // created_at uses default now()
      })),
    );
    await db.insert(invoiceLineItems).values(seed.lineItems);

    repo = new BillingRepository(adapter);
    service = new BillingService(repo);
  });

  afterAll(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS invoice_line_items CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS invoices CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS accounts CASCADE`);
    await pool.end();
  });

  it('rolls back when inserting duplicate line‑item primary key', async () => {
    const newInvoice = {
      id: 'cccccccc-0000-4000-8000-000000000003',
      accountId: seed.accounts[0].id,
      number: 'INV-2024-0003',
      status: 'draft',
      totalMinor: 1000n,
      issuedAt: null,
    };

    const lineItems = [
      {
        id: seed.lineItems[0].id, // duplicate PK → trigger failure
        invoiceId: newInvoice.id,
        position: 1,
        description: 'Duplicate line item',
        quantity: 1,
        unitPriceMinor: 1000n,
      },
    ];

    await expect(repo.createInvoice({ invoice: newInvoice, lineItems })).rejects.toThrow();

    // Invoice must not exist
    const inv = await repo.findInvoice(newInvoice.id);
    expect(inv).toBeNull();

    // Account counter must be unchanged
    const acct = await repo.findAccount(seed.accounts[0].id);
    expect(acct?.invoiceCount).toBe(seed.accounts[0].invoiceCount);

    // No line items should have been created
    const items = await repo.findLineItems(newInvoice.id);
    expect(items).toHaveLength(0);
  });
});
