import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import { DRIZZLE } from '../src/database/database.module';
import { accounts, lineItems } from '../../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// ASSUMPTION: A Postgres test database is available via DATABASE_URL and the
// DRIZZLE provider resolves to a live connection at module-compile time.
// Verification reads (findByAccount, findById) hit this real database; only the
// specific failing operation inside the transaction is intercepted via a spy.

describe('InvoiceService — transaction atomicity', () => {
  let service: InvoiceService;
  let invoiceRepo: InvoiceRepository;
  let accountRepo: AccountRepository;
  let db: PostgresJsDatabase;

  let accountId: string;
  let originalBalance: string;
  let originalTotalInvoiced: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvoiceService, InvoiceRepository, AccountRepository],
    }).compile();

    service = module.get(InvoiceService);
    invoiceRepo = module.get(InvoiceRepository);
    accountRepo = module.get(AccountRepository);
    db = module.get(DRIZZLE);

    const account = await accountRepo.create({ name: 'atomicity-test' });
    accountId = account.id;
    originalBalance = account.balance_cents;
    originalTotalInvoiced = account.total_invoiced_cents;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rolls back invoice and account counters when line-item insert fails mid-transaction', async () => {
    // Intercept tx.insert so that inserts targeting the lineItems table throw,
    // while inserts targeting other tables (e.g. invoices) proceed normally.
    // This simulates a DB error occurring after the invoice row is written but
    // before the transaction commits.
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
      const callback = args[0] as (tx: unknown) => Promise<unknown>;
      return originalTransaction(async (tx: any) => {
        const originalInsert = tx.insert.bind(tx);
        tx.insert = (table: any) => {
          if (table === lineItems) {
            throw new Error('injected: line_items insert failure');
          }
          return originalInsert(table);
        };
        return callback(tx);
      });
    }) as any);

    const body = {
      account_id: accountId,
      line_items: [{ description: 'Widget', amount_cents: '500' }],
    };

    await expect(service.create(body)).rejects.toThrow('injected: line_items insert failure');

    // No orphan invoice should be visible after rollback.
    const invoices = await invoiceRepo.findByAccount(accountId, 1, 100);
    expect(invoices).toEqual([]);

    // Account counters must be unchanged.
    const account = await accountRepo.findById(accountId);
    expect(account).not.toBe(null);
    // ASSUMPTION: account is non-null (created in beforeEach), so property access below is safe.
    expect(account!.balance_cents).toBe(originalBalance);
    expect(account!.total_invoiced_cents).toBe(originalTotalInvoiced);
  });

  it('rolls back invoice and line items when account counter update fails mid-transaction', async () => {
    // Intercept tx.update so that updates targeting the accounts table throw,
    // while inserts (invoice + line items) proceed normally within the same
    // transaction. Proves rollback from the "far end" of the write sequence.
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
      const callback = args[0] as (tx: unknown) => Promise<unknown>;
      return originalTransaction(async (tx: any) => {
        const originalUpdate = tx.update.bind(tx);
        tx.update = (table: any) => {
          if (table === accounts) {
            throw new Error('injected: accounts update failure');
          }
          return originalUpdate(table);
        };
        return callback(tx);
      });
    }) as any);

    const body = {
      account_id: accountId,
      line_items: [{ description: 'Widget', amount_cents: '500' }],
    };

    await expect(service.create(body)).rejects.toThrow('injected: accounts update failure');

    // No invoice (and therefore no line items) should be visible after rollback.
    const invoices = await invoiceRepo.findByAccount(accountId, 1, 100);
    expect(invoices).toEqual([]);

    // Account counters must be unchanged.
    const account = await accountRepo.findById(accountId);
    expect(account).not.toBe(null);
    expect(account!.balance_cents).toBe(originalBalance);
    expect(account!.total_invoiced_cents).toBe(originalTotalInvoiced);
  });
});
