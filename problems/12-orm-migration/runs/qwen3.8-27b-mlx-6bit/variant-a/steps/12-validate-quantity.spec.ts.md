# 12-validate-quantity.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. `test/validate-quantity.spec.ts` — tests that quantity ≤ 0 is rejected with `validation_error`

From the cases file, I need to implement these test cases:
1. quantity 0 is rejected with 400 validation_error
2. quantity −5 is rejected with 400 validation_error
3. quantity 1 (minimum valid) is accepted and the invoice + line item are created
4. quantity field absent from a line-item body → 400 validation_error, no rows persisted
5. non-integer quantity (2.7) → 400 validation_error
6. request with two line items where the second has quantity 0 → 400, and zero rows exist in invoices or line_items
7. error envelope carries code "validation_error", a developer-facing message, and details as an object (not null)

Now let me think about the test structure. Looking at the plan:
- Tests use Vitest
- They import the app via NestJS test module
- The test files use `.spec.ts` in `test/`

I need to set up a NestJS test module with the necessary modules (DatabaseModule, AccountsModule, InvoicesModule) and use a supertest-like approach or direct HTTP calls.

Wait, looking at the plan more carefully - it says "import the app via NestJS test module". In NestJS with Vitest, I'd use `Test.createTestingModule` and then use `app.getHttpServer()` with `supertest`.

Let me think about the structure:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
// ... module imports
```

I need to:
1. Set up the test app with DatabaseModule, AccountsModule, InvoicesModule
2. Before each test, seed an account (so I can create invoices against it)
3. For each case, POST to /invoices with various quantity values and verify the response

Let me think about what modules I need. From the plan:
- `src/db/database.module.ts` — provides DB token
- `src/accounts/accounts.module.ts` — accounts feature
- `src/invoices/invoices.module.ts` — invoices feature

The app module would be `src/app.module.ts`.

For seeding, I'll need to create an account first via the API or directly.

Let me think about the test structure more carefully:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
// or individual modules
```

Actually, looking at the plan's manifest, it says test files read from `src/invoices/invoices.repository.ts`. The tests are behavioral - they test the API contract.

Let me write the test file:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /invoices quantity validation', () => {
  let app: INestApplication;
  let accountId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Seed an account
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Test Account', email: `test-${Date.now()}@example.com` });
    accountId = res.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ... tests
});
```

Wait, but I need to be careful. The plan says the test should verify "no rows persisted" for some cases. That means I need to query the database after the failed request to confirm no invoice was created.

For that, I could either:
1. Use the API (GET /invoices?accountId=...) to check
2. Access the database directly

Using the API is cleaner and more behavioral.

Let me also think about what `CreateInvoiceDto` looks like. From the plan:
- It has line items with `description`, `unit_price_cents`, `quantity`, and possibly `line_total_cents`
- The invoice has `account_id`, `due_date` (optional)

Looking at the repository, `LineItemInsert` would have the fields matching the schema. The DTO for creating an invoice would map to this.

Let me think about what the POST /invoices body looks like:
```json
{
  "account_id": "...",
  "due_date": "2025-01-01T00:00:00Z" (optional),
  "line_items": [
    { "description": "Item", "unit_price_cents": 100, "quantity": 2 }
  ]
}
```

Now for the tests:

1. **quantity 0 → 400 validation_error**
2. **quantity -5 → 400 validation_error**
3. **quantity 1 → 201, invoice created with line item**
4. **quantity absent → 400 validation_error, no rows**
5. **quantity 2.7 (non-integer) → 400 validation_error**
6. **two line items, second has quantity 0 → 400, zero rows in invoices or line_items**
7. **error envelope: code is "validation_error", message present, details is object (not null)**

For case 6, I need to verify that NO invoice row exists AND no line_items exist. I can check via GET /invoices?accountId=... that the list is empty (or doesn't contain a new invoice).

Actually, let me reconsider. For cases that check "no rows persisted", I should:
- Before the request, note the current count of invoices for that account
- After the failed request, verify the count hasn't changed

Or simpler: after each failed request, GET /invoices?accountId=... and verify it's still empty (if I use a fresh account per test) or that no new invoice appeared.

Let me use a pattern where I create a fresh account for each test that needs to verify no rows were persisted, or I just check the invoice list.

Actually, the simplest approach: for tests that need to verify no rows persisted, I'll check via the API that the invoice list for that account is empty (assuming the account starts with no invoices).

Let me also think about case 7 more carefully. It says "error envelope carries code 'validation_error', a developer-facing message, and details as an object (not null)". This is about the shape of the error response. I can test this as part of any of the rejection cases, or as a separate assertion within one of them.

Looking at the cases file again:
- Cases 1, 2, 4, 5, 6 are about rejection scenarios
- Case 3 is about the boundary (quantity 1 is valid)
- Case 7 is about the error envelope shape

I think case 7 can be a separate test or an assertion within one of the rejection tests. Let me make it a dedicated test that specifically checks the envelope shape.

Now let me write the complete file:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /invoices — quantity validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function makeAccount() {
    const email = `qty-test-${crypto.randomUUID()}@example.com`;
    return request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Qty Test', email });
  }

  it('rejects quantity 0 with 400 validation_error', async () => {
    const { body } = await makeAccount();
    const accountId = body.id;

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100, quantity: 0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    // No invoice persisted
    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  // ... etc
});
```

