# 10-null-vs-missing.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The file is `test/null-vs-missing.spec.ts`
2. It tests null fields present-as-null; empty arrays not omitted
3. I need to implement all the cases listed in `steps/10-null-vs-missing.spec.ts-cases.txt`

Let me look at the cases:
1. due_date NULL serialises as present-key-null
2. due_date non-null serialises as present-key-ISO-string
3. Empty line_items in detail response is present-key-empty-array
4. Non-empty line_items in detail response is present-key-populated-array
5. List endpoint omits the line_items key entirely
6. due_date omitted in create body and due_date explicitly null produce identical read-back
7. All non-null invoice fields are present in every response shape, including zero-valued money fields
8. Account DTO carries all fields present, including zero-valued counters
9. Error envelope `details` is present-empty-object, never null or absent

Now let me look at the references to understand the API structure:

From the plan:
- Endpoints: GET /accounts, GET /accounts/:id, POST /accounts, GET /invoices?accountId=…, GET /invoices/:id, POST /invoices, PATCH /invoices/:id/status
- DTOs: BigInt fields as string, due_date as string | null (present-key-with-null)
- Error envelope: `{ "error": { "code": string, "message": string, "details": {} } }`

From the repositories:
- `InvoicesRepository.findById` returns `InvoiceWithLineItems` which is `InvoiceRow & { line_items: LineItemRow[] }`
- `InvoicesRepository.findAllByAccount` returns `InvoiceRow[]` (no line_items)
- `AccountsRepository.findById` returns `AccountRow | null`
- `AccountsRepository.findAll` returns `AccountRow[]`

I need to write a Vitest spec file that uses NestJS test module. Let me think about how the tests would be structured.

Looking at the plan's test section, it mentions:
- `test/null-vs-missing.spec.ts` — "due_date null is present-key-null"
- `test/null-vs-missing.spec.ts` — "empty line_items is empty array"

But the cases file has 9 cases. I need to implement all of them.

Let me think about the test structure. I'll use `@nestjs/testing` to create a test module, then make HTTP requests or call service methods directly.

Given the project uses NestJS with controllers and services, I'll use `INestApplication` from the test module to make HTTP requests via `supertest` (which is standard for NestJS testing).

Let me think about what imports I need:
- `@nestjs/testing` for `Test.createTestingModule`
- `supertest` for HTTP requests
- The app module or individual modules

Actually, looking at the project structure more carefully:
- `src/app.module.ts` - main app module
- `src/accounts/accounts.module.ts`
- `src/invoices/invoices.module.ts`
- `src/db/database.module.ts`

For testing, I'll create a test module that imports the app module.

Let me think about the database setup. Since this is a real Postgres database (via DATABASE_URL), the tests will need to:
1. Connect to a test database (or use a transaction that gets rolled back)
2. Seed data as needed
3. Run assertions

Actually, looking at the plan more carefully, it says "Test files use `.spec.ts` in `test/`, run under Vitest, import the app via NestJS test module."

I'll structure this as:
- `beforeAll`: create test app, set up database (clear tables)
- `afterAll`: close app, disconnect db
- Each test: seed data, make request, assert

Let me think about what the DTO shapes look like based on the references:

Account DTO (from GET /accounts/:id):
- id: string (uuid)
- name: string
- email: string
- credit_limit_cents: string (BigInt serialized)
- balance_cents: string (BigInt serialized)
- total_invoiced_cents: string (BigInt serialized)
- created_at: string (ISO date)

Invoice DTO (from GET /invoices/:id - detail):
- id: string
- account_id: string
- status: string
- subtotal_cents: string
- tax_cents: string
- total_cents: string
- due_date: string | null
- created_at: string
- updated_at: string
- line_items: array of { id, invoice_id, description, unit_price_cents (string), quantity (number), line_total_cents (string) }

Invoice list item (from GET /invoices?accountId=…):
- Same as above but WITHOUT line_items

Now let me write the test file. I'll use supertest for HTTP calls.

