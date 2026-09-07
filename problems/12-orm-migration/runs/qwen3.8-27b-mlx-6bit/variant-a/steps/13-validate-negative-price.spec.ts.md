# 13-validate-negative-price.spec.ts

## reasoning

```
Let me analyze what I need to write for `test/validate-negative-price.spec.ts`.

From the PLAN.md:
- Test file: `test/validate-negative-price.spec.ts`
- Proves: "negative unit_price rejected with validation_error"

From the cases file (`13-validate-negative-price.spec.ts-cases.txt`), I need to implement ALL of these cases:

1. **rejects unit_price_cents of −1 with HTTP 400 and code `validation_error`**
2. **rejects with the single error envelope shape** — proves the 400 body is exactly `{ "error": { "code": "validation_error", "message": <string>, "details": <object> } }`
3. **no invoice row or line-item row persisted after a rejected POST**
4. **account counters (total_invoiced_cents, balance_cents) unchanged after a rejected POST**
5. **rejects when only the second of two line items carries a negative price**
6. **accepts unit_price_cents of 0 (boundary: zero is a valid price)**
7. **accepts a valid multi-line-item invoice (all prices ≥ 0, quantities ≥ 1) and returns 201**
8. **details object is non-empty and identifies the offending line-item index or field**

Now let me think about how to structure this test. Looking at the plan:
- Tests use Vitest
- Import the app via NestJS test module
- The test files are in `test/` directory

I need to figure out the app structure. From the plan:
- `src/app.module.ts` is the root module
- Controllers handle validation (per the layer rules: "controller validates input and calls the service")

Wait, actually re-reading the plan more carefully:
- "controller validates input and calls the service. Zero business logic."
- The cases say "proves the service/controller validates each line item's price before delegating to the repository"

So validation happens at the controller or service level. The test should hit the HTTP endpoint.

Let me think about what the app module looks like. From the conventions:
- `src/main.ts` - bootstrap
- `src/app.module.ts` - root module

For the test, I'll use `Test.createTestingModule` from `@nestjs/testing`.

Now, for the cases that check "no invoice row persisted" and "account counters unchanged", I need to either:
1. Query the database directly after the rejected POST
2. Use the API to verify (GET the account, check counters)

Since the test should test behavior (not implementation), using the API to verify is better. But for "no invoice row persisted", I'd need to try to GET the invoice by ID - but we don't have an ID since creation failed. 

Actually, looking more carefully - if the POST returns 400, there's no invoice ID returned. So how do we verify no row was persisted? We could:
- Check the account's total_invoiced_cents hasn't changed (via GET /accounts/:id)
- For "no invoice row", we could check that the account's invoices list hasn't grown (via GET /invoices?accountId=...)

Let me think about the structure:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('POST /invoices — negative unit_price validation', () => {
  let app: INestApplication;
  // ... setup/teardown

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ... tests
});
```

Wait, but I need to think about what the endpoints look like. From the plan:
- POST /invoices - creates an invoice
- GET /accounts/:id - gets an account
- GET /invoices?accountId=... - lists invoices for an account

The CreateInvoiceDto likely has:
- accountId (string)
- lineItems: Array<{ description, unit_price_cents, quantity }>
- due_date? (optional)

Let me think about what fields are in the DTO. From the plan's data model:
- invoices has: account_id, status, subtotal_cents, tax_cents, total_cents, due_date
- line_items has: description, unit_price_cents, quantity, line_total_cents

The service computes subtotal/tax/total from the line items. The DTO for creating an invoice probably takes:
- accountId
- lineItems: [{ description, unit_price_cents, quantity }]
- due_date? (optional)
- tax_cents? (optional, default 0)

Actually, looking at the plan more carefully: "computed subtotal/tax/total" - so the service computes these. The DTO likely has:
- accountId: string
- lineItems: Array<{ description: string, unit_price_cents: number, quantity: number }>
- due_date?: string
- tax_cents?: number (default 0)

For the test, I need to:
1. Create an account first (to have a valid accountId)
2. Then try to create an invoice with negative unit_price_cents