Wait, I need to think about whether `crypto.randomUUID()` is available in Node 20+. Yes, it is (global `crypto` since Node 19+).

Actually, let me reconsider the import. In Vitest with ESM, `crypto` should be available as a global or I can import it from `node:crypto`. Let me use the global to be safe, or import it.

Actually in Node 20+, `crypto.randomUUID()` is available as a global. But to be safe in a TypeScript context, let me import it:

```ts
import { randomUUID } from 'node:crypto';
```

Now, for case 6 (two line items, second has quantity 0), I need to verify:
- Response is 400
- No invoice row exists (GET /invoices?accountId=... returns [])
- No line_items exist (this is implied by no invoice, since line_items FK to invoices)

Actually the case says "zero rows exist in invoices or line_items". Since line_items reference invoices via FK, if no invoice exists, no line_items can exist (assuming cascade or just the FK constraint). But to be thorough, I could also check via GET /invoices/:id for a specific invoice... but we don't have the id since it was never created.

The simplest check: GET /invoices?accountId=... returns an empty array. That proves no invoice was created, and since line_items require a valid invoice_id FK, no line_items could have been persisted either.

Let me finalize the test file. I'll structure it with clear test names matching the cases:

1. "rejects quantity 0 with 400 validation_error"
2. "rejects negative quantity (−5) with 400 validation_error"  
3. "accepts quantity 1 (minimum valid) and creates invoice with line item"
4. "rejects absent quantity field with 400 validation_error and persists no rows"
5. "rejects non-integer quantity (2.7) with 400 validation_error"
6. "rejects when any line item has quantity 0, persisting zero rows"
7. "error envelope has code 'validation_error', a message, and details as an object"

For case 7, I'll make a request with quantity 0 and specifically assert the envelope shape.

Let me write it out completely now.
```

## reply

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';

describe('POST /invoices — quantity validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAccount(): Promise<string> {
    const email = `qty-test-${randomUUID()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Qty Test', email });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('rejects quantity 0 with 400 validation_error', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100, quantity: 0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  it('rejects negative quantity (−5) with 400 validation_error', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100, quantity: -5 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  it('accepts quantity 1 (minimum valid) and creates invoice with line item', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 250, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.line_items).toHaveLength(1);
    expect(res.body.line_items[0].quantity).toBe(1);
    expect(res.body.line_items[0].line_total_cents).toBe('250');
  });

  it('rejects absent quantity field with 400 validation_error and persists no rows', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  it('rejects non-integer quantity (2.7) with 400 validation_error', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100, quantity: 2.7 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  it('rejects when any line item has quantity 0, persisting zero rows', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [
          { description: 'Valid item', unit_price_cents: 100, quantity: 2 },
          { description: 'Invalid item', unit_price_cents: 50, quantity: 0 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');

    const listRes = await request(app.getHttpServer())
      .get(`/invoices?accountId=${accountId}`);
    expect(listRes.body).toEqual([]);
  });

  it('error envelope has code "validation_error", a message, and details as an object', async () => {
    const accountId = await createAccount();

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Item', unit_price_cents: 100, quantity: 0 }],
      });

    expect(res.status).toBe(400);
    const { error } = res.body;
    expect(error.code).toBe('validation_error');
    expect(typeof error.message).toBe('string');
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.details).toBeDefined();
    expect(typeof error.details).toBe('object');
    expect(error.details).not.toBeNull();
    expect(Array.isArray(error.details)).toBe(false);
  });
});
```