Wait, I need to be careful about how the database is set up. Since the plan says the connection comes from `DATABASE_URL`, I'll assume the tests run against a real database. I'll need to:
1. Create an account first (or seed one)
2. Create invoices as needed

Let me structure the test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ... tests
});
```

Actually, I need to think about this more carefully. The tests need a database. Let me assume there's a test database available via `DATABASE_URL`.

For cleanup between tests, I should clear the tables or use unique identifiers.

Let me write the complete file now with all 9 cases:

1. due_date NULL serialises as present-key-null
2. due_date non-null serialises as present-key-ISO-string
3. Empty line_items in detail response is present-key-empty-array
4. Non-empty line_items in detail response is present-key-populated-array
5. List endpoint omits the line_items key entirely
6. due_date omitted in create body and due_date explicitly null produce identical read-back
7. All non-null invoice fields are present in every response shape, including zero-valued money fields
8. Account DTO carries all fields present, including zero-valued counters
9. Error envelope `details` is present-empty-object, never null or absent

For each test I need to:
- Create an account (POST /accounts)
- Create an invoice as needed (POST /invoices)
- Make the assertion request
- Check the response body

Let me think about the POST /invoices body format. Based on the plan:
- `CreateInvoiceDto` has: account_id, line_items (array of { description, unit_price_cents, quantity }), tax_cents, due_date

Wait, I need to be more careful. Let me look at what the plan says about DTOs:

From the plan:
- `CreateInvoiceDto` - the input for creating an invoice
- The service computes subtotal, tax, total from line items

Let me think about the request body for POST /invoices:
```json
{
  "account_id": "…",
  "line_items": [{"description": "…", "unit_price_cents": 100, "quantity": 2}],
  "tax_cents": 0,
  "due_date": null or omitted or "2025-06-15T00:00:00.000Z"
}
```

Actually, I need to be careful about the field naming in the request body. The plan says "Endpoint: kebab-case, plural" for endpoints but doesn't explicitly state the JSON body format. However, looking at the DTO naming in the plan (`CreateAccountDto`, `CreateInvoiceDto`), and the convention of the codebase...

Actually, looking at the plan more carefully:
- "DTOs (`AccountDto`, `InvoiceDto`, `InvoiceDetailDto`, `CreateInvoiceDto`, etc.) are identical to the current Prisma version"
- "BigInt fields appear as `string` in DTOs; `due_date` is `string | null` (present-key-with-null, not omitted)"

The DTOs use snake_case for field names based on the column names. So the request body likely uses snake_case too (matching the column names).

For POST /invoices, the body would be:
```json
{
  "account_id": "uuid",
  "line_items": [{"description": "...", "unit_price_cents": 100, "quantity": 2}],
  "tax_cents": 10,
  "due_date": "2025-06-15T00:00:00.000Z"
}
```

Wait, but `unit_price_cents` is a BigInt in the database. In the request body, it would be a number (since JSON doesn't support BigInt). The service would convert it to BigInt before passing to the repository.

Let me now write the complete test file. I'll be thorough and implement all 9 cases.

For the database cleanup, I'll use a helper that deletes all data before each test (or I could use `beforeEach`).

Actually, let me reconsider the approach. Since we're dealing with a real database, I should:
1. Use unique account names/emails for each test to avoid conflicts
2. Or clear the database before each test

I'll go with clearing the database before each test using a raw SQL query through the Drizzle connection, or I could just use unique identifiers.

Actually, the simplest approach for a test file that needs to be self-contained is to:
- In `beforeAll`, set up the app
- In each test, create fresh data with unique identifiers
- Or use `beforeEach` to clean up

Let me use a helper function to create an account and return its ID, and another to create an invoice.

Let me write this now:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  let accountCounter = 0;

  async function createAccount(overrides: Record<string, unknown> = {}) {
    accountCounter++;
    const body = {
      name: `Test Account ${accountCounter}`,
      email: `test${accountCounter}@example.com`,
      ...overrides,
    };
    const res = await request(app.getHttpServer()).post('/accounts').send(body).expect(201);
    return res.body;
  }

  async function createInvoice(accountId: string, overrides: Record<string, unknown> = {}) {
    const body = {
      account_id: accountId,
      line_items: [],
      ...overrides,
    };
    const res = await request(app.getHttpServer()).post('/invoices').send(body).expect(201);
    return res.body;
  }

  // Test 1: due_date NULL serialises as present-key-null
  it('due_date NULL serialises as present-key-null', async () => {
    const account = await createAccount();
    const invoice = await createInvoice(account.id, { due_date: null });
    const res = await request(app.getHttpServer())
      .get(`/invoices/${invoice.id}`)
      .expect(200);
    expect(res.body).toHaveProperty('due_date', null);
  });

  // Test 2: due_date non-null serialises as present-key-ISO-string
  it('due_date non-null serialises as present-key-ISO-string', async () => {
    const account = await createAccount();
    const dueDate = '2025-06-15T00:00:00.000Z';
    const invoice = await createInvoice(account.id, { due_date: dueDate });
    const res = await request(app.getHttpServer())
      .get(`/invoices/${invoice.id}`)
      .expect(200);
    expect(res.body.due_date).toBe(dueDate);
  });

  // ... and so on
});
```

