# repair1-null-vs-missing.spec.ts

## reasoning

```
The user is asking me to fix `test/null-vs-missing.spec.ts` which doesn't compile. However, the compiler errors shown are all for `test/void-invoice.spec.ts`, not `test/null-vs-missing.spec.ts`. The errors are all "Cannot find name 'expect'" and "Cannot find name 'it'" which suggests that the test runner types (vitest) are not being picked up.

Wait, let me re-read. The user says "test/null-vs-missing.spec.ts does not compile" but the compiler messages are all for `test/void-invoice.spec.ts`. This is confusing. Let me re-read the instruction:

"Rewrite `test/null-vs-missing.spec.ts` complete, fixing what these messages require of this file."

But the messages are all about `test/void-invoice.spec.ts`. The instruction says "These are the compiler's exact messages for the whole workspace — not a summary of them" — so maybe `test/null-vs-missing.spec.ts` has the same issue (missing vitest imports) but the errors just happen to be listed for void-invoice.spec.ts? Or maybe the compiler only reported errors for void-invoice.spec.ts and null-vs-missing.spec.ts has a different issue?

Wait, I need to re-read more carefully. The user says "test/null-vs-missing.spec.ts does not compile" and then shows compiler messages. The messages shown are all for `test/void-invoice.spec.ts`. But the instruction says "fixing what these messages require of this file" — meaning `test/null-vs-missing.spec.ts`.

The key issue is clear: the test files are using `expect`, `it`, `describe` without importing them from vitest. In Vitest with ESM, you need to explicitly import these:

```ts
import { describe, it, expect } from 'vitest';
```

This is the standard pattern for Vitest (unlike Jest where globals can be configured). The tsconfig likely doesn't have `"types": ["vitest/globals"]` or the equivalent, so the globals aren't available.

The fix for `test/null-vs-missing.spec.ts` is to ensure it imports `describe`, `it`, and `expect` from `'vitest'`.

Now, I need to write the complete `test/null-vs-missing.spec.ts` file. Based on the PLAN.md, this test file should cover:

- `test/null-vs-missing.spec.ts` — "due_date null is present-key-null" | Invoice with due_date NULL → JSON has `"due_date":null`, key is not absent
- `test/null-vs-missing.spec.ts` — "empty line_items is empty array" | Invoice created with `lineItems: []` → response `"line_items":[]` not missing

The test file uses NestJS test module, imports the app, and tests via HTTP calls.

Let me look at what I know about the project structure:
- NestJS app
- Vitest for tests
- The test files use `.spec.ts` in `test/`
- The app has endpoints: GET /accounts, POST /accounts, GET /invoices?accountId=..., GET /invoices/:id, POST /invoices, PATCH /invoices/:id/status

The test needs to:
1. Set up a NestJS test module
2. Create an account (POST /accounts)
3. Create an invoice without a due_date (so it's NULL in the DB)
4. GET /invoices/:id and verify that `due_date` is present as `null` in the JSON
5. Create an invoice with empty line_items array
6. GET /invoices/:id and verify `line_items` is `[]` not missing

The fix for the compilation error is simply adding the import from vitest:
```ts
import { describe, it, expect } from 'vitest';
```

Let me write the complete file. I'll follow the patterns from the plan and standard NestJS testing with Vitest.

Looking at the plan's test section:
- Tests use Vitest
- Import the app via NestJS test module

Let me construct this properly. The typical pattern for NestJS + Vitest:

```ts
import { Test } from '@nestjs/testing';
import { NestApplication } from '@nestjs/common';
// ... module imports

describe('null-vs-missing', () => {
  let app: NestApplication;
  
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
  
  it('due_date null is present-key-null', async () => {
    // ...
  });
  
  it('empty line_items is empty array', async () => {
    // ...
  });
});
```

Wait, but I also need `beforeAll` and `afterAll` from vitest. Let me include those too.

Now, for the actual test logic:

Test 1: "due_date null is present-key-null"
- Create an account
- Create an invoice with no due_date (or explicitly null)
- GET the invoice
- Verify `body.due_date === null` (key is present, value is null)

Test 2: "empty line_items is empty array"
- Create an account
- Create an invoice with `lineItems: []`
- GET the invoice
- Verify `body.line_items` is an array with length 0

Let me think about what the CreateInvoiceDto looks like. Based on the plan:
- `POST /invoices` takes a DTO with accountId, due_date (optional), lineItems array
- Each lineItem has description, unit_price_cents, quantity

For creating an invoice with no due_date, I'll just omit it or pass null.

Let me write the complete file now. I need to be careful about:
1. Importing from vitest (the fix)
2. Following the project conventions (kebab-case file names, etc.)
3. The test should actually make HTTP requests and assert on the response body

Let me also think about whether I need a database setup. The tests likely need a real database (PostgreSQL via DATABASE_URL). The plan says "import the app via NestJS test module" which suggests integration tests against a real DB.

Let me write this:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

// I need to import the AppModule or the relevant feature modules
```

Actually, looking at the project structure more carefully:
- `src/app.module.ts` exists
- The tests should import `AppModule`

