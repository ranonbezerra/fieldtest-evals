import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DRIZZLE, DatabaseModule } from '../src/database/database.module';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, invoices, line_items } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

describe('InvoiceService — transactional behavior', () => {
  let app: TestingModule;
  let service: InvoiceService;
  let db: PostgresJsDatabase;
  let rawConn: postgres.Sql;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [InvoiceRepository, AccountRepository, InvoiceService],
    }).compile();

    service = app.get(InvoiceService);
    db = app.get(DRIZZLE);
    rawConn = postgres(process.env.DATABASE_URL!);

    // Reusable trigger function for fault injection
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'test: injected failure';
      END;
      $fn$ LANGUAGE plpgsql
    `);

    // Trigger function that deletes the parent invoice (to induce FK violation on line_items)
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION test_delete_parent_invoice() RETURNS trigger AS $fn$
      BEGIN
        DELETE FROM invoices WHERE id = NEW.invoice_id;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DROP FUNCTION IF EXISTS test_injected_failure()`);
    await db.execute(sql`DROP FUNCTION IF EXISTS test_delete_parent_invoice()`);
    await rawConn.end();
    await app.close();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function createTestAccount(
    balanceCents: bigint = 100000n,
  ): Promise<{ id: string; balanceCents: bigint }> {
    const id = randomUUID();
    await db.execute(
      sql`INSERT INTO accounts (id, name, balance_cents, total_invoiced_cents)
          VALUES (${id}, 'test', ${balanceCents}, 0)`,
    );
    return { id, balanceCents };
  }

  async function cleanupAccount(accountId: string): Promise<void> {
    await db.execute(
      sql`DELETE FROM line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE account_id = ${accountId})`,
    );
    await db.execute(
      sql`DELETE FROM invoices WHERE account_id = ${accountId}`,
    );
    await db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`);
  }

  async function getAccountRow(accountId: string) {
    const rows = await db.execute(
      sql`SELECT balance_cents, total_invoiced_cents FROM accounts WHERE id = ${accountId}`,
    );
    return rows[0] as { balance_cents: bigint; total_invoiced_cents: bigint } | undefined;
  }

  async function getInvoiceCount(accountId: string): Promise<number> {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM invoices WHERE account_id = ${accountId}`,
    );
    return (rows[0] as { n: number }).n;
  }

  async function getLineItemCount(invoiceId: string): Promise<number> {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM line_items WHERE invoice_id = ${invoiceId}`,
    );
    return (rows[0] as { n: number }).n;
  }

  async function dropTriggerIfExists(name: string, table: string): Promise<void> {
    await db.execute(
      sql.unsafe(`DROP TRIGGER IF EXISTS ${name} ON ${table}`),
    );
  }

  // ─── Case 1: line-item insert failure → full rollback ─────────────────────

  it('rolls back the invoice row and account counters when line-item insert fails mid-transaction', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      await db.execute(sql`
        CREATE TRIGGER test_fail_line_items
        BEFORE INSERT ON line_items
        FOR EACH ROW
        EXECUTE FUNCTION test_injected_failure()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'item', amount_cents: '25000' }],
        }),
      ).rejects.toThrow();

      // No invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fail_line_items', 'line_items');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 2: account counter update failure → full rollback ──────────────

  it('rolls back invoice and line items when account counter update fails mid-transaction', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      await db.execute(sql`
        CREATE TRIGGER test_fail_account_update
        BEFORE UPDATE ON accounts
        FOR EACH ROW
        EXECUTE FUNCTION test_injected_failure()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'item', amount_cents: '15000' }],
        }),
      ).rejects.toThrow();

      // No invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(100000n);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fail_account_update', 'accounts');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 3: non-existent account → resource_not_found, no writes ────────

  it('throws resource_not_found for a non-existent account and performs no writes', async () => {
    const fakeId = randomUUID();

    await expect(
      service.create({
        account_id: fakeId,
        line_items: [{ description: 'item', amount_cents: '5000' }],
      }),
    ).rejects.toThrow(NotFoundException);

    // No invoice created for this (non-existent) account
    const invCount = await getInvoiceCount(fakeId);
    expect(invCount).toBe(0);
  });

  // ─── Case 4: happy-path commit ───────────────────────────────────────────

  it('commits invoice, line items, and correct counter deltas on success', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      const result = await service.create({
        account_id: accountId,
        line_items: [
          { description: 'widget', amount_cents: '18000' },
          { description: 'gadget', amount_cents: '12000' },
        ],
      });

      // Response shape
      expect(result.amount_cents).toBe('30000');
      expect(result.status).toBe('pending');
      expect(result.line_items).toHaveLength(2);

      // Invoice persisted with correct amount
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(1);

      // Line items persisted
      const liCount = await getLineItemCount(result.id);
      expect(liCount).toBe(2);

      // Account counters updated: balance decreased, total_invoiced increased
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(70000n);
      expect(acct!.total_invoiced_cents).toBe(30000n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 5: two concurrent creates → no lost update ─────────────────────

  it('preserves balance correctness under two concurrent creates for the same account', async () => {
    const { id: accountId } = await createTestAccount(100000n);

    try {
      const [res1, res2] = await Promise.all([
        service.create({
          account_id: accountId,
          line_items: [{ description: 'a', amount_cents: '30000' }],
        }),
        service.create({
          account_id: accountId,
          line_items: [{ description: 'b', amount_cents: '20000' }],
        }),
      ]);

      expect(res1.amount_cents).toBe('30000');
      expect(res2.amount_cents).toBe('20000');

      // Both invoices persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(2);

      // Final balance = 100000 - 30000 - 20000 = 50000
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(50000n);
      expect(acct!.total_invoiced_cents).toBe(50000n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 6: FK violation on line_items → rollback ───────────────────────

  it('rolls back the invoice when a DB-level FK constraint violation occurs on line_items insert', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      // Trigger deletes the parent invoice before the FK check on line_items runs,
      // causing a genuine FK constraint violation at the database level.
      await db.execute(sql`
        CREATE TRIGGER test_fk_violation
        BEFORE INSERT ON line_items
        FOR EACH ROW
        EXECUTE FUNCTION test_delete_parent_invoice()
      `);

      await expect(
        service.create({
          account_id: accountId,
          line_items: [{ description: 'orphan', amount_cents: '9999' }],
        }),
      ).rejects.toThrow();

      // Invoice rolled back despite the invoice insert succeeding before the trigger fired
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(0);

      // Account counters unchanged
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await dropTriggerIfExists('test_fk_violation', 'line_items');
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 7: concurrent reader sees no partial state ─────────────────────

  it('hides uncommitted invoice and line-item rows from a concurrent reader on a separate connection', async () => {
    const testInvoiceId = randomUUID();
    const testAccountId = randomUUID();

    try {
      // Open a transaction on the main connection and insert an invoice without committing
      await db.transaction(async (tx) => {
        await tx
          .insert(invoices)
          .values({
            id: testInvoiceId,
            account_id: testAccountId,
            amount_cents: '5000',
            status: 'pending',
          });

        // From a separate connection, the uncommitted row must be invisible (READ COMMITTED)
        const visible = await rawConn`
          SELECT 1 FROM invoices WHERE id = ${testInvoiceId}
        `;
        expect(visible).toHaveLength(0);

        // Insert a line item within the same uncommitted transaction
        await tx
          .insert(line_items)
          .values({
            id: randomUUID(),
            invoice_id: testInvoiceId,
            description: 'hidden',
            amount_cents: '5000',
          });

        const visibleLi = await rawConn`
          SELECT 1 FROM line_items WHERE invoice_id = ${testInvoiceId}
        `;
        expect(visibleLi).toHaveLength(0);

        // Roll back — nothing should persist
        throw new Error('intentional rollback');
      }).catch((e: Error) => {
        if (e.message !== 'intentional rollback') throw e;
      });

      // After rollback, the row does not exist on any connection
      const afterRb = await rawConn`
        SELECT 1 FROM invoices WHERE id = ${testInvoiceId}
      `;
      expect(afterRb).toHaveLength(0);
    } finally {
      // Clean up in case the transaction somehow committed (should not happen)
      await db.execute(
        sql`DELETE FROM line_items WHERE invoice_id = ${testInvoiceId}`,
      );
      await db.execute(
        sql`DELETE FROM invoices WHERE id = ${testInvoiceId}`,
      );
    }
  });

  // ─── Case 8: empty line_items reaches repository → atomic commit ─────────

  it('commits invoice and counter update atomically when line_items array is empty', async () => {
    const { id: accountId, balanceCents } = await createTestAccount(100000n);

    try {
      const result = await service.create({
        account_id: accountId,
        line_items: [],
      });

      // Invoice created with zero amount
      expect(result.amount_cents).toBe('0');
      expect(result.line_items).toEqual([]);

      // Invoice persisted
      const invCount = await getInvoiceCount(accountId);
      expect(invCount).toBe(1);

      // No line items
      const liCount = await getLineItemCount(result.id);
      expect(liCount).toBe(0);

      // Counters unchanged (delta = 0)
      const acct = await getAccountRow(accountId);
      expect(acct!.balance_cents).toBe(balanceCents);
      expect(acct!.total_invoiced_cents).toBe(0n);
    } finally {
      await cleanupAccount(accountId);
    }
  });

  // ─── Case 9: large bigint amounts serialised as strings ──────────────────

  it('serialises line-item amounts > 2³² as strings, not numbers', async () => {
    const { id: accountId } = await createTestAccount(10_000_000_000n);

    try {
      const largeAmount = '5000000000'; // 5 × 10⁹ > 2³² (4 294 967 295)

      const result = await service.create({
        account_id: accountId,
        line_items: [{ description: 'enterprise', amount_cents: largeAmount }],
      });

      // Invoice amount is a string
      expect(typeof result.amount_cents).toBe('string');
      expect(result.amount_cents).toBe(largeAmount);

      // Line-item amount is a string
      expect(typeof result.line_items[0].amount_cents).toBe('string');
      expect(result.line_items[0].amount_cents).toBe(largeAmount);

      // Verify in the database that the stored value round-trips correctly
      const rows = await db.execute(
        sql`SELECT amount_cents FROM line_items WHERE invoice_id = ${result.id}`,
      );
      const stored = rows[0] as { amount_cents: bigint };
      expect(stored.amount_cents).toBe(BigInt(largeAmount));
    } finally {
      await cleanupAccount(accountId);
    }
  });
});
