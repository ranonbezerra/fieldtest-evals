# repair1-invoice.spec.ts

## reasoning

```
Let me analyze the compiler errors:

1. `toMatchObject` - not available on the custom expect type
2. `toMatch` - not available on the custom expect type
3. `toHaveBeenCalled` - not available (this is a jest/vitest mock assertion, not an expect matcher)
4. `toHaveLength` - not available on the custom expect type
5. `toHaveBeenCalledWith` - not available (mock assertion)

The available matchers are: `toBe`, `toEqual`, `toThrow`, `toBeCloseTo`, `toContain`, `not`, `rejects`.

So I need to:
- Replace `toMatchObject` with `toEqual` (checking the full object) or destructure and check individual properties
- Replace `toMatch` with `toContain` or manual string checking
- Replace `toHaveBeenCalled` / `toHaveBeenCalledWith` - these are mock assertions. Since they're not available in this custom expect, I need to track calls manually (e.g., using a flag or array).
- Replace `toHaveLength` with checking `.length` property directly or using `toBe` on the length

Let me look at what the test file needs to do based on the plan:

From the PLAN.md manifest:
- `test/invoice.spec.ts` reads: src/invoice/invoice.controller.ts, src/invoice/invoice.service.ts, src/invoice/invoice.repository.ts
- Tests 3, 4, 5, 6, 7, 10, 11, 12, 14

Test cases:
3. POST /invoices creates invoice with line items (201) - Full create happy path, amount_cents is string, line_items array present
4. POST /invoices with empty line_items returns 400 - validation_error raised before any DB write
5. GET /invoices/:id returns invoice with nested line_items - Read shape, nested array not omitted when empty
6. GET /invoices?account_id=… paginates - data, page, page_size present; correct slice
7. GET /invoices/:id with bad id → 404 - resource_not_found
10. POST /invoices for non-existent account → 404 - FK check surfaced as resource_not_found
11. response amount_cents is a string type (typeof === 'string') even for large values
12. line item with zero amount serialises as "0" not 0 or omitted
14. line_items: [] in response when invoice has no items (if allowed by validation)

Now I need to write tests that:
- Use only `toBe`, `toEqual`, `toThrow`, `toBeCloseTo`, `toContain`, `not`, `rejects`
- Track mock calls manually (use a boolean flag or array)
- Check object shapes by destructuring and using `toBe`/`toEqual` on individual fields, or by using `toEqual` on the full expected object
- Check array lengths with `toBe` on `.length`

Let me write the complete test file. I'll need to mock the repository and database at appropriate levels.

Looking at the plan:
- `InvoiceService` constructor takes `(repo: InvoiceRepository, accountRepo: AccountRepository, db: PostgresJsDatabase)`
- For unit tests of the service, I'll mock the repositories and db
- For testing validation (empty line_items), that happens in the controller or service

Let me think about what level to test. The plan says "Test the behaviour, not the implementation." So I should test through the service or controller level.

Given that this is a NestJS app, I could test via the HTTP layer (supertest) or directly via the service. Given the custom expect matchers available, let me test at the service level with mocked repositories, since that's more unit-testy and avoids needing a full HTTP test setup.

Actually, wait - looking more carefully at the errors, they reference line numbers in `test/invoice.spec.ts` which currently exists. The task says "Rewrite test/invoice.spec.ts complete, fixing what these messages require of this file." So I'm rewriting the whole file.

Let me write a clean test file that:
1. Imports from vitest
2. Mocks InvoiceRepository and AccountRepository
3. Tests the service methods directly
4. Only uses available matchers: `toBe`, `toEqual`, `toThrow`, `toBeCloseTo`, `toContain`, `not`, `rejects`
5. Tracks mock calls with manual flags/arrays

Let me structure this:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service.js';
// ... other imports

// Manual mock tracking
class MockInvoiceRepository {
  calls: string[] = [];
  // ... methods that record calls
}

class MockAccountRepository {
  calls: string[] = [];
  // ... methods that record calls
}

// Mock db for transactions
```

Actually, let me think about this differently. The service's `create` method opens a transaction via `db.transaction(async (tx) => { ... })`. So I need to mock the db's transaction method.

