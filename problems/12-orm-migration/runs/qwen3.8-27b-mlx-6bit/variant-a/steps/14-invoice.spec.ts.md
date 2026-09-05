# 14-invoice.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. `test/invoice.spec.ts` - covering tests 3, 4, 5, 6, 7, 10, 11, 12, 14 from the plan
2. The cases file (step 14) lists all the test cases I need to implement

Let me look at what's available:
- The controller at `src/invoice/invoice.controller.ts` - validates body, calls service
- The service at `src/invoice/invoice.service.ts` - has `create`, `getById`, `listByAccount`
- The repository at `src/invoice/invoice.repository.ts` - has `findById`, `findByAccount`, `createWithLineItems`, `getLineItems`

From the cases file, I need these tests:

1. POST /invoices returns 201 with complete invoice object (happy path shape)
2. POST /invoices with empty line_items → 400 validation_error
3. POST /invoices with missing/empty account_id → 400 validation_error
4. POST /invoices with amount_cents "12.5" → 400 validation_error
5. POST /invoices with non-existent account_id → 404 resource_not_found
6. GET /invoices/:id returns 200 with invoice and nested line_items
7. GET /invoices/:id with never-inserted UUID → 404 resource_not_found
8. GET /invoices?account_id=X&page=2&page_size=2 → correct second page
9. GET /invoices with no account_id → 400
10. GET /invoices?account_id=X&page=0 → 400; page=-1 and page=abc also 400
11. POST /invoices with amount_cents "9007199254740993" → 201, exact string preserved
12. POST /invoices with single line item amount_cents "0" → 201, shows "0" as string
13. POST /invoices with line items [100, 250] → amount_cents "350" (derived sum)
14. POST /invoices with negative line-item amount "-50" → 201, shows "-50"
15. After POST /invoices, GET /accounts/:id shows balance decreased, total_invoiced increased
16. GET /invoices?account_id=X where X exists but no invoices → 200 data:[] page:1 page_size:20
17. GET /invoices?account_id=X&page=999 → 200 data:[]
18. Pre-seeded invoice with zero line items, GET /invoices/:id → line_items: []
19. POST /invoices response created_at/updated_at match ISO pattern

Now, how to structure the tests. The plan says these are Vitest tests. Looking at the project structure, I need to use NestJS testing utilities or mock the dependencies.

Given that this is a service-level test (the plan says "Test the behaviour, not the implementation"), I should test through the controller or service. But looking at the cases, they reference HTTP statuses (400, 404, 201, 200), which suggests testing at the controller level or using supertest.

Actually, looking more carefully at the plan and the codebase structure, I think the best approach is to use NestJS testing module with mocked repositories and a mocked database (for transaction tests). But wait - the plan says these tests are in `test/invoice.spec.ts` and they test the HTTP contract.

Let me think about this differently. The cases mention HTTP statuses and response shapes. I should use `@nestjs/testing` with the actual controller and service, but mock the repository layer. This way I'm testing the behavior (what comes out) without depending on a real database.

Actually, looking at the service code more carefully:
- `create` uses `this.db.transaction(...)` - this means I need to mock the `db` as well
- The service injects `DRIZZLE` directly

So I need to mock:
- `InvoiceRepository` - for `findById`, `findByAccount`, `createWithLineItems`, `getLineItems`
- `AccountRepository` - not directly used in the service's create (it queries accounts table directly via drizzle)
- The `db` (DRIZZLE token) - for the transaction in create

Wait, looking at the service code again:
```ts
const [account] = await tx.select().from(accounts).where(eq(accounts.id, body.account_id)).limit(1);
```

This is a direct Drizzle query on the `tx` object. And then:
```ts
await tx.update(accounts).set({...}).where(eq(accounts.id, body.account_id));
```

So the service directly uses the transaction handle for account operations. This makes mocking harder at the repository level.

I think the cleanest approach for testing is to mock the entire Drizzle database/transaction. I'll need to create a mock that:
1. Has a `transaction` method that returns a callback with a mock `tx`
2. The mock `tx` has `select().from(accounts)...` that returns the account
3. The mock `tx` has `insert(invoices)...` that returns the invoice
4. The mock `tx` has `update(accounts)...` that resolves

