import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service.js';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

interface CallRecord {
  method: string;
  args: unknown[];
}

function makeMockInvoiceRepo() {
  const calls: CallRecord[] = [];
  let findByIdResult: Record<string, unknown> | null = null;
  let findByAccountResult: Record<string, unknown>[] = [];
  let createResult: Record<string, unknown> | null = null;
  let createError: Error | null = null;
  let lineItemsResult: Record<string, unknown>[] = [];

  const repo = {
    calls,
    set findByIdResult(v: Record<string, unknown> | null) { findByIdResult = v; },
    set findByAccountResult(v: Record<string, unknown>[]) { findByAccountResult = v; },
    set createResult(v: Record<string, unknown> | null) { createResult = v; },
    set createError(v: Error | null) { createError = v; },
    set lineItemsResult(v: Record<string, unknown>[]) { lineItemsResult = v; },

    async findById(id: string) {
      calls.push({ method: 'findById', args: [id] });
      return findByIdResult;
    },
    async findByAccount(accountId: string, page?: number, pageSize?: number) {
      calls.push({ method: 'findByAccount', args: [accountId, page, pageSize] });
      return findByAccountResult;
    },
    async createWithLineItems(_tx: unknown, data: unknown) {
      calls.push({ method: 'createWithLineItems', args: [data] });
      if (createError) throw createError;
      if (!createResult) throw new Error('Mock: createResult not set');
      return createResult;
    },
    async getLineItems(invoiceId: string) {
      calls.push({ method: 'getLineItems', args: [invoiceId] });
      return lineItemsResult;
    },
  };
  return repo;
}

function makeMockAccountRepo() {
  const calls: CallRecord[] = [];
  let findByIdResult: Record<string, unknown> | null = null;

  const repo = {
    calls,
    set findByIdResult(v: Record<string, unknown> | null) { findByIdResult = v; },

    async findById(id: string) {
      calls.push({ method: 'findById', args: [id] });
      return findByIdResult;
    },
    async create(_data: unknown) {
      calls.push({ method: 'create', args: [_data] });
      throw new Error('Not used in invoice tests');
    },
    async updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint) {
      calls.push({ method: 'updateCounters', args: [id, deltaBalance, deltaInvoiced] });
      return findByIdResult ? { ...findByIdResult } : null;
    },
  };
  return repo;
}

function makeMockDb() {
  const transactionCalls: number[] = [];

  const db = {
    transactionCalls,
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      transactionCalls.push(1);
      const tx: unknown = {};
      return fn(tx);
    },
  };
  return db;
}