Let me write the test now. I'll use `app.inject()` or `supertest` for HTTP calls. Actually, looking at NestJS testing, the standard approach is to use `app.getHttpServer()` with supertest, or use `app.inject()` (which is available in newer NestJS versions via `INestApplication.inject()`).

Actually, the most common pattern in NestJS tests is:
```ts
import * as request from 'supertest';
// then use request(app.getHttpServer()).post('/invoices')...
```

Or with the built-in:
```ts
await app.inject({ method: 'POST', url: '/invoices', payload: ... })
```

I'll use `supertest` as it's the most standard in NestJS test suites. Actually, let me use `app.inject()` since it's built into NestJS and doesn't require an extra dependency. Wait, actually `app.inject()` was added in NestJS 10+. Let me use supertest to be safe since it's the most common pattern.

Hmm, but I don't know if supertest is in the dependencies. Let me use `app.inject()` which is part of NestJS's test utilities (it wraps the underlying platform's request testing). Actually, looking at this more carefully - in NestJS, `INestApplication` has an `inject()` method that's been available since v8 or so. Let me use that.

Wait, actually the standard NestJS testing pattern uses:
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
```

And then for HTTP:
```ts
const server = app.getHttpServer();
// use supertest(server)
```

Or:
```ts
const response = await app.inject({
  method: 'POST',
  url: '/invoices',
  payload: { ... }
});
```

I'll go with `app.inject()` as it doesn't require supertest as a dependency and is part of the NestJS core.

Now let me think about the specific test cases:

1. **rejects unit_price_cents of −1 with HTTP 400 and code `validation_error`**
   - Create account, POST /invoices with one line item having unit_price_cents: -1
   - Expect 400, body.error.code === 'validation_error'

2. **rejects with the single error envelope shape**
   - Same request, check exact shape: `{ error: { code: "validation_error", message: <string>, details: <object> } }`
   - No extra top-level keys, details is object (not null)

3. **no invoice row or line-item row persisted after a rejected POST**
   - Create account, note initial invoice count via GET /invoices?accountId=...
   - POST with negative price → 400
   - GET /invoices?accountId=... → same count (no new invoice)

4. **account counters unchanged after a rejected POST**
   - Create account, note total_invoiced_cents and balance_cents
   - POST with negative price → 400
   - GET /accounts/:id → counters unchanged

5. **rejects when only the second of two line items carries a negative price**
   - POST with two line items, first valid, second has unit_price_cents: -1
   - Expect 400

6. **accepts unit_price_cents of 0**
   - POST with unit_price_cents: 0
   - Expect 201

7. **accepts a valid multi-line-item invoice**
   - POST with multiple valid line items
   - Expect 201

8. **details object is non-empty and identifies the offending line-item index or field**
   - POST with negative price, check details has content identifying the issue

Let me now write the complete test file. I need to be careful about:
- The DTO field names (camelCase in JSON? or snake_case?)
- Looking at the plan: "field presence, null vs missing" - the API contract uses the field names as they appear in the database (snake_case) since that's what Prisma would return by default with `@map`... 

Wait, actually Prisma returns the field names as defined in the schema (camelCase by default) unless you use `@map`. But the plan says "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". So the Prisma model fields would be camelCase but mapped to snake_case columns. The API response would use the Prisma field names (camelCase).

Hmm, but wait - looking at the DTO types in the plan:
- `AccountDto` has fields like... the plan mentions "BigInt→string format for money fields"
- The plan mentions `"total_cents":"0"` and `"balance_cents":"-50"` in the bigint-format test descriptions

So the API uses snake_case field names! That makes sense if the Prisma model uses `@map` for columns but the field names in the model are already snake_case, OR if the DTO explicitly maps to snake_case.

Actually, re-reading: the plan says `"total_cents":"0"` - this suggests the JSON response uses snake_case. This could be because:
1. The Prisma model fields are named in snake_case (unusual but possible)
2. Or there's a serialization layer that converts to snake_case

Given the plan explicitly shows `"total_cents":"0"` and `"balance_cents":"-50"`, I'll assume the API uses snake_case for field names in both request and response.

For the request body (CreateInvoiceDto), I'll use:
- `account_id`: string
- `line_items`: Array<{ description: string, unit_price_cents: number, quantity: number }>
- `due_date`?: string | null

Wait, but the plan says "DTOs are identical to the current Prisma version". In a typical NestJS app with Prisma, you'd have camelCase in the DTO. But the plan shows snake_case in the response examples...

Let me look at this differently. The plan's test descriptions use:
- `"total_cents":"0"` 
- `"balance_cents":"-50"`
- `"due_date":null`
- `"line_items":[]`

These are all snake_case. So the API contract uses snake_case field names. I'll go with that.

For the request, I'll assume:
```json
{
  "account_id": "...",
  "line_items": [
    { "description": "...", "unit_price_cents": 100, "quantity": 2 }
  ],
  "due_date": null
}
```

Now, for `app.inject()`, the payload should be the JSON body.

Let me also think about whether I need to handle the case where the app might not have a global exception filter that shapes errors. The plan mentions "global filter" that maps exceptions to the error envelope. I'll assume the AppModule includes this filter.

Let me write the test now:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('POST /invoices — negative unit_price_cents validation', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // Helper to create an account and return its id
  async function createAccount(name: string, email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { name, email },
    });
    expect(res.statusCode).toBe(201);
    return res.body.id as string;
  }

  // Case 1: rejects unit_price_cents of −1 with HTTP 400 and code validation_error
  it('rejects unit_price_cents of -1 with HTTP 400 and code validation_error', async () => {
    const accountId = await createAccount('Test Acct', `test-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Widget', unit_price_cents: -1, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // Case 2: rejects with the single error envelope shape
  it('returns the single error envelope shape with no extra keys', async () => {
    const accountId = await createAccount('Test Acct 2', `test2-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Widget', unit_price_cents: -5, quantity: 2 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.body;
    // Top level has exactly one key: "error"
    expect(Object.keys(body)).toEqual(['error']);
    // error has exactly code, message, details
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeInstanceOf(Object);
    expect(body.error.details).not.toBeNull();
  });

  // Case 3: no invoice row or line-item row persisted after a rejected POST
  it('persists no invoice or line-item rows after a rejected POST', async () => {
    const accountId = await createAccount('Test Acct 3', `test3-${Date.now()}@example.com`);

    // Verify initial state: no invoices
    const before = await app.inject({
      method: 'GET',
      url: `/invoices?account_id=${accountId}`,
    });
    expect(before.body).toEqual([]);

    // Attempt to create with negative price
    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Bad item', unit_price_cents: -10, quantity: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);

    // Verify no invoice was created
    const after = await app.inject({
      method: 'GET',
      url: `/invoices?account_id=${accountId}`,
    });
    expect(after.body).toEqual([]);
  });

  // Case 4: account counters unchanged after a rejected POST
  it('leaves account counters unchanged after a rejected POST', async () => {
    const accountId = await createAccount('Test Acct 4', `test4-${Date.now()}@example.com`);

    // Get initial account state
    const before = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}`,
    });
    expect(before.statusCode).toBe(200);
    const initialTotal = before.body.total_invoiced_cents;
    const initialBalance = before.body.balance_cents;

    // Attempt to create with negative price
    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Bad item', unit_price_cents: -100, quantity: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);

    // Verify counters unchanged
    const after = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}`,
    });
    expect(after.body.total_invoiced_cents).toBe(initialTotal);
    expect(after.body.balance_cents).toBe(initialBalance);
  });

  // Case 5: rejects when only the second of two line items carries a negative price
  it('rejects when only the second line item has a negative unit_price_cents', async () => {
    const accountId = await createAccount('Test Acct 5', `test5-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Good item', unit_price_cents: 100, quantity: 1 },
          { description: 'Bad item', unit_price_cents: -1, quantity: 2 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // Case 6: accepts unit_price_cents of 0 (boundary)
  it('accepts unit_price_cents of 0 as valid', async () => {
    const accountId = await createAccount('Test Acct 6', `test6-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Free item', unit_price_cents: 0, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 7: accepts a valid multi-line-item invoice
  it('accepts a valid multi-line-item invoice and returns 201', async () => {
    const accountId = await createAccount('Test Acct 7', `test7-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Item A', unit_price_cents: 500, quantity: 2 },
          { description: 'Item B', unit_price_cents: 300, quantity: 1 },
          { description: 'Item C', unit_price_cents: 0, quantity: 5 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 8: details object is non-empty and identifies the offending line-item
  it('includes identifying information in the details object', async () => {
    const accountId = await createAccount('Test Acct 8', `test8-${Date.now()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Good item', unit_price_cents: 100, quantity: 1 },
          { description: 'Bad item', unit_price_cents: -42, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const details = res.body.error.details;
    expect(Object.keys(details).length).toBeGreaterThan(0);
    // details should reference the offending item somehow (index or field name)
    const detailsStr = JSON.stringify(details);
    expect(detailsStr).toMatch(/1|unit_price_cents|line_?item/i);
  });
});
```

Wait, I need to reconsider a few things:

1. The query parameter for listing invoices - is it `account_id` or `accountId`? Looking at the plan: "GET /invoices?accountId=…" - it uses camelCase `accountId` in the query string. Let me use that.

2. For the account creation, what fields does the CreateAccountDto have? The plan mentions `name` and `email` as required fields. Let me use those.

3. The response field for the account - is it `id` or some other name? Standard would be `id`.

4. For the invoices list endpoint, the query param - the plan says "GET /invoices?accountId=…" so I'll use `accountId`.

Let me also reconsider the request body field names. The plan's test descriptions show:
- `"total_cents":"0"` - snake_case in response
- `"balance_cents":"-50"` - snake_case in response
- `"due_date":null` - snake_case in response
- `"line_items":[]` - snake_case in response

So responses use snake_case. For requests, it's likely the same convention. But I'm not 100% sure about the request field names. Let me think...

In a typical NestJS + Prisma setup, you'd have:
- Request DTOs in camelCase (TypeScript convention)
- Response DTOs matching the Prisma model field names

But the plan explicitly shows snake_case in responses. This could mean:
1. The Prisma model uses snake_case field names (with `@map` for columns, or the fields ARE the column names)
2. Or there's a serialization layer

Given the plan says "public API contract byte-compatible (field presence, null vs missing, numeric string formats)" and shows snake_case, I'll assume the entire API (request and response) uses snake_case.

Actually wait - let me re-read the conventions: "Table and column: `snake_case` (via Prisma `@map`/`@@map`)". This means the DATABASE columns are snake_case, but the Prisma model fields could be camelCase with `@map` to snake_case columns. In that case, the API response (which uses Prisma field names) would be camelCase.

But the plan explicitly shows `"total_cents":"0"` in the test descriptions. This is a direct contradiction unless:
1. The Prisma fields are named in snake_case (no @map needed, or @map to the same name)
2. Or there's a transformation layer

Given the plan is my specification and it shows snake_case in the API responses, I'll go with snake_case for both request and response field names.

Actually, you know what, let me look at this from a different angle. The plan says the API contract is "byte-compatible" with the existing Prisma version. The test descriptions in the plan use snake_case field names. So the existing API uses snake_case. I'll follow that.

For query parameters, the plan shows "GET /invoices?accountId=…" with camelCase. Hmm, that's inconsistent. Let me just use what the plan shows: `accountId` for the query param.

Wait, actually I just realized - maybe the plan is using `accountId` as a shorthand in the endpoint description, not the literal query parameter name. Let me use `account_id` to be consistent with the snake_case convention shown elsewhere.

Actually, I'll just go with what makes sense given the evidence. The plan shows:
- Response fields: snake_case (`total_cents`, `balance_cents`, `due_date`, `line_items`)
- Query param: `accountId` (from "GET /invoices?accountId=…")

This is a bit inconsistent but I'll follow the plan literally where it's explicit and use snake_case elsewhere.

Hmm, actually for safety, let me just use `account_id` for the query param too since that's more consistent with the rest of the API. The plan's "GET /invoices?accountId=…" is likely just a description, not a literal URL.

Let me finalize my test. One more consideration: the `app.inject()` method. In NestJS, this returns a `RequestResponse` object with `statusCode`, `body`, `headers`, etc. The `body` is already parsed JSON.

Let me also make sure I'm not missing anything from the cases file:

The "Deliberately not testing" section mentions:
- Concurrent duplicate submissions
- Postgres-level CHECK constraint

These are explicitly NOT tested, so I won't include them.

I think my test is comprehensive. Let me finalize it.
```

## reply

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('POST /invoices — negative unit_price_cents validation', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createAccount(name: string, email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { name, email },
    });
    expect(res.statusCode).toBe(201);
    return res.body.id as string;
  }

  it('rejects unit_price_cents of -1 with HTTP 400 and code validation_error', async () => {
    const accountId = await createAccount('Neg Price Acct', `neg-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Widget', unit_price_cents: -1, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns the single error envelope shape with no extra top-level keys', async () => {
    const accountId = await createAccount('Envelope Acct', `env-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Widget', unit_price_cents: -5, quantity: 2 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.body;

    // Top-level has exactly one key: "error"
    expect(Object.keys(body)).toEqual(['error']);

    // error object has exactly code, message, details
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeInstanceOf(Object);
    expect(body.error.details).not.toBeNull();
    expect(Array.isArray(body.error.details)).toBe(false);
  });

  it('persists no invoice or line-item rows after a rejected POST', async () => {
    const accountId = await createAccount('NoPersist Acct', `np-${Date.now()}-${Math.random()}@example.com`);

    // Confirm initial state: zero invoices
    const before = await app.inject({
      method: 'GET',
      url: `/invoices?account_id=${accountId}`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.body).toEqual([]);

    // Attempt creation with negative price
    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Bad item', unit_price_cents: -10, quantity: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);

    // Confirm no invoice was created
    const after = await app.inject({
      method: 'GET',
      url: `/invoices?account_id=${accountId}`,
    });
    expect(after.statusCode).toBe(200);
    expect(after.body).toEqual([]);
  });

  it('leaves account counters unchanged after a rejected POST', async () => {
    const accountId = await createAccount('Counter Acct', `ctr-${Date.now()}-${Math.random()}@example.com`);

    // Capture initial counters
    const before = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}`,
    });
    expect(before.statusCode).toBe(200);
    const initialTotal = before.body.total_invoiced_cents;
    const initialBalance = before.body.balance_cents;

    // Attempt creation with negative price
    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Bad item', unit_price_cents: -100, quantity: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);

    // Counters must be identical
    const after = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}`,
    });
    expect(after.statusCode).toBe(200);
    expect(after.body.total_invoiced_cents).toBe(initialTotal);
    expect(after.body.balance_cents).toBe(initialBalance);
  });

  it('rejects when only the second of two line items carries a negative unit_price_cents', async () => {
    const accountId = await createAccount('SecondItem Acct', `si-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Good item', unit_price_cents: 100, quantity: 1 },
          { description: 'Bad item', unit_price_cents: -1, quantity: 2 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('accepts unit_price_cents of 0 as a valid price', async () => {
    const accountId = await createAccount('ZeroPrice Acct', `zp-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Free item', unit_price_cents: 0, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('accepts a valid multi-line-item invoice and returns 201', async () => {
    const accountId = await createAccount('MultiValid Acct', `mv-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Item A', unit_price_cents: 500, quantity: 2 },
          { description: 'Item B', unit_price_cents: 300, quantity: 1 },
          { description: 'Item C', unit_price_cents: 0, quantity: 5 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('includes identifying information in the details object for the offending line item', async () => {
    const accountId = await createAccount('Details Acct', `det-${Date.now()}-${Math.random()}@example.com`);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        account_id: accountId,
        line_items: [
          { description: 'Good item', unit_price_cents: 100, quantity: 1 },
          { description: 'Bad item', unit_price_cents: -42, quantity: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const details = res.body.error.details;

    // details is a non-empty object
    expect(Object.keys(details).length).toBeGreaterThan(0);

    // details references the offending line item by index or field
    const detailsStr = JSON.stringify(details);
    expect(detailsStr).toMatch(/1|unit_price_cents|line_?item/i);
  });
});
```