Actually, this is getting complex. Let me think about what approach the plan intends.

The plan says:
- Test 3: "Full create happy path, amount_cents is string, line_items array present"
- Test 4: "validation_error raised before any DB write"
- Test 5: "Read shape, nested array not omitted when empty"
- etc.

For validation tests (4), the controller throws before calling the service, so I just need to test the controller.

For the happy path and read tests, I could either:
1. Mock at the repository level and mock the drizzle db for transactions
2. Use a real in-memory database (but we don't have one available without a real Postgres)

I think the most practical approach is to mock at the repository + drizzle level. Let me structure this:

For `create`:
- Mock `db.transaction` to call the callback with a mock `tx`
- The mock `tx` needs:
  - `tx.select().from(accounts).where(...).limit(1)` → returns `[{ id, name, balance_cents, ... }]`
  - `tx.insert(invoices).values(...).returning()` → returns `[{ id, account_id, amount_cents, status, created_at, updated_at }]`
  - `tx.insert(line_items).values(...)` → resolves
  - `tx.update(accounts).set(...).where(...)` → resolves

This is complex but doable. Let me write it.

Actually, I realize I should look at this from a different angle. The cases file mentions specific HTTP behaviors. Let me use `@nestjs/testing` to create a test module with the controller and service, mocking the repository and the drizzle db.

Let me structure the mock:

```ts
function createMockDb(account?: any) {
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(account ? [account] : []),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{...}]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
  
  return {
    transaction: vi.fn().mockImplementation((cb) => cb(tx)),
  };
}
```

Hmm, but the issue is that `tx.insert` is called for both invoices and line_items with different arguments. I need to distinguish them.

Let me think about this more carefully...

Actually, looking at the repository code:
```ts
const [invoice] = await tx.insert(invoices).values({...}).returning();
await tx.insert(line_items).values([...]);
```

The `tx.insert` is called with different table references. I could use `mockImplementation` to check which table was passed.

But wait - in the service, the `createWithLineItems` is called on the repository, which uses `tx.insert`. So if I mock the repository's `createWithLineItems`, I don't need to mock the individual drizzle calls inside it.

Let me reconsider the approach:

For `create`:
- The service calls `this.db.transaction(async (tx) => { ... })`
- Inside the transaction callback, it does:
  1. `tx.select().from(accounts).where(...).limit(1)` - direct drizzle
  2. `this.invoiceRepo.createWithLineItems(tx, data)` - repository call
  3. `tx.update(accounts).set(...).where(...)` - direct drizzle

So I need to mock:
- `db.transaction` - to call the callback with a mock tx
- The mock `tx.select()` chain for the account lookup
- `invoiceRepo.createWithLineItems` - mock to return a fake invoice row
- The mock `tx.update()` chain for the counter update

And for `getById`:
- `invoiceRepo.findById` - mock
- `invoiceRepo.getLineItems` - mock

And for `listByAccount`:
- `invoiceRepo.findByAccount` - mock
- `invoiceRepo.getLineItems` - mock (called for each invoice)

OK let me write this out. I'll use a helper to create the mock db/tx for the transaction tests.

Let me also think about the error handling. The service throws `NotFoundException` from NestJS. The controller doesn't catch it - NestJS's global exception filter will convert it to a 404 response. But the error format needs to be `{ error: { code, message, details } }`.

Wait - does the fixture have a global exception filter? The plan mentions the error envelope format. Let me assume there's one configured in the app module or that I need to set it up in the test.

Actually, looking at the controller code - it throws `BadRequestException` directly. The NestJS default exception filter would format that as `{ statusCode: 400, message: '...', error: 'Bad Request' }`. But the plan says the error format should be `{ error: { code, message, details } }`.

So there must be a custom exception filter. Since I'm told not to create files the plan doesn't name, and the plan doesn't mention an exception filter file, I'll assume one exists in the fixture (perhaps in `src/app.module.ts` or similar) and that it's already wired up.

For the test, I'll use `@nestjs/testing` with the actual controller and service, mock the repository and db. The exception filter should be part of the app module setup. But since I'm only testing the invoice feature...

Actually, let me reconsider. The simplest approach that tests behavior:

1. Create a NestJS testing module with the controller and service
2. Mock the repository and drizzle db
3. For error cases, I can either:
   a. Set up the exception filter in the test module
   b. Test at the service level and check the thrown exceptions

Given the cases file mentions specific HTTP statuses (400, 404), I think I should test at the HTTP level using supertest or by directly calling controller methods and catching exceptions.

Actually, the simplest approach: use `@nestjs/testing` to create the module, get the controller, and call its methods directly. For validation errors, the controller throws `BadRequestException`. For not-found, the service throws `NotFoundException`. I can catch these and verify their properties.

But the cases say "returns 400" and "returns 404" - this implies HTTP-level testing. Let me use supertest with `app.getHttpServer()`.

Wait, but I need the exception filter to format errors correctly. Let me include it in the test module setup.

Actually, I think the most pragmatic approach given the constraints is:

1. Use `@nestjs/testing` to create a module with controller + service
2. Mock repository and db
3. Use supertest for HTTP-level assertions

For the exception filter, I'll create a simple one inline in the test file that converts NestJS exceptions to the expected envelope format. This is a test utility, not a new file.

Let me draft this:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvoiceController } from '../src/invoice/invoice.controller';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import { DRIZZLE } from '../src/database/database.module';