Wait, I need to be careful. The `createInvoice` helper uses `expect(201)` which is a supertest assertion. If it fails, the test will fail at the helper level, not at the specific assertion. That's fine for setup, but I should make sure the setup is reliable.

Also, I realize I need to think about whether `due_date: null` in the request body is the same as omitting `due_date`. The plan says they should produce identical read-back (test case 6).

Let me also think about the "List endpoint omits the line_items key entirely" test. This means that `GET /invoices?accountId=…` should NOT have a `line_items` key in each element. This is different from the detail endpoint which DOES have `line_items`.

Let me also think about test case 7: "All non-null invoice fields are present in every response shape, including zero-valued money fields". This means that when I create an invoice with all zero values (no line items, tax=0), the response should still have all the keys present.

And test case 8: "Account DTO carries all fields present, including zero-valued counters" - a new account should have `"credit_limit_cents":"0","balance_cents":"0","total_invoiced_cents":"0"`.

And test case 9: Error envelope `details` is present-empty-object.

Let me now write the complete file. I need to be careful about:
- Using `expect` from vitest (global)
- The correct endpoint paths
- The correct request/response shapes

One thing I'm not 100% sure about: does the POST /invoices response include `line_items`? Looking at the plan:
- "POST /invoices → 201; nested `line_items` present" (from the invoices.spec.ts test description)

So yes, the create response includes `line_items`.

And for the list endpoint: "GET /invoices?accountId=… returns array; empty → `[]` not null" - and from the cases file: "List endpoint omits the line_items key entirely"

So the list response does NOT include `line_items`, but the create and detail responses DO.

Let me finalize my understanding of the response shapes:

POST /invoices 201 response:
```json
{
  "id": "uuid",
  "account_id": "uuid",
  "status": "draft",
  "subtotal_cents": "0",
  "tax_cents": "0",
  "total_cents": "0",
  "due_date": null,
  "created_at": "ISO string",
  "updated_at": "ISO string",
  "line_items": []
}
```

GET /invoices/:id 200 response: same as above

GET /invoices?accountId=… 200 response (array):
```json
[
  {
    "id": "uuid",
    "account_id": "uuid",
    "status": "draft",
    "subtotal_cents": "0",
    "tax_cents": "0",
    "total_cents": "0",
    "due_date": null,
    "created_at": "ISO string",
    "updated_at": "ISO string"
  }
]
```
(NO line_items key)

GET /accounts/:id 200 response:
```json
{
  "id": "uuid",
  "name": "...",
  "email": "...",
  "credit_limit_cents": "0",
  "balance_cents": "0",
  "total_invoiced_cents": "0",
  "created_at": "ISO string"
}
```

Now let me write the complete test file. I'll make it comprehensive and cover all 9 cases.