Let me write the complete file:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
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

  it('due_date null is present-key-null', async () => {
    // Create an account
    const acctRes = await app.injector.get(...);
    // Actually, let's use supertest or raw HTTP
  });
});
```

Hmm, I need to think about how to make HTTP requests in the test. The common approaches:
1. `supertest` - most common for NestJS
2. `app.getHttpServer()` with raw node http
3. `fetch` against the running server

Looking at typical NestJS test setups with Vitest, `supertest` is common. But I don't know if it's in the dependencies. Let me use a simpler approach - start the app on a port and use fetch (Node 20+ has global fetch).

Actually, let me reconsider. The most standard NestJS testing pattern is:

```ts
const server = app.getHttpServer();
const response = await request(server).post('/accounts').send({...}).expect(201);
```

But that requires `supertest` (imported as `request`).

Alternatively, I can just start the app and use fetch:
```ts
await app.listen(0); // random port
const url = app.getHttpServer().address();
```

Actually, the simplest approach that's guaranteed to work with Node 20+ and doesn't require additional dependencies:

```ts
await app.listen(0);
const address = app.getHttpServer().address();
const baseUrl = `http://127.0.0.1:${address.port}`;
```

Then use `fetch` for requests.

Let me go with this approach since it doesn't require supertest as a dependency (which I can't confirm is installed).

Let me write the complete file:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${(address as any).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('due_date null is present-key-null', async () => {
    // Create account
    const acctRes = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Null Test', email: `null-test-${Date.now()}@example.com` }),
    });
    const account = await acctRes.json();

    // Create invoice without due_date
    const invRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        lineItems: [{ description: 'Item', unit_price_cents: 100, quantity: 1 }],
      }),
    });
    const invoice = await invRes.json();

    // Fetch the invoice by id
    const getRes = await fetch(`${baseUrl}/invoices/${invoice.id}`);
    const detail = await getRes.json();

    // due_date key must be present with value null
    expect('due_date' in detail).toBe(true);
    expect(detail.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    // Create account
    const acctRes = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empty Items', email: `empty-items-${Date.now()}@example.com` }),
    });
    const account = await acctRes.json();

    // Create invoice with empty lineItems
    const invRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        lineItems: [],
      }),
    });
    const invoice = await invRes.json();

    // Fetch the invoice by id
    const getRes = await fetch(`${baseUrl}/invoices/${invoice.id}`);
    const detail = await getRes.json();

    // line_items must be present and an empty array
    expect('line_items' in detail).toBe(true);
    expect(Array.isArray(detail.line_items)).toBe(true);
    expect(detail.line_items).toHaveLength(0);
  });
});
```

Wait, I need to think about whether the POST /invoices response already includes line_items or if I need to GET. The plan says:
- POST /invoices → 201; nested `line_items` present

So the POST response should already have line_items. But for the due_date test, I should check the GET response to be thorough (since the POST response might format things differently). Actually, let me check both - or just use the GET response for clarity since that's the "detail" view.

Actually, re-reading the plan:
- `GET /invoices/:id` → 200; nested `line_items` present

So the GET by id returns the detail with line_items. Let me use GET for both assertions to be safe.

But wait - does the POST /invoices response include `due_date`? Let me think... The InvoiceDto probably has all the invoice fields. Let me just use GET /invoices/:id for both tests to be consistent and test the "detail" endpoint.

Actually, I realize I should also consider: what if the POST response already shows the issue? Let me just test via GET to be safe and explicit about what we're testing.

Let me also reconsider the `address` type. In Node.js, `server.address()` returns `string | AddressInfo | null`. I need to handle this:

```ts
const address = app.getHttpServer().address();
if (typeof address === 'object' && address !== null) {
  baseUrl = `http://127.0.0.1:${address.port}`;
}
```

Or I can just cast it. Let me use a type assertion to keep it clean.

Actually, let me reconsider the whole approach. The compiler errors shown are all about missing `expect`, `it`, `describe` etc. The fix is simply to import them from vitest. The user said "fixing what these messages require of this file" - so the primary fix is the import.

But I need to write the complete file, so I need to make sure it's a valid, complete test file that follows the plan.

Let me also check: does `app.getHttpServer()` return a `http.Server`? In NestJS, yes. And `.address()` on it returns `string | AddressInfo | null`.

Let me finalize my answer. I'll use a clean approach:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
```

This should work. Let me write the final version.
```

## reply

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';

describe('null-vs-missing', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('due_date null is present-key-null', async () => {
    const acctRes = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Null Date Test',
        email: `null-date-${Date.now()}@example.com`,
      }),
    });
    expect(acctRes.status).toBe(201);
    const account = await acctRes.json();

    const invRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        lineItems: [{ description: 'Item', unit_price_cents: 100, quantity: 1 }],
      }),
    });
    expect(invRes.status).toBe(201);
    const invoice = await invRes.json();

    const getRes = await fetch(`${baseUrl}/invoices/${invoice.id}`);
    expect(getRes.status).toBe(200);
    const detail = await getRes.json();

    expect('due_date' in detail).toBe(true);
    expect(detail.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    const acctRes = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Empty Items Test',
        email: `empty-items-${Date.now()}@example.com`,
      }),
    });
    expect(acctRes.status).toBe(201);
    const account = await acctRes.json();

    const invRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        lineItems: [],
      }),
    });
    expect(invRes.status).toBe(201);
    const invoice = await invRes.json();

    const getRes = await fetch(`${baseUrl}/invoices/${invoice.id}`);
    expect(getRes.status).toBe(200);
    const detail = await getRes.json();

    expect('line_items' in detail).toBe(true);
    expect(Array.isArray(detail.line_items)).toBe(true);
    expect(detail.line_items).toHaveLength(0);
  });
});
```