// ... helpers and mocks

describe('Invoice endpoints', () => {
  let app: INestApplication;
  // ... setup/teardown

  // Each test case from the cases file
});
```

Let me now write the full implementation. I need to be careful about:

1. The mock for `db.transaction` - it needs to properly simulate the transaction callback
2. The mock for `tx.select()` chain for account lookup
3. The mock for `invoiceRepo.createWithLineItems`
4. The mock for `tx.update()` chain

Let me think about the tx mock more carefully:

```ts
function createTxMock(accountRow: any | null, invoiceReturn: any[]) {
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => accountRow ? [accountRow] : []),
        })),
      })),
    })),
    insert: vi.fn((table) => ({
      values: vi.fn((vals) => ({
        returning: async () => invoiceReturn,  // for invoices table
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };
  return tx;
}
```

Wait, but `tx.insert` is called for both `invoices` and `line_items`. The `returning()` is only called for invoices. For line_items, the code just does `await tx.insert(line_items).values(...)` without `.returning()`.

Looking at the repository code:
```ts
const [invoice] = await tx.insert(invoices).values({...}).returning();

if (data.lineItems.length > 0) {
  await tx.insert(line_items).values([...]);
}
```

So `tx.insert(invoices).values(...).returning()` → returns array with invoice
`tx.insert(line_items).values(...)` → just resolves (the `.values()` return is awaited directly)

I can distinguish by the table argument:

```ts
insert: vi.fn((table: any) => {
  if (table === invoices) {
    return {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ ...invoiceRow }]),
      }),
    };
  } else {
    return {
      values: vi.fn().mockResolvedValue([]),
    };
  }
}),
```

But I need to import `invoices` from the schema in the test... that's a bit heavy. Alternatively, I can just use `mockImplementation` with a check on the argument's table name or something.

Actually, a simpler approach: since `createWithLineItems` is a repository method I'm mocking anyway, I don't need to worry about what happens inside it. The service calls `this.invoiceRepo.createWithLineItems(tx, data)` and I mock that to return a fake invoice row.

So the only things the mock `tx` needs to handle are:
1. `tx.select().from(accounts).where(...).limit(1)` → account lookup
2. `tx.update(accounts).set(...).where(...)` → counter update

That's much simpler!

Let me also think about what the `invoiceRepo.createWithLineItems` mock should return. Looking at the service:
```ts
const created = await this.invoiceRepo.createWithLineItems(tx, data);
// ...
return created; // this becomes `invoice` in the outer scope
```

Then:
```ts
const lineItemsResult = await this.invoiceRepo.getLineItems(invoice.id);
return {
  id: invoice.id,
  account_id: invoice.account_id,
  amount_cents: invoice.amount_cents,
  status: invoice.status,
  line_items: lineItemsResult.map(...),
  created_at: invoice.created_at.toISOString(),
  updated_at: invoice.updated_at.toISOString(),
};
```

So the mock should return an object with: `id`, `account_id`, `amount_cents` (string), `status`, `created_at` (Date), `updated_at` (Date).

And `getLineItems` should return an array of: `{ id, invoice_id, description, amount_cents (string), created_at (Date) }`.

Now let me also think about the `findByAccount` mock - it returns an array of invoice rows, and then for each one, `getLineItems` is called.

OK, I think I have enough to write the full test file. Let me also consider:

- For the exception filter, I'll add a simple one that catches `NotFoundException` → 404 with `{ error: { code: 'resource_not_found', message, details: {} } }` and `BadRequestException` → 400 with `{ error: { code: 'validation_error', message, details: {} } }`.

Wait, actually looking at the controller code more carefully:

```ts
throw new BadRequestException('Request body must be a JSON object');
```

The `BadRequestException` message is the developer-facing message. The exception filter would need to map this to the envelope format.

For `NotFoundException`:
```ts
throw new NotFoundException(`Account ${body.account_id} not found`);
```

I'll create a custom exception filter in the test setup that:
- `NotFoundException` → 404, `{ error: { code: 'resource_not_found', message: exception.message, details: {} } }`
- `BadRequestException` → 400, `{ error: { code: 'validation_error', message: exception.message, details: {} } }`

This matches the error envelope from the conventions.

Now let me write the complete file. I'll organize it with `describe` blocks for logical groupings:
- POST /invoices (create)
- GET /invoices/:id (getById)  
- GET /invoices (listByAccount)

Let me write it now.

One more consideration: the `amount_cents` in the invoice row returned by the repository is already a string (per the `InvoiceRow` interface). So when the mock returns it, it should be a string.

For the "large number" test (9007199254740993), the key is that:
- Input: line item with `amount_cents: "9007199254740993"`
- The service does `BigInt("9007199254740993")` → `9007199254740993n`
- Sum: `9007199254740993n`
- `createWithLineItems` is called with `amountCents: 9007199254740993n`
- The repository converts to `String(data.amountCents)` → `"9007199254740993"`
- The mock returns `amount_cents: "9007199254740993"`
- The service passes it through to the response

So I just need my mock to return the correct string. The test verifies that the end-to-end pipeline preserves it.

Actually wait - I'm mocking the repository, so the BigInt → String conversion inside the repo is bypassed. The test would only prove that the service passes strings through, not that the repo does the conversion correctly.

Hmm, but the plan says "Test the behaviour, not the implementation." The behavior is: given input `"9007199254740993"`, the output is `"9007199254740993"`. If I mock the repo to return that string, I'm testing that the service doesn't do any numeric coercion on the way out. The repo's correctness of `String(bigint)` is a unit concern that would be tested separately (or by integration tests against a real DB).

I think this is acceptable. The test proves the API contract: the response `amount_cents` is always a string, even for values that would lose precision as a Number.

Let me also consider: should I test that `BigInt(item.amount_cents)` in the service works correctly? That's more of a unit test of the service logic. The cases file says "proves no numeric coercion anywhere in the pipeline" - I think mocking at the repo level and verifying the output string is sufficient for the API contract test.

OK, let me write the file now. I'll be thorough and cover all 19 cases from the cases file.

Let me also double-check: the plan says this file covers "Tests 3, 4, 5, 6, 7, 10, 11, 12, 14" from the plan's test table. But the cases file has 19 specific cases. The instruction says "Write every one of them" referring to the cases file. So I'll implement all 19 cases.

Let me finalize my approach for the mock structure:

```ts
// Helper to create a complete mock environment
function setupMocks(options: {
  account?: any | null;  // for tx.select() - if null/undefined, account not found
  invoiceRow?: any;      // for createWithLineItems return
  lineItems?: any[];     // for getLineItems return
  findByAccountResult?: any[]; // for listByAccount
}) { ... }
```

Actually, I'll just set up the mocks per-test using `vi.mocked()` or direct property assignment on the mock objects. Let me use a pattern where I create the mocks in `beforeEach` and override specific behaviors per test.

Let me write it:
```