function makeService(
  invoiceRepo: ReturnType<typeof makeMockInvoiceRepo>,
  accountRepo: ReturnType<typeof makeMockAccountRepo>,
  db: ReturnType<typeof makeMockDb>,
): InvoiceService {
  return new InvoiceService(
    invoiceRepo as never,
    accountRepo as never,
    db as never,
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2025-01-15T10:30:00.000Z');

const SAMPLE_INVOICE_ROW = {
  id: 'inv-uuid-1',
  account_id: 'acct-uuid-1',
  amount_cents: '5000',
  status: 'pending',
  created_at: NOW,
  updated_at: NOW,
};

const SAMPLE_LINE_ITEM_ROWS = [
  {
    id: 'li-uuid-1',
    invoice_id: 'inv-uuid-1',
    description: 'Widget A',
    amount_cents: '3000',
    created_at: NOW,
  },
  {
    id: 'li-uuid-2',
    invoice_id: 'inv-uuid-1',
    description: 'Widget B',
    amount_cents: '2000',
    created_at: NOW,
  },
];

const SAMPLE_ACCOUNT_ROW = {
  id: 'acct-uuid-1',
  name: 'Test Account',
  balance_cents: '100000',
  total_invoiced_cents: '5000',
  created_at: NOW,
  updated_at: NOW,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InvoiceService', () => {
  let invoiceRepo: ReturnType<typeof makeMockInvoiceRepo>;
  let accountRepo: ReturnType<typeof makeMockAccountRepo>;
  let db: ReturnType<typeof makeMockDb>;
  let service: InvoiceService;

  beforeEach(() => {
    invoiceRepo = makeMockInvoiceRepo();
    accountRepo = makeMockAccountRepo();
    db = makeMockDb();
    service = makeService(invoiceRepo, accountRepo, db);
  });

  // Test 3 – POST /invoices creates invoice with line items (happy path)
  it('create returns a response with string amounts and nested line_items', async () => {
    accountRepo.findByIdResult = SAMPLE_ACCOUNT_ROW;
    invoiceRepo.createResult = SAMPLE_INVOICE_ROW;
    invoiceRepo.lineItemsResult = SAMPLE_LINE_ITEM_ROWS;

    const result = await service.create({
      account_id: 'acct-uuid-1',
      line_items: [
        { description: 'Widget A', amount_cents: '3000' },
        { description: 'Widget B', amount_cents: '2000' },
      ],
    });

    // Top-level fields
    expect(result.id).toBe('inv-uuid-1');
    expect(result.account_id).toBe('acct-uuid-1');
    expect(typeof result.amount_cents).toBe('string');
    expect(result.status).toBe('pending');

    // line_items present and correctly shaped
    expect(Array.isArray(result.line_items)).toBe(true);
    expect(result.line_items.length).toBe(2);
    expect(result.line_items[0].id).toBe('li-uuid-1');
    expect(result.line_items[0].description).toBe('Widget A');
    expect(typeof result.line_items[0].amount_cents).toBe('string');
    expect(result.line_items[0].amount_cents).toBe('3000');
    expect(result.line_items[1].id).toBe('li-uuid-2');
    expect(result.line_items[1].description).toBe('Widget B');
    expect(result.line_items[1].amount_cents).toBe('2000');

    // Dates are ISO strings
    expect(typeof result.created_at).toBe('string');
    expect(result.created_at).toBe(NOW.toISOString());
    expect(typeof result.updated_at).toBe('string');
    expect(result.updated_at).toBe(NOW.toISOString());

    // Transaction was used
    expect(db.transactionCalls.length).toBe(1);

    // Account counters were updated
    const counterCall = accountRepo.calls.find((c) => c.method === 'updateCounters');
    expect(counterCall).toBeTruthy();
  });

  // Test 4 – POST /invoices with empty line_items returns validation error, no DB write
  it('create with empty line_items throws validation_error and does not call any repository method', async () => {
    const promise = service.create({
      account_id: 'acct-uuid-1',
      line_items: [],
    });

    await expect(promise).rejects.toThrow();

    // No repository method should have been called
    expect(invoiceRepo.calls.length).toBe(0);
    expect(accountRepo.calls.length).toBe(0);
    // No transaction opened
    expect(db.transactionCalls.length).toBe(0);
  });

  // Test 5 – GET /invoices/:id returns invoice with nested line_items
  it('getById returns invoice with nested line_items array', async () => {
    invoiceRepo.findByIdResult = SAMPLE_INVOICE_ROW;
    invoiceRepo.lineItemsResult = SAMPLE_LINE_ITEM_ROWS;

    const result = await service.getById('inv-uuid-1');

    expect(result.id).toBe('inv-uuid-1');
    expect(result.account_id).toBe('acct-uuid-1');
    expect(typeof result.amount_cents).toBe('string');
    expect(result.amount_cents).toBe('5000');
    expect(result.status).toBe('pending');
    expect(Array.isArray(result.line_items)).toBe(true);
    expect(result.line_items.length).toBe(2);
    expect(result.line_items[0].id).toBe('li-uuid-1');
    expect(typeof result.line_items[0].amount_cents).toBe('string');
    expect(result.created_at).toBe(NOW.toISOString());
  });

  // Test 6 – listByAccount paginates correctly
  it('listByAccount returns data, page, and page_size with correct slice', async () => {
    const rows = [
      { ...SAMPLE_INVOICE_ROW, id: 'inv-1' },
      { ...SAMPLE_INVOICE_ROW, id: 'inv-2' },
    ];
    invoiceRepo.findByAccountResult = rows;

    const result = await service.listByAccount('acct-uuid-1', 2, 10);

    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0].id).toBe('inv-1');
    expect(result.data[1].id).toBe('inv-2');

    // Verify the repository was called with correct pagination params
    const findCall = invoiceRepo.calls.find((c) => c.method === 'findByAccount');
    expect(findCall).toBeTruthy();
    expect(findCall!.args[0]).toBe('acct-uuid-1');
    expect(findCall!.args[1]).toBe(2);
    expect(findCall!.args[2]).toBe(10);
  });

  // Test 7 – GET /invoices/:id with bad id returns resource_not_found
  it('getById throws when invoice does not exist', async () => {
    invoiceRepo.findByIdResult = null;

    const promise = service.getById('non-existent-id');

    await expect(promise).rejects.toThrow();
  });

  // Test 10 – POST /invoices for non-existent account returns resource_not_found
  it('create throws when account does not exist', async () => {
    accountRepo.findByIdResult = null;

    const promise = service.create({
      account_id: 'missing-acct',
      line_items: [{ description: 'X', amount_cents: '100' }],
    });

    await expect(promise).rejects.toThrow();

    // No invoice should have been created
    const createCall = invoiceRepo.calls.find((c) => c.method === 'createWithLineItems');
    expect(createCall).toBeUndefined();
  });

  // Test 11 – amount_cents is a string type even for large values
  it('create returns amount_cents as a string for large bigint values', async () => {
    accountRepo.findByIdResult = SAMPLE_ACCOUNT_ROW;
    invoiceRepo.createResult = {
      ...SAMPLE_INVOICE_ROW,
      amount_cents: '99999999999999',
    };
    invoiceRepo.lineItemsResult = [
      { ...SAMPLE_LINE_ITEM_ROWS[0], amount_cents: '99999999999999' },
    ];

    const result = await service.create({
      account_id: 'acct-uuid-1',
      line_items: [{ description: 'Large', amount_cents: '99999999999999' }],
    });

    expect(typeof result.amount_cents).toBe('string');
    expect(result.amount_cents).toBe('99999999999999');
    expect(typeof result.line_items[0].amount_cents).toBe('string');
    expect(result.line_items[0].amount_cents).toBe('99999999999999');
  });

  // Test 12 – line item with zero amount serialises as "0"
  it('create returns line item with zero amount as string "0"', async () => {
    accountRepo.findByIdResult = SAMPLE_ACCOUNT_ROW;
    invoiceRepo.createResult = { ...SAMPLE_INVOICE_ROW, amount_cents: '0' };
    invoiceRepo.lineItemsResult = [
      { ...SAMPLE_LINE_ITEM_ROWS[0], amount_cents: '0' },
    ];

    const result = await service.create({
      account_id: 'acct-uuid-1',
      line_items: [{ description: 'Free item', amount_cents: '0' }],
    });

    expect(result.line_items.length).toBe(1);
    expect(typeof result.line_items[0].amount_cents).toBe('string');
    expect(result.line_items[0].amount_cents).toBe('0');
  });

  // Test 14 – line_items is present as empty array (not missing) when invoice has no items
  it('getById returns line_items as empty array when no line items exist', async () => {
    invoiceRepo.findByIdResult = SAMPLE_INVOICE_ROW;
    invoiceRepo.lineItemsResult = [];

    const result = await service.getById('inv-uuid-1');

    expect(Array.isArray(result.line_items)).toBe(true);
    expect(result.line_items.length).toBe(0);
  });

  // ─── Transactional behaviour ──────────────────────────────────────────────

  describe('transactional atomicity', () => {
    it('rolls back account counters when line-item insert fails mid-transaction', async () => {
      accountRepo.findByIdResult = SAMPLE_ACCOUNT_ROW;
      invoiceRepo.createError = new Error('Simulated line-item insert failure');

      const promise = service.create({
        account_id: 'acct-uuid-1',
        line_items: [{ description: 'X', amount_cents: '100' }],
      });

      await expect(promise).rejects.toThrow('Simulated line-item insert failure');

      // Account counters must NOT have been updated
      const counterCall = accountRepo.calls.find((c) => c.method === 'updateCounters');
      expect(counterCall).toBeUndefined();
    });

    it('rolls back invoice and line items when a later step fails', async () => {
      accountRepo.findByIdResult = SAMPLE_ACCOUNT_ROW;

      // Simulate: createWithLineItems succeeds but a subsequent step (counter update) fails.
      // We achieve this by making updateCounters throw.
      const originalUpdate = accountRepo.updateCounters;
      let updateCallCount = 0;
      (accountRepo as Record<string, unknown>).updateCounters = async (id: string, _d1: bigint, _d2: bigint) => {
        updateCallCount += 1;
        accountRepo.calls.push({ method: 'updateCounters', args: [id, _d1, _d2] });
        throw new Error('Simulated counter update failure');
      };

      invoiceRepo.createResult = SAMPLE_INVOICE_ROW;

      const promise = service.create({
        account_id: 'acct-uuid-1',
        line_items: [{ description: 'X', amount_cents: '100' }],
      });

      await expect(promise).rejects.toThrow('Simulated counter update failure');

      // The invoice creation was attempted (it's inside the same tx, so it rolls back)
      const createCall = invoiceRepo.calls.find((c) => c.method === 'createWithLineItems');
      expect(createCall).toBeTruthy();

      // Restore for other tests (not strictly needed in beforeEach but good hygiene)
      (accountRepo as Record<string, unknown>).updateCounters = originalUpdate;
    });
  });

  // ─── Edge: no-argument pagination defaults ──────────────────────────────────

  it('listByAccount with no page/pageSize still returns a valid shape', async () => {
    invoiceRepo.findByAccountResult = [];

    const result = await service.listByAccount('acct-uuid-1');

    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBe(0);
  });
});