One more consideration: for the `due_date` in the request body, I need to pass it as a string (ISO format) or null. The server should handle both.

Let me also think about whether I need to import `request` from 'supertest' or use a different approach. In NestJS with Vitest, the standard approach is to use `supertest` with `app.getHttpServer()`.

Actually, I just realized - in modern NestJS + Vitest setups, you might use `@nestjs/testing` with `supertest`. Let me use the standard pattern.

Let me write the final version now.
```

## reply

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
  let app: INestApplication;
  let accountSeq = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAccount(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    accountSeq++;
    const body = {
      name: `Account ${accountSeq}-${Date.now()}`,
      email: `nulltest-${accountSeq}-${Date.now()}@example.com`,
      ...overrides,
    };
    const res = await request(app.getHttpServer()).post('/accounts').send(body).expect(201);
    return res.body;
  }

  async function createInvoice(
    accountId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      account_id: accountId,
      line_items: [],
      ...overrides,
    };
    const res = await request(app.getHttpServer()).post('/invoices').send(body).expect(201);
    return res.body;
  }

  // ─── due_date NULL serialises as present-key-null ───────────────────────────

  it('due_date NULL serialises as present-key-null', async () => {
    const account = await createAccount();
    await createInvoice(account.id as string, { due_date: null });

    const res = await request(app.getHttpServer())
      .get(`/invoices/${(await getInvoiceIdForAccount(account.id as string))}`)
      .expect(200);

    // Key must be present in the JSON and its value must be null
    expect(res.body).toHaveProperty('due_date');
    expect(res.body.due_date).toBeNull();
  });

  // ─── due_date non-null serialises as present-key-ISO-string ─────────────────

  it('due_date non-null serialises as present-key-ISO-string', async () => {
    const account = await createAccount();
    const dueDate = '2025-06-15T00:00:00.000Z';
    const invoice = await createInvoice(account.id as string, { due_date: dueDate });

    const res = await request(app.getHttpServer())
      .get(`/invoices/${invoice.id}`)
      .expect(200);

    expect(res.body.due_date).toBe(dueDate);
  });

  // ─── Empty line_items in detail response is present-key-empty-array ─────────

  it('empty line_items in detail response is present-key-empty-array', async () => {
    const account = await createAccount();
    const created = await createInvoice(account.id as string, { line_items: [] });

    // Both the POST 201 body and the GET detail must carry line_items: []
    expect(created).toHaveProperty('line_items');
    expect(created.line_items).toEqual([]);

    const res = await request(app.getHttpServer())
      .get(`/invoices/${created.id}`)
      .expect(200);

    expect(res.body).toHaveProperty('line_items');
    expect(res.body.line_items).toEqual([]);
  });

  // ─── Non-empty line_items in detail response is present-key-populated-array ─

  it('non-empty line_items in detail response is present-key-populated-array', async () => {
    const account = await createAccount();
    const created = await createInvoice(account.id as string, {
      line_items: [
        { description: 'Widget A', unit_price_cents: 150, quantity: 3 },
        { description: 'Widget B', unit_price_cents: 0, quantity: 1 },
      ],
    });

    expect(created.line_items).toHaveLength(2);

    const res = await request(app.getHttpServer())
      .get(`/invoices/${created.id}`)
      .expect(200);

    expect(res.body.line_items).toHaveLength(2);
    // Every element must carry all its columns
    for (const item of res.body.line_items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('invoice_id');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('unit_price_cents');
      expect(item).toHaveProperty('quantity');
      expect(item).toHaveProperty('line_total_cents');
    }
    // The zero-price item must still be present (not filtered out)
    const zeroItem = res.body.line_items.find(
      (i: { unit_price_cents: string }) => i.unit_price_cents === '0',
    );
    expect(zeroItem).toBeDefined();
  });

  // ─── List endpoint omits the line_items key entirely ────────────────────────

  it('list endpoint omits the line_items key entirely', async () => {
    const account = await createAccount();
    await createInvoice(account.id as string, {
      line_items: [{ description: 'Item', unit_price_cents: 100, quantity: 1 }],
    });

    const res = await request(app.getHttpServer())
      .get('/invoices')
      .query({ account_id: account.id })
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    for (const row of res.body) {
      expect(row).not.toHaveProperty('line_items');
    }
  });

  // ─── due_date omitted vs explicit null produce identical read-back ──────────

  it('due_date omitted in create body and due_date explicitly null produce identical read-back', async () => {
    const account = await createAccount();

    // Invoice 1: due_date key omitted entirely from the request body
    const res1 = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: account.id, line_items: [] })
      .expect(201);

    // Invoice 2: due_date explicitly null
    const res2 = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: account.id, line_items: [], due_date: null })
      .expect(201);

    const detail1 = await request(app.getHttpServer())
      .get(`/invoices/${res1.body.id}`)
      .expect(200);
    const detail2 = await request(app.getHttpServer())
      .get(`/invoices/${res2.body.id}`)
      .expect(200);

    expect(detail1.body.due_date).toBeNull();
    expect(detail2.body.due_date).toBeNull();
  });

  // ─── All non-null invoice fields present including zero-valued money ────────

  it('all non-null invoice fields are present in every response shape including zero-valued money fields', async () => {
    const account = await createAccount();
    // No line items, no tax → subtotal=0, tax=0, total=0
    const created = await createInvoice(account.id as string, { line_items: [] });

    const requiredKeys = [
      'id',
      'account_id',
      'status',
      'subtotal_cents',
      'tax_cents',
      'total_cents',
      'due_date',
      'created_at',
      'updated_at',
    ];

    // POST 201 body
    for (const key of requiredKeys) {
      expect(created).toHaveProperty(key);
    }
    // Zero-valued money fields are the string "0", not omitted or null
    expect(created.subtotal_cents).toBe('0');
    expect(created.tax_cents).toBe('0');
    expect(created.total_cents).toBe('0');

    // GET detail
    const res = await request(app.getHttpServer())
      .get(`/invoices/${created.id}`)
      .expect(200);

    for (const key of requiredKeys) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.subtotal_cents).toBe('0');
    expect(res.body.tax_cents).toBe('0');
    expect(res.body.total_cents).toBe('0');
  });

  // ─── Account DTO carries all fields present including zero-valued counters ──

  it('account DTO carries all fields present including zero-valued counters', async () => {
    const account = await createAccount();

    const res = await request(app.getHttpServer())
      .get(`/accounts/${account.id}`)
      .expect(200);

    const requiredKeys = [
      'id',
      'name',
      'email',
      'credit_limit_cents',
      'balance_cents',
      'total_invoiced_cents',
      'created_at',
    ];

    for (const key of requiredKeys) {
      expect(res.body).toHaveProperty(key);
    }

    // Brand-new account: all counters are "0" as strings
    expect(res.body.credit_limit_cents).toBe('0');
    expect(res.body.balance_cents).toBe('0');
    expect(res.body.total_invoiced_cents).toBe('0');
  });

  // ─── Error envelope details is present-empty-object, never null or absent ──

  it('error envelope details is present-empty-object never null or absent', async () => {
    const res = await request(app.getHttpServer())
      .get('/invoices/00000000-0000-0000-0000-000000000000')
      .expect(404);

    expect(res.body).toHaveProperty('error');
    const err = res.body.error;
    expect(err).toHaveProperty('code', 'resource_not_found');
    expect(err).toHaveProperty('message');
    expect(err).toHaveProperty('details');
    // details must be an object (possibly empty), never null, never absent
    expect(typeof err.details).toBe('object');
    expect(err.details).not.toBeNull();
    expect(Array.isArray(err.details)).toBe(false);
  });

  // ─── helper ──────────────────────────────────────────────────────────────────

  async function getInvoiceIdForAccount(accountId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/invoices')
      .query({ account_id: accountId })
      .expect(200);
    return res.body[res.body.length - 1].id as string;
  }
});
```