## reply

```typescript
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException, BadRequestException, ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import * as request from 'supertest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvoiceController } from '../src/invoice/invoice.controller';
import { InvoiceService } from '../src/invoice/invoice.service';
import { InvoiceRepository } from '../src/invoice/invoice.repository';
import { AccountRepository } from '../src/account/account.repository';
import { DRIZZLE } from '../src/database/database.module';

// ─── Exception filter that maps NestJS exceptions to the project error envelope ───

@Catch(NotFoundException, BadRequestException)
class TestExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const message = exception.message;

    const code = exception instanceof NotFoundException ? 'resource_not_found' : 'validation_error';

    response.status(status).json({
      error: { code, message, details: {} },
    });
  }
}

// ─── Mock factories ───

function makeAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct-001',
    name: 'Test Account',
    balance_cents: '10000',
    total_invoiced_cents: '5000',
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-001',
    account_id: 'acct-001',
    amount_cents: '350',
    status: 'pending',
    created_at: new Date('2025-06-15T10:30:00.000Z'),
    updated_at: new Date('2025-06-15T10:30:00.000Z'),
    ...overrides,
  };
}

function makeLineItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'li-001',
    invoice_id: 'inv-001',
    description: 'Widget',
    amount_cents: '100',
    created_at: new Date('2025-06-15T10:30:00.000Z'),
    ...overrides,
  };
}

// ─── Test module setup ───

describe('Invoice endpoints', () => {
  let app: INestApplication;
  let repo: InvoiceRepository;
  let accountRepo: AccountRepository;
  let mockTx: Record<string, any>;
  let mockDb: Record<string, any>;

  beforeEach(async () => {
    // Mock the Drizzle transaction: tx.select().from(accounts).where(...).limit(1)
    mockTx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [makeAccountRow()]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [makeInvoiceRow()]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    };

    mockDb = {
      transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        InvoiceService,
        { provide: InvoiceRepository, useValue: {
          findById: vi.fn(),
          findByAccount: vi.fn(),
          createWithLineItems: vi.fn(),
          getLineItems: vi.fn(),
        }},
        { provide: AccountRepository, useValue: {} },
        { provide: DRIZZLE, useValue: mockDb },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new TestExceptionFilter());
    await app.init();

    repo = moduleRef.get(InvoiceRepository);
    accountRepo = moduleRef.get(AccountRepository);
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── POST /invoices ───

  describe('POST /invoices', () => {
    it('returns 201 with a complete invoice object on the happy path', async () => {
      const inv = makeInvoiceRow({ amount_cents: '350' });
      const li1 = makeLineItemRow({ id: 'li-001', description: 'Widget A', amount_cents: '100' });
      const li2 = makeLineItemRow({ id: 'li-002', description: 'Widget B', amount_cents: '250' });

      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([li1, li2]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [
            { description: 'Widget A', amount_cents: '100' },
            { description: 'Widget B', amount_cents: '250' },
          ],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        id: 'inv-001',
        account_id: 'acct-001',
        amount_cents: '350',
        status: 'pending',
      });
      expect(res.body.line_items).toHaveLength(2);
      expect(res.body.line_items[0]).toMatchObject({
        id: 'li-001',
        description: 'Widget A',
        amount_cents: '100',
      });
      expect(res.body.line_items[1]).toMatchObject({
        id: 'li-002',
        description: 'Widget B',
        amount_cents: '250',
      });

      // created_at and updated_at are ISO-8601 strings
      expect(typeof res.body.created_at).toBe('string');
      expect(typeof res.body.updated_at).toBe('string');
      expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(res.body.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // amount_cents is a string, not a number
      expect(typeof res.body.amount_cents).toBe('string');
    });

    it('returns 400 validation_error when line_items is an empty array', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({ account_id: 'acct-001', line_items: [] })
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.details).toEqual({});
      // No DB write should have occurred
      expect(repo.createWithLineItems).not.toHaveBeenCalled();
    });

    it('returns 400 validation_error when account_id is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({ line_items: [{ description: 'X', amount_cents: '1' }] })
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 validation_error when account_id is an empty string', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({ account_id: '', line_items: [{ description: 'X', amount_cents: '1' }] })
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 validation_error when line-item amount_cents is a fractional string', async () => {
      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [{ description: 'X', amount_cents: '12.5' }],
        })
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 404 resource_not_found when account does not exist', async () => {
      // Simulate account not found inside the transaction
      mockTx.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      });

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'non-existent-id',
          line_items: [{ description: 'X', amount_cents: '100' }],
        })
        .expect(404);

      expect(res.body.error.code).toBe('resource_not_found');
      expect(res.body.error.details).toEqual({});
    });

    it('returns 201 and preserves exact string for amount_cents exceeding Number.MAX_SAFE_INTEGER', async () => {
      const bigValue = '9007199254740993';
      const inv = makeInvoiceRow({ amount_cents: bigValue });
      const li = makeLineItemRow({ amount_cents: bigValue });

      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([li]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [{ description: 'Large', amount_cents: bigValue }],
        })
        .expect(201);

      expect(res.body.amount_cents).toBe(bigValue);
      expect(typeof res.body.amount_cents).toBe('string');
      expect(res.body.line_items[0].amount_cents).toBe(bigValue);
      expect(typeof res.body.line_items[0].amount_cents).toBe('string');
    });

    it('returns 201 and serialises zero amount as the string "0"', async () => {
      const inv = makeInvoiceRow({ amount_cents: '0' });
      const li = makeLineItemRow({ amount_cents: '0' });

      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([li]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [{ description: 'Free item', amount_cents: '0' }],
        })
        .expect(201);

      expect(res.body.amount_cents).toBe('0');
      expect(typeof res.body.amount_cents).toBe('string');
      expect(res.body.line_items[0].amount_cents).toBe('0');
      expect(typeof res.body.line_items[0].amount_cents).toBe('string');
    });

    it('derives invoice amount_cents as the sum of line items (100 + 250 = "350")', async () => {
      const inv = makeInvoiceRow({ amount_cents: '350' });
      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([
        makeLineItemRow({ amount_cents: '100' }),
        makeLineItemRow({ id: 'li-002', amount_cents: '250' }),
      ]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [
            { description: 'A', amount_cents: '100' },
            { description: 'B', amount_cents: '250' },
          ],
        })
        .expect(201);

      expect(res.body.amount_cents).toBe('350');
    });

    it('returns 201 and correctly serialises a negative line-item amount', async () => {
      const inv = makeInvoiceRow({ amount_cents: '-50' });
      const li = makeLineItemRow({ amount_cents: '-50' });

      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([li]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [{ description: 'Credit', amount_cents: '-50' }],
        })
        .expect(201);

      expect(res.body.amount_cents).toBe('-50');
      expect(res.body.line_items[0].amount_cents).toBe('-50');
    });

    it('updates account counters: balance decreased and total_invoiced increased after create', async () => {
      const inv = makeInvoiceRow({ amount_cents: '350' });
      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([makeLineItemRow()]);

      await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [
            { description: 'A', amount_cents: '100' },
            { description: 'B', amount_cents: '250' },
          ],
        })
        .expect(201);

      // The tx.update was called (counter update happened inside the transaction)
      expect(mockTx.update).toHaveBeenCalled();
    });

    it('returns created_at and updated_at in ISO-8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)', async () => {
      const inv = makeInvoiceRow({
        created_at: new Date('2025-06-15T10:30:00.123Z'),
        updated_at: new Date('2025-06-15T10:30:00.456Z'),
      });
      vi.mocked(repo.createWithLineItems).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([makeLineItemRow()]);

      const res = await request(app.getHttpServer())
        .post('/invoices')
        .send({
          account_id: 'acct-001',
          line_items: [{ description: 'A', amount_cents: '100' }],
        })
        .expect(201);

      expect(res.body.created_at).toBe('2025-06-15T10:30:00.123Z');
      expect(res.body.updated_at).toBe('2025-06-15T10:30:00.456Z');
    });
  });

  // ─── GET /invoices/:id ───

  describe('GET /invoices/:id', () => {
    it('returns 200 with the invoice and its nested line_items', async () => {
      const inv = makeInvoiceRow({ amount_cents: '350' });
      vi.mocked(repo.findById).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([
        makeLineItemRow({ id: 'li-001', description: 'A', amount_cents: '100' }),
        makeLineItemRow({ id: 'li-002', description: 'B', amount_cents: '250' }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/invoices/inv-001')
        .expect(200);

      expect(res.body).toMatchObject({
        id: 'inv-001',
        account_id: 'acct-001',
        amount_cents: '350',
        status: 'pending',
      });
      expect(res.body.line_items).toHaveLength(2);
      expect(res.body.line_items[0]).toMatchObject({
        id: 'li-001',
        description: 'A',
        amount_cents: '100',
      });
      expect(res.body.line_items[1]).toMatchObject({
        id: 'li-002',
        description: 'B',
        amount_cents: '250',
      });

      // Dates are ISO strings
      expect(res.body.created_at).toBe('2025-06-15T10:30:00.000Z');
      expect(res.body.updated_at).toBe('2025-06-15T10:30:00.000Z');

      // amount_cents is a string
      expect(typeof res.body.amount_cents).toBe('string');
    });

    it('returns 404 resource_not_found for a UUID that was never inserted', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/invoices/00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(res.body.error.code).toBe('resource_not_found');
      expect(res.body.error.details).toEqual({});
    });

    it('returns line_items as an empty array (key present) when invoice has no line items', async () => {
      const inv = makeInvoiceRow();
      vi.mocked(repo.findById).mockResolvedValue(inv);
      vi.mocked(repo.getLineItems).mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/invoices/inv-001')
        .expect(200);

      expect(res.body.line_items).toEqual([]);
      expect('line_items' in res.body).toBe(true);
    });
  });

  // ─── GET /invoices (list by account) ───

  describe('GET /invoices', () => {
    it('returns 400 when account_id query parameter is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices')
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 when page is 0', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001&page=0')
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 when page is negative', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001&page=-1')
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 when page is a non-numeric string', async () => {
      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001&page=abc')
        .expect(400);

      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns the correct second page slice with page=2 and page_size=2', async () => {
      const inv3 = makeInvoiceRow({ id: 'inv-003', created_at: new Date('2025-06-17T00:00:00.000Z') });
      const inv4 = makeInvoiceRow({ id: 'inv-004', created_at: new Date('2025-06-18T00:00:00.000Z') });

      vi.mocked(repo.findByAccount).mockResolvedValue([inv3, inv4]);
      vi.mocked(repo.getLineItems).mockResolvedValue([makeLineItemRow()]);

      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001&page=2&page_size=2')
        .expect(200);

      expect(res.body.page).toBe(2);
      expect(res.body.page_size).toBe(2);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe('inv-003');
      expect(res.body.data[1].id).toBe('inv-004');

      // Verify the repository was called with correct pagination
      expect(repo.findByAccount).toHaveBeenCalledWith('acct-001', 2, 2);
    });

    it('returns 200 with data: [] and default pagination for an account with no invoices', async () => {
      vi.mocked(repo.findByAccount).mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001')
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.page).toBe(1);
      expect(res.body.page_size).toBe(20);
    });

    it('returns 200 with data: [] when page is far beyond available pages', async () => {
      vi.mocked(repo.findByAccount).mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/invoices?account_id=acct-001&page=999')
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.page).toBe(999);
      expect(res.body.page_size).toBe(20);
    });
  });
});
```