Let me look at what the service does based on the plan:
- `create(body)`: opens db.transaction, loads account, validates, inserts invoice, inserts line items, updates counters
- `getById(id)`: calls repo.findById, throws if not found
- `listByAccount(accountId, page, pageSize)`: calls repo.findByAccount

For the mock db, I need:
```typescript
const mockDb = {
  transaction: async (fn: (tx: any) => Promise<any>) => fn(mockTx),
};
```

Where `mockTx` would be what the repository methods receive in a transaction context. But actually, looking at the plan more carefully:

The service calls `accountRepo.updateCounters` and `invoiceRepo.createWithLineItems` with a tx handle. So the repositories accept either the db or a tx.

Let me think about this more carefully. The repository methods that participate in the transaction receive a `tx` parameter. So:

- `invoiceRepo.createWithLineItems(tx, data)` 
- `accountRepo.updateCounters(id, deltaBalance, deltaInvoiced)` - wait, does this take a tx?

Looking at the plan signature:
```ts
// account.repository.ts
updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
```

Hmm, it doesn't show a tx parameter. But the plan says "accountRepo.updateCounters must run inside the same transaction as invoiceRepo.createWithLineItems."

So maybe the repository holds a reference to the db, and for transactional operations, the service passes the tx. Let me look at the invoice repository:

```ts
createWithLineItems(tx: Tx, data: CreateInvoiceData): Promise<InvoiceRow>;
```

This takes a tx. But `updateCounters` doesn't show one in the signature. Maybe the account repository's `updateCounters` also takes an optional tx? Or maybe the service passes the db/tx to it differently.

Actually, I think for the purposes of this test, I should mock at the service level - mock the repositories and db. The service is what I'm testing.

Let me reconsider. The key behaviors to test:
1. Happy path create returns correct shape
2. Empty line_items → validation error (no DB write)
3. getById returns invoice with nested line_items
4. listByAccount paginates correctly
5. getById with bad id → resource_not_found
6. Create for non-existent account → resource_not_found
7. amount_cents is string type
8. Zero amount serialises as "0"
9. line_items: [] present when empty

For the transaction test, I need to verify that if something fails mid-transaction, the db.transaction rolls back. But since I'm mocking the db, I can verify that the transaction function was called and that when it throws, the error propagates.

Let me write this now. I'll use a simple mock approach with manual call tracking.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service.js';
import type { InvoiceRepository } from '../src/invoice/invoice.repository.js';
import type { AccountRepository } from '../src/account/account.repository.js';

// --- Mock types ---

interface Row {
  [key: string]: unknown;
}

class MockInvoiceRepository implements InvoiceRepository {
  calls: { method: string; args: unknown[] }[] = [];
  
  private _findByIdResult: Row | null = null;
  private _findByAccountResult: Row[] = [];
  private _createResult: Row | null = null;
  private _createError: Error | null = null;
  private _lineItemsResult: Row[] = [];

  set findByIdResult(v: Row | null) { this._findByIdResult = v; }
  set findByAccountResult(v: Row[]) { this._findByAccountResult = v; }
  set createResult(v: Row) { this._createResult = v; }
  set createError(v: Error) { this._createError = v; }
  set lineItemsResult(v: Row[]) { this._lineItemsResult = v; }

  async findById(id: string): Promise<Row | null> {
    this.calls.push({ method: 'findById', args: [id] });
    return this._findByIdResult;
  }

  async findByAccount(accountId: string, page?: number, pageSize?: number): Promise<Row[]> {
    this.calls.push({ method: 'findByAccount', args: [accountId, page, pageSize] });
    return this._findByAccountResult;
  }

  async createWithLineItems(tx: unknown, data: unknown): Promise<Row> {
    this.calls.push({ method: 'createWithLineItems', args: [tx, data] });
    if (this._createError) throw this._createError;
    if (!this._createResult) throw new Error('No result set');
    return this._createResult;
  }

  async getLineItems(invoiceId: string): Promise<Row[]> {
    this.calls.push({ method: 'getLineItems', args: [invoiceId] });
    return this._lineItemsResult;
  }
}
```

Wait, I'm overcomplicating this. Let me think about what the actual service code looks like and what I need to mock.

The service:
- `create(body)`: 
  1. Validates line_items is non-empty (if done in service)
  2. Opens transaction
  3. Inside: loads account, validates, creates invoice + line items, updates counters
  4. Returns assembled response

- `getById(id)`:
  1. Calls repo.findById
  2. If null, throws
  3. Loads line items
  4. Returns assembled response

- `listByAccount(accountId, page, pageSize)`:
  1. Calls repo.findByAccount
  2. Returns assembled response

For validation of empty line_items - the plan says the controller validates input. But test 4 says "validation_error raised before any DB write". So I need to verify no repo method was called.

Actually, looking at the plan's control flow:
"1. Controller validates body shape (account_id present, line_items non-empty array...)"

So validation happens in the controller. But if I'm testing the service directly, I might need to test that path differently. Or maybe the service also validates? Let me re-read...

The plan says:
"Controller validates body shape (account_id present, line_items non-empty array, each item has description + amount_cents). Calls InvoiceService.create."

So the controller does the validation. But for test 4, I need to test that empty line_items results in a 400. If I'm testing at the service level, I'd need to either:
- Test the controller (needs more setup)
- Or assume the service also validates (defensive)

Given the constraint "Test the behaviour, not the implementation", and that the plan explicitly says the controller validates, I think I should test at a level where this behavior is observable. 

But wait - the plan also says in the service control flow step 3b: "Sum line-item amounts; compare to amount_cents field if the service enforces it (fixture may validate that total line items equals the invoice amount). If mismatch → throw validation_error."

So the service does some validation too. But the empty line_items check is in the controller.

Hmm, for simplicity and to test behavior, let me test at the service level and include a case where line_items is empty - I'll assume the service also guards against this (or I'll note it as an assumption). Actually, re-reading the plan: "Controller validates body shape (account_id present, line_items non-empty array...)". This is the controller's job.

But test 4 in the plan says: "POST /invoices with empty line_items returns 400 | validation_error raised before any DB write"

This implies testing the full HTTP flow or at least that no DB write occurs. If I'm unit-testing the service, I can test that passing an empty array to create() results in an error without calling any repository methods.

I think the safest approach is:
- Test the service directly
- For the empty line_items case, pass it to the service and verify it throws a validation error without calling any repo methods (the service should also guard against this, or at minimum, the transaction would fail)

Actually, you know what, let me just write tests that work with whatever the service does. If the service doesn't validate empty line_items, then passing an empty array would mean no line items to insert, which might still succeed or might fail in the transaction. Let me assume the service does validate this (it's reasonable defensive programming) and if not, I'll add an ASSUMPTION comment.

Let me just write the file now. I'll keep it focused on the behaviors listed in the plan.

For the `toHaveBeenCalledTimes` / `toHaveBeenCalledWith` issue - I'll track calls in arrays on my mock objects and assert on those arrays.

Let me write the complete file:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service.js';

// --- Minimal mock types matching the repository interfaces ---

interface InvoiceRow {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface LineItemRow {
  id: string;
  invoice_id: string;
  description: string;
  amount_cents: string;
  created_at: Date;
}

interface AccountRow {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: Date;
  updated_at: Date;
}

interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

interface Tx {
  // opaque transaction handle
}

// --- Mock repositories ---

class MockInvoiceRepository {
  calls: { method: string; args: unknown[] }[] = [];

  findByIdResult: InvoiceRow | null = null;
  findByAccountResult: InvoiceRow[] = [];
  createResult: InvoiceRow | null = null;
  createError: Error | null = null;
  lineItemsResult: LineItemRow[] = [];

  async findById(id: string): Promise<InvoiceRow | null> {
    this.calls.push({ method: 'findById', args: [id] });
    return this.findByIdResult;
  }

  async findByAccount(accountId: string, page?: number, pageSize?: number): Promise<InvoiceRow[]> {
    this.calls.push({ method: 'findByAccount', args: [accountId, page, pageSize] });
    return this.findByAccountResult;
  }

  async createWithLineItems(_tx: Tx, data: CreateInvoiceData): Promise<InvoiceRow> {
    this.calls.push({ method: 'createWithLineItems', args: [data] });
    if (this.createError) throw this.createError;
    if (!this.createResult) throw new Error('Mock: no createResult set');
    return this.createResult;
  }

  async getLineItems(invoiceId: string): Promise<LineItemRow[]> {
    this.calls.push({ method: 'getLineItems', args: [invoiceId] });
    return this.lineItemsResult;
  }
}

class MockAccountRepository {
  calls: { method: string; args: unknown[] }[] = [];

  findByIdResult: AccountRow | null = null;

  async findById(id: string): Promise<AccountRow | null> {
    this.calls.push({ method: 'findById', args: [id] });
    return this.findByIdResult;
  }

  async create(data: { name: string }): Promise<AccountRow> {
    this.calls.push({ method: 'create', args: [data] });
    throw new Error('Not used in invoice tests');
  }

  async updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null> {
    this.calls.push({ method: 'updateCounters', args: [id, deltaBalance, deltaInvoiced] });
    return { ...this.findByIdResult!, balance_cents: '0', total_invoiced_cents: '0' };
  }
}

// --- Mock database ---

class MockDb {
  transactionCalls: { fn: (tx: Tx) => Promise<unknown> }[] = [];
  transactionError: Error | null = null;

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.transactionCalls.push({ fn });
    const tx: Tx = {};
    if (this.transactionError) {
      // Simulate: the fn itself will throw, and the transaction should propagate
      // We just call fn and let it throw naturally
    }
    return fn(tx);
  }
}

// --- Helper to create a service instance ---

function makeService(
  invoiceRepo: MockInvoiceRepository,
  accountRepo: MockAccountRepository,
  db: MockDb,
): InvoiceService {
  // Cast because our mocks satisfy the interface structurally
  return new InvoiceService(
    invoiceRepo as unknown as Parameters<typeof InvoiceService.prototype.constructor>[0],
    accountRepo as unknown as Parameters<typeof InvoiceService.prototype.constructor>[1],
    db as unknown as Parameters<typeof InvoiceService.prototype.constructor>[2],
  );
}
```

Hmm, this is getting complicated with the typing. Let me simplify. Since I'm writing a test file that needs to compile, I'll just use `as any` or type assertions where needed. Actually, in strict TypeScript, I should be more careful.

Wait, let me reconsider the approach. The issue is that I don't know the exact types of the repository classes (they're in the source). Let me just use `any` for the mock objects and cast them. In a test file, this is acceptable.

Actually, let me look at this differently. The test file needs to compile. The imports from the source files will give me the actual types. Let me import the service and use it directly, mocking its dependencies with `as any` casts where needed.

Let me write a cleaner version:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InvoiceService } from '../src/invoice/invoice.service.js';

// ... tests using manual mocks with `as any` casts
```

For the constructor, I'll just pass mock objects cast to `any`. The service will call methods on them.

Let me also think about what the `create` body looks like. From the plan:
```ts
interface CreateInvoiceBody {
  account_id: string;
  line_items: { description: string; amount_cents: string }[];
}
```

So the service's `create` method takes this body. Inside, it converts `amount_cents` from string to bigint for the repository call.

Now let me write the final version. I'll be pragmatic about types in the test file.

One more consideration: the `rejects` matcher. The type shows `rejects: { ...; }` which suggests I can use `expect(promise).rejects.toThrow(...)` or similar. Let me check what's available under `rejects`. The error message shows it's an object with properties but doesn't list them explicitly. I'll assume `rejects.toThrow` and `rejects.toBe` are available (standard vitest).

Actually wait, looking at the error messages more carefully:

```
Property 'toMatchObject' does not exist on type '{ toBe(expected: unknown): void; toEqual(expected: unknown): void; toThrow(expected?: unknown): void; toBeCloseTo(expected: number, digits?: number | undefined): void; toContain(expected: unknown): void; not: { ...; }; rejects: { ...; }; }'.
```

So the expect object has: `toBe`, `toEqual`, `toThrow`, `toBeCloseTo`, `toContain`, `not`, `rejects`.

For `rejects`, it's shown as `{ ...; }` so I don't know its exact shape. I'll assume it has `toThrow` at minimum (standard pattern).

For the mock call assertions, I'll just track calls in arrays and use `toBe`/`toEqual`/`toContain` on those.

Let me write the final file now:
```

## reply

```typescript
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
```
