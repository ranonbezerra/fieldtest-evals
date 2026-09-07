# 09-bigint-format.spec.ts

## reasoning

```
Let me analyze what I need to write for `test/bigint-format.spec.ts`.

From the plan (§5), this file covers:
- "zero-amount invoice serialises as '0'" — total_cents=0 → `"total_cents":"0"` (string, not number, not omitted)
- "negative balance serialises with minus sign" — balance_cents=-50 → `"balance_cents":"-50"`

From the cases file, I need to cover ALL of these:
1. Zero invoice total serialises as the string `"0"`
2. Negative account balance serialises as a signed string (e.g. `"-50"`)
3. A bigint value exceeding `Number.MAX_SAFE_INTEGER` round-trips exactly
4. `quantity` on a line item is a JSON number, not a string
5. All three bigint fields on an account (`credit_limit_cents`, `balance_cents`, `total_invoiced_cents`) are strings simultaneously in the same response body
6. All three bigint fields on an invoice (`subtotal_cents`, `tax_cents`, `total_cents`) are strings simultaneously, and the nested `line_items` array carries its own bigint fields (`unit_price_cents`, `line_total_cents`) as strings while `quantity` remains a number

Now let me think about how to structure this. The test file should:
- Use Vitest
- Test the serialisation shape (BigInt→string)
- Use NestJS test module to spin up the app
- Hit endpoints and verify the wire format

I need to think about what imports I'll need. Looking at the project structure:
- `src/app.module.ts` — the app module
- Tests in `test/` directory

For NestJS testing, I'll use `Test.createTestingModule` from `@nestjs/testing`.

Let me think about the structure:

1. **Zero invoice total serialises as "0"**: Create an account, create an invoice with all zero amounts (subtotal=0, tax=0, total=0), GET it, verify `total_cents` is `"0"` (string).

2. **Negative account balance serialises as "-50"**: Create an account, create an invoice that makes the balance negative (e.g., total_invoiced > credit_limit), GET the account, verify `balance_cents` is a negative string.

Wait, actually looking at the logic: `balance_cents = balance_cents - invoice.total`. So if I create an account with balance 0 and an invoice with total 50, the balance becomes -50.

3. **BigInt exceeding Number.MAX_SAFE_INTEGER**: This is tricky. I need a value > 2^53 - 1. That's 9007199254740991. I'd need to set up an account with a very large credit_limit_cents or balance_cents. But how do I set that? Through the API, I'd need to create an account with a large credit limit, or create invoices with large totals.

Actually, looking at the repository, `create` on accounts takes an `AccountInsert`. The DTO for creating an account likely has `credit_limit_cents` as a number. If I pass a large number like 9007199254740993 (which exceeds MAX_SAFE_INTEGER), it might get rounded by JSON parsing. 

Hmm, this is tricky. Let me think differently. I could directly insert into the database in the test setup (using the Drizzle client) to set up a row with a large bigint value, then GET it through the API and verify the string is exact.

Wait, but the plan says "Test the behaviour, not the implementation." And the cases file says this is about proving the serialisation calls `BigInt.prototype.toString()` directly rather than coercing through `Number`. So I need a value that would lose precision if coerced through Number.

The most defensible approach: in the test setup, use the Drizzle db directly to insert/update a row with a bigint value exceeding MAX_SAFE_INTEGER, then hit the GET endpoint and verify the string is exact.

Actually wait - let me reconsider. The tests should test behaviour through the public API. But for setup, I can use the database directly (that's just fixture setup, not testing implementation). Let me look at how other test files might be structured...

I don't have access to other test files, so I'll use the standard NestJS testing pattern: create the test module with the app module, get a reference to the DB (or use the repository to set up data), then make HTTP calls.

Actually, for setting up a value > MAX_SAFE_INTEGER, I think the cleanest approach is to use `databaseOverrides` or to inject the DB and do a raw update in `beforeEach`. Let me think...

In NestJS testing, I can do:
```ts
const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
const app = moduleRef.createNestApplication();
await app.init();
```

Then I can get the DB from the module:
```ts
const db = moduleRef.get(Db);
```

And use it to set up fixture data with large bigint values.

Let me structure the test file:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
// ... other imports
```

Wait, I need to think about what the app module exports. Looking at the plan, there's a `DatabaseModule` that provides the `DB` token. The `AppModule` imports feature modules.

For the test, I'll:
1. Create the test module with `AppModule`
2. Get a reference to the DB for fixture setup
3. Use `app.inject()` or `supertest`-style calls... 

Actually, looking at the conventions, they use NestJS. In NestJS tests, you typically use `app.inject()` which returns a response object, or you can use the app's HTTP adapter.

Let me think about what's most standard for NestJS + Vitest. The typical pattern is:

```ts
const server = app.getHttpServer();
// then use supertest on server
```

Or with NestJS built-in:
```ts
const response = await app.inject().get('/accounts').expect();
```

Actually `app.inject()` is the newer NestJS way (built on top of `@nestjs/platform-express` or similar). Let me use that.

Wait, actually in NestJS, `app.inject()` returns a supertest-like interface. Let me use the pattern:

```ts
const response = await app.inject().get('/accounts').send();
const body = response.json();
```

Or I could use `app.getHttpAdapter().getInstance()` to get the raw server and use supertest.

Let me go with `app.inject()` as it's the most NestJS-idiomatic.

Now for the large bigint case: I need to set up a row with a value > Number.MAX_SAFE_INTEGER. The cleanest way in a test is to use the DB directly for fixture setup.

Let me think about the imports I need:
- `Test` from `@nestjs/testing`
- `INestApplication` from `@nestjs/common`
- `beforeEach, afterEach, describe, it, expect` from `vitest`
- `AppModule` from `../src/app.module`
- `DB` from `../src/db/database.module`
- Schema imports for setting up data

Actually, wait. Let me reconsider the approach for the > MAX_SAFE_INTEGER test. If I'm using `app.inject()` for API calls, I need the app to be running with a real database. For fixture setup of a large bigint, I'll inject the DB and do an insert/update directly.

Let me draft the full file:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB } from '../src/db/database.module';
import type { DrizzleDb } from '../src/db/client';
import { accounts, invoices, lineItems } from '../src/db/schema';

describe('BigInt wire format', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables (order matters for FKs)
    await db.delete(lineItems);
    await db.delete(invoices);
    await db.delete(accounts);
  });

  // ... tests
});
```

Now let me write each test case:

**Case 1: Zero invoice total serialises as "0"**
- Create an account
- Create an invoice with zero amounts (no line items, or line items that sum to 0)
- GET the invoice
- Verify `total_cents` is `"0"` (a string)

Wait, can I create an invoice with total 0? Looking at the create flow: the service computes subtotal/tax/total from line items. If I pass no line items, what happens? Let me think...

The plan says: "If `lineItems.length > 0`, INSERT all rows into `line_items`". So empty line items is allowed. And the total would be 0 if there are no items and no tax.

But wait, the DTO for creating an invoice - what does it look like? From the plan:
```ts
create(dto: CreateInvoiceDto): Promise<InvoiceDto>;
```

I don't have the exact DTO shape, but it likely has `account_id`, `line_items` (array), and maybe `tax_cents`. Let me think about what's defensible.

Actually, looking at the invoices table: `subtotal_cents`, `tax_cents`, `total_cents`. The service computes these. If I create an invoice with no line items and tax=0, the total should be 0.

Let me assume the CreateInvoiceDto looks like:
```ts
{
  account_id: string;
  tax_cents?: number; // defaults to 0
  line_items: Array<{ description: string; unit_price_cents: number; quantity: number }>;
  due_date?: string;
}
```

For the zero case, I'll create an invoice with `line_items: []` and no tax.

**Case 2: Negative account balance serialises as "-50"**
- Create an account (balance starts at 0)
- Create an invoice with total 50 (e.g., one line item: price=50, qty=1)
- GET the account
- Verify `balance_cents` is `"-50"`

**Case 3: BigInt exceeding Number.MAX_SAFE_INTEGER**
- Directly insert an account with `credit_limit_cents` = 9007199254740993n (which is 2^53 + 1, exceeds MAX_SAFE_INTEGER of 2^53 - 1)
- GET the account
- Verify `credit_limit_cents` is `"9007199254740993"` (exact string, not rounded)

**Case 4: quantity is a number, not a string**
- Create an invoice with line items
- GET the invoice (which includes line_items)
- Verify `line_items[0].quantity` is a number (typeof 'number'), not a string

**Case 5: All three bigint fields on account are strings simultaneously**
- Create an account with non-zero credit_limit_cents
- GET the account
- Verify `credit_limit_cents`, `balance_cents`, `total_invoiced_cents` are all strings

**Case 6: All three bigint fields on invoice are strings, line_items bigints are strings, quantity is number**
- Create an invoice with line items
- GET the invoice detail
- Verify `subtotal_cents`, `tax_cents`, `total_cents` are all strings
- Verify each line item's `unit_price_cents` and `line_total_cents` are strings
- Verify each line item's `quantity` is a number

Now, for the API calls, I need to know the endpoint shapes. From the plan:
- GET /accounts → array of accounts
- GET /accounts/:id → single account
- POST /accounts → create account
- GET /invoices?accountId=... → array of invoices for account
- GET /invoices/:id → single invoice with line_items
- POST /invoices → create invoice
- PATCH /invoices/:id/status → update status

For creating an account via POST /accounts, the DTO likely is:
```ts
{ name: string; email: string; credit_limit_cents?: number }
```

Let me now think about how `app.inject()` works in NestJS. It returns a supertest-like interface:

```ts
const response = await app.inject().get('/accounts').expect();
// or
const response = await app.inject().get('/accounts');
const body = response.json();
const status = response.statusCode;
```

Actually, I recall that in NestJS, `app.inject()` returns a `Request` object from `supertest` (or the internal equivalent). The typical usage:

```ts
const res = await app.inject().get('/accounts').expect(200);
const body = res.json();
```

Or without `.expect()`:
```ts
const res = await app.inject().get('/accounts');
const body = res.json();
```

Let me use the pattern without `.expect()` so I can assert on status codes explicitly where needed, or use `.expect()` for brevity when I'm confident.

Actually, for cleanliness, let me just use:
```ts
const res = await app.inject().get('/accounts');
expect(res.statusCode).toBe(200);
const body = res.json();
```

Hmm, but that's verbose. Let me use a helper or just be concise where the status is obvious.

Let me also think about the `beforeEach` cleanup. I'm using `db.delete(table)` which in Drizzle translates to `DELETE FROM table`. This should work for cleanup.

Wait, but I need to be careful: if there are FK constraints, I need to delete in the right order (children first). The order is: line_items → invoices → accounts. That's what I have.

Now, for the large bigint test, I need to insert directly. In Drizzle:
```ts
await db.insert(accounts).values({
  id: 'some-uuid',
  name: 'Test',
  email: 'test@example.com',
  credit_limit_cents: 9007199254740993n,
  balance_cents: 0n,
  total_invoiced_cents: 0n,
});
```

Wait, but `credit_limit_cents` is a bigint column. In Drizzle with default mode 'bigint', the insert value should be a `BigInt`. So `9007199254740993n` is correct.

Actually, let me double-check: the plan says "Drizzle `bigint` columns use default mode `'bigint'` so repositories return JS `BigInt`". So yes, inserts and selects use BigInt.

Let me also think about the POST /accounts DTO. The `credit_limit_cents` in the DTO would be a number (since it comes from JSON). When the service passes it to the repository, it would be converted to BigInt somehow. Let me think...

Actually, looking at the repository:
```ts
async create(input: AccountInsert): Promise<AccountRow> {
  const id = input.id ?? randomUUID();
  const [row] = await this.db.insert(accounts).values({ ...input, id }).returning();
  return row;
}
```

And `AccountInsert` is `InferInsertModel<typeof accounts>`. For a bigint column with mode 'bigint', the insert type would be `BigInt`. So the service must be converting the number from the DTO to BigInt before calling the repository.

For my test, when I POST /accounts with a JSON body, `credit_limit_cents` will be a number in the JSON. The service/controller will handle the conversion. For normal values this is fine. For the > MAX_SAFE_INTEGER case, I can't send it via JSON (JSON numbers lose precision), which is why I need to insert directly for that test.

OK let me now write the complete file. Let me be careful about:
1. The exact import paths (relative from `test/` to `src/`)
2. The endpoint shapes
3. The DTO field names (snake_case based on the schema)

For import paths from `test/`:
- `../src/app.module` → AppModule
- `../src/db/database.module` → DB
- `../src/db/client` → DrizzleDb type
- `../src/db/schema` → tables

Let me write it out:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB } from '../src/db/database.module';
import type { DrizzleDb } from '../src/db/client';
import { accounts, invoices, lineItems } from '../src/db/schema';

describe('BigInt wire format', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.delete(lineItems);
    await db.delete(invoices);
    await db.delete(accounts);
  });

  it('zero invoice total serialises as the string "0"', async () => {
    // Setup: create account and zero-amount invoice
    const acctRes = await app.inject().post('/accounts').send({
      name: 'Zero Co',
      email: 'zero@example.com',
    });
    const account = acctRes.json();

    const invRes = await app.inject().post('/invoices').send({
      account_id: account.id,
      line_items: [],
    });
    const invoice = invRes.json();

    expect(invoice.total_cents).toBe('0');
    expect(typeof invoice.total_cents).toBe('string');
  });

  it('negative account balance serialises as a signed string', async () => {
    // Setup: create account (balance starts at 0), then an invoice totalling 50
    const acctRes = await app.inject().post('/accounts').send({
      name: 'Debit Co',
      email: 'debit@example.com',
    });
    const account = acctRes.json();

    await app.inject().post('/invoices').send({
      account_id: account.id,
      line_items: [{ description: 'Service', unit_price_cents: 50, quantity: 1 }],
    });

    const getRes = await app.inject().get(`/accounts/${account.id}`);
    const body = getRes.json();

    expect(body.balance_cents).toBe('-50');
    expect(typeof body.balance_cents).toBe('string');
  });

  it('a bigint value exceeding Number.MAX_SAFE_INTEGER round-trips exactly', async () => {
    const largeValue = 9007199254740993n; // 2^53 + 1, exceeds MAX_SAFE_INTEGER
    const id = 'aabbccdd-0000-0000-0000-000000000001';

    await db.insert(accounts).values({
      id,
      name: 'Large Co',
      email: 'large@example.com',
      credit_limit_cents: largeValue,
      balance_cents: 0n,
      total_invoiced_cents: 0n,
    });

    const res = await app.inject().get(`/accounts/${id}`);
    const body = res.json();

    expect(body.credit_limit_cents).toBe('9007199254740993');
  });

  it('quantity on a line item is a JSON number, not a string', async () => {
    const acctRes = await app.inject().post('/accounts').send({
      name: 'Qty Co',
      email: 'qty@example.com',
    });
    const account = acctRes.json();

    const invRes = await app.inject().post('/invoices').send({
      account_id: account.id,
      line_items: [{ description: 'Widget', unit_price_cents: 100, quantity: 3 }],
    });
    const invoice = invRes.json();

    expect(invoice.line_items[0].quantity).toBe(3);
    expect(typeof invoice.line_items[0].quantity).toBe('number');
  });

  it('all three bigint fields on an account are strings simultaneously', async () => {
    const acctRes = await app.inject().post('/accounts').send({
      name: 'Multi Co',
      email: 'multi@example.com',
      credit_limit_cents: 1000,
    });
    const account = acctRes.json();

    expect(typeof account.credit_limit_cents).toBe('string');
    expect(typeof account.balance_cents).toBe('string');
    expect(typeof account.total_invoiced_cents).toBe('string');

    // Verify they are the expected values
    expect(account.credit_limit_cents).toBe('1000');
    expect(account.balance_cents).toBe('0');
    expect(account.total_invoiced_cents).toBe('0');
  });

  it('all three bigint fields on an invoice are strings; line-item bigints are strings while quantity stays a number', async () => {
    const acctRes = await app.inject().post('/accounts').send({
      name: 'Full Co',
      email: 'full@example.com',
    });
    const account = acctRes.json();

    const invRes = await app.inject().post('/invoices').send({
      account_id: account.id,
      line_items: [
        { description: 'Item A', unit_price_cents: 250, quantity: 2 },
        { description: 'Item B', unit_price_cents: 75, quantity: 4 },
      ],
    });
    const invoice = invRes.json();

    // Invoice-level bigint fields are strings
    expect(typeof invoice.subtotal_cents).toBe('string');
    expect(typeof invoice.tax_cents).toBe('string');
    expect(typeof invoice.total_cents).toBe('string');

    // Line-item bigint fields are strings
    for (const item of invoice.line_items) {
      expect(typeof item.unit_price_cents).toBe('string');
      expect(typeof item.line_total_cents).toBe('string');
      // Quantity is a number
      expect(typeof item.quantity).toBe('number');
    }

    // Verify actual values
    expect(invoice.subtotal_cents).toBe('850'); // 250*2 + 75*4 = 500 + 300
    expect(invoice.tax_cents).toBe('0');
    expect(invoice.total_cents).toBe('850');
  });
});
```

Wait, I need to double-check the subtotal calculation: 250*2 = 500, 75*4 = 300, total = 800. Let me recalculate: 500 + 300 = 800. So subtotal should be 800, not 850. Let me fix that.

Actually wait: unit_price_cents * quantity = line_total_cents.
- Item A: 250 * 2 = 500
- Item B: 75 * 4 = 300
- subtotal = 500 + 300 = 800

Yes, subtotal should be '800'.

Let me also reconsider: does the POST /invoices response include line_items? Looking at the plan:
- `GET /invoices/:id` → returns `InvoiceDetailDto` with nested line_items
- `POST /invoices` → returns `InvoiceDto`

The plan says:
```ts
create(dto: CreateInvoiceDto): Promise<InvoiceDto>;
get(id: string): Promise<InvoiceDetailDto>;
```

So POST returns `InvoiceDto` (without line_items?) and GET by id returns `InvoiceDetailDto` (with line_items).

Hmm, but the test cases file says for case 4: "quantity on a line item is a JSON number" — this implies I need to GET the invoice by id to see line_items.

Let me adjust: for tests that need line_items, I'll use GET /invoices/:id instead of relying on the POST response.

Actually wait, let me re-read the plan more carefully:

From §5:
- "creates invoice with line items" — POST /invoices → 201; nested `line_items` present

So the plan says the POST response DOES include line_items. Let me look at the service signature again:

```ts
create(dto: CreateInvoiceDto): Promise<InvoiceDto>;
```

But the test says "nested line_items present" in the POST response. So either `InvoiceDto` includes line_items, or the service returns something richer for create.

Looking at the plan's test table: "POST /invoices → 201; nested `line_items` present; total = sum(line_totals) + tax"

OK so the POST /invoices response does include line_items. That makes sense from a UX perspective - you create an invoice and want to see it immediately with its items.

So I'll use the POST response for line_items where convenient, and GET /invoices/:id where I need the full detail.

Actually, to be safe and explicit, let me use GET /invoices/:id for tests that inspect line_items, since that's the canonical "get full invoice" endpoint.

Let me revise:

For case 4 (quantity is number): POST to create, then GET /invoices/:id to get the detail with line_items.
For case 6 (all bigint fields on invoice + line items): Same approach.

Actually, you know what, let me just use the POST response since the plan explicitly says line_items are present there. If it works, great. But to be safe, let me use GET for the detailed inspection.

Let me also reconsider case 1 (zero total). If I POST with empty line_items, the response should have total_cents as "0". Let me use the POST response for this.

Let me finalize:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB } from '../src/db/database.module';
import type { DrizzleDb } from '../src/db/client';
import { accounts, invoices, lineItems } from '../src/db/schema';

describe('BigInt wire format', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.delete(lineItems);
    await db.delete(invoices);
    await db.delete(accounts);
  });

  it('zero invoice total serialises as the string "0"', async () => {
    const { id: accountId } = await createAccount('zero@example.com');

    const res = await app
      .inject()
      .post('/invoices')
      .send({ account_id: accountId, line_items: [] });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.total_cents).toBe('0');
    expect(typeof body.total_cents).toBe('string');
  });

  it('negative account balance serialises as a signed string', async () => {
    const { id: accountId } = await createAccount('debit@example.com');

    await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Charge', unit_price_cents: 50, quantity: 1 }],
      });

    const res = await app.inject().get(`/accounts/${accountId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balance_cents).toBe('-50');
    expect(typeof body.balance_cents).toBe('string');
  });

  it('a bigint value exceeding Number.MAX_SAFE_INTEGER round-trips exactly', async () => {
    const id = 'aabbccdd-0000-0000-0000-000000000001';
    const largeValue = 9007199254740993n; // 2⁵³ + 1

    await db.insert(accounts).values({
      id,
      name: 'Large Co',
      email: 'large@example.com',
      credit_limit_cents: largeValue,
      balance_cents: 0n,
      total_invoiced_cents: 0n,
    });

    const res = await app.inject().get(`/accounts/${id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credit_limit_cents).toBe('9007199254740993');
  });

  it('quantity on a line item is a JSON number, not a string', async () => {
    const { id: accountId } = await createAccount('qty@example.com');

    const createRes = await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Widget', unit_price_cents: 100, quantity: 3 }],
      });
    const invoiceId = createRes.json().id;

    const res = await app.inject().get(`/invoices/${invoiceId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.line_items[0].quantity).toBe(3);
    expect(typeof body.line_items[0].quantity).toBe('number');
  });

  it('all three bigint fields on an account are strings simultaneously', async () => {
    const res = await app
      .inject()
      .post('/accounts')
      .send({ name: 'Multi Co', email: 'multi@example.com', credit_limit_cents: 1000 });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(typeof body.credit_limit_cents).toBe('string');
    expect(typeof body.balance_cents).toBe('string');
    expect(typeof body.total_invoiced_cents).toBe('string');
    expect(body.credit_limit_cents).toBe('1000');
    expect(body.balance_cents).toBe('0');
    expect(body.total_invoiced_cents).toBe('0');
  });

  it('all three bigint fields on an invoice are strings; line-item bigints are strings while quantity stays a number', async () => {
    const { id: accountId } = await createAccount('full@example.com');

    const createRes = await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [
          { description: 'Item A', unit_price_cents: 250, quantity: 2 },
          { description: 'Item B', unit_price_cents: 75, quantity: 4 },
        ],
      });
    const invoiceId = createRes.json().id;

    const res = await app.inject().get(`/invoices/${invoiceId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Invoice-level
    expect(typeof body.subtotal_cents).toBe('string');
    expect(typeof body.tax_cents).toBe('string');
    expect(typeof body.total_cents).toBe('string');
    expect(body.subtotal_cents).toBe('800'); // 250×2 + 75×4
    expect(body.tax_cents).toBe('0');
    expect(body.total_cents).toBe('800');

    // Line-item level
    for (const item of body.line_items) {
      expect(typeof item.unit_price_cents).toBe('string');
      expect(typeof item.line_total_cents).toBe('string');
      expect(typeof item.quantity).toBe('number');
    }
  });

  // --- helper ---
  async function createAccount(email: string) {
    const res = await app
      .inject()
      .post('/accounts')
      .send({ name: email.split('@')[0], email });
    return res.json();
  }
});
```

Hmm wait, I'm using a helper function `createAccount` inside the describe block. In Vitest, that should work fine as it's just a regular function in scope.

Let me review once more:

1. ✅ Zero invoice total → "0" string
2. ✅ Negative balance → "-50" string
3. ✅ > MAX_SAFE_INTEGER → exact string
4. ✅ quantity is number not string
5. ✅ All three account bigint fields are strings simultaneously
6. ✅ All three invoice bigint fields + line-item bigints are strings, quantity is number

The cases file also mentions: "Not testing here: business rules for how subtotal/tax/total are computed, validation of negative or zero amounts at input time, and the transactional visibility of counter updates."

I'm not testing any of those, good.

One concern: in case 6, I'm verifying `subtotal_cents` is '800'. This is asserting a computed value. The cases file says "Not testing here: business rules for how subtotal/tax/total are *computed*". But I'm not really testing the computation logic - I'm testing that the values that ARE computed get serialized as strings. The specific value '800' is just a way to confirm I'm looking at the right field. I think this is fine - it's not a test of the business rule, it's confirming the field identity while asserting the type.

Actually, to be safe and stay purely in "serialisation shape" territory, maybe I should just assert the types without asserting specific values for the computed fields. But then how do I know I'm looking at the right field? The type assertion `typeof body.subtotal_cents === 'string'` is sufficient to prove the serialisation. The value assertion is a bonus that confirms correctness.

I'll keep the value assertions - they make the tests more robust and don't violate the "not testing business rules" guideline because I'm not testing edge cases of computation, just verifying a simple case works.

Let me also make sure the file is self-contained and complete. I think it is. Let me do a final check on imports and make sure nothing is missing.

Actually, one more thought: should I use `beforeEach` for cleanup or `afterEach`? `beforeEach` is safer because it ensures a clean state before each test regardless of whether the previous test left mess. I'll keep `beforeEach`.

Also, I should make sure the `db.delete()` calls work correctly. In Drizzle, `db.delete(table)` without a where clause deletes all rows. This is equivalent to `DELETE FROM table`. With FK constraints, I need to delete children first: line_items → invoices → accounts. ✅

I think the file is ready. Let me write the final version.
```

## reply

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB } from '../src/db/database.module';
import type { DrizzleDb } from '../src/db/client';
import { accounts, invoices, lineItems } from '../src/db/schema';

describe('BigInt wire format', () => {
  let app: INestApplication;
  let db: DrizzleDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.delete(lineItems);
    await db.delete(invoices);
    await db.delete(accounts);
  });

  it('zero invoice total serialises as the string "0"', async () => {
    const { id: accountId } = await createAccount('zero@example.com');

    const res = await app
      .inject()
      .post('/invoices')
      .send({ account_id: accountId, line_items: [] });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.total_cents).toBe('0');
    expect(typeof body.total_cents).toBe('string');
  });

  it('negative account balance serialises as a signed string', async () => {
    const { id: accountId } = await createAccount('debit@example.com');

    await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Charge', unit_price_cents: 50, quantity: 1 }],
      });

    const res = await app.inject().get(`/accounts/${accountId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balance_cents).toBe('-50');
    expect(typeof body.balance_cents).toBe('string');
  });

  it('a bigint value exceeding Number.MAX_SAFE_INTEGER round-trips exactly', async () => {
    const id = 'aabbccdd-0000-0000-0000-000000000001';
    const largeValue = 9007199254740993n; // 2⁵³ + 1

    await db.insert(accounts).values({
      id,
      name: 'Large Co',
      email: 'large@example.com',
      credit_limit_cents: largeValue,
      balance_cents: 0n,
      total_invoiced_cents: 0n,
    });

    const res = await app.inject().get(`/accounts/${id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credit_limit_cents).toBe('9007199254740993');
  });

  it('quantity on a line item is a JSON number, not a string', async () => {
    const { id: accountId } = await createAccount('qty@example.com');

    const createRes = await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Widget', unit_price_cents: 100, quantity: 3 }],
      });
    const invoiceId = createRes.json().id;

    const res = await app.inject().get(`/invoices/${invoiceId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.line_items[0].quantity).toBe(3);
    expect(typeof body.line_items[0].quantity).toBe('number');
  });

  it('all three bigint fields on an account are strings simultaneously', async () => {
    const res = await app
      .inject()
      .post('/accounts')
      .send({ name: 'Multi Co', email: 'multi@example.com', credit_limit_cents: 1000 });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(typeof body.credit_limit_cents).toBe('string');
    expect(typeof body.balance_cents).toBe('string');
    expect(typeof body.total_invoiced_cents).toBe('string');
    expect(body.credit_limit_cents).toBe('1000');
    expect(body.balance_cents).toBe('0');
    expect(body.total_invoiced_cents).toBe('0');
  });

  it('all three bigint fields on an invoice are strings; line-item bigints are strings while quantity stays a number', async () => {
    const { id: accountId } = await createAccount('full@example.com');

    const createRes = await app
      .inject()
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [
          { description: 'Item A', unit_price_cents: 250, quantity: 2 },
          { description: 'Item B', unit_price_cents: 75, quantity: 4 },
        ],
      });
    const invoiceId = createRes.json().id;

    const res = await app.inject().get(`/invoices/${invoiceId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Invoice-level bigint fields are strings
    expect(typeof body.subtotal_cents).toBe('string');
    expect(typeof body.tax_cents).toBe('string');
    expect(typeof body.total_cents).toBe('string');
    expect(body.subtotal_cents).toBe('800'); // 250×2 + 75×4
    expect(body.tax_cents).toBe('0');
    expect(body.total_cents).toBe('800');

    // Line-item bigint fields are strings; quantity remains a number
    for (const item of body.line_items) {
      expect(typeof item.unit_price_cents).toBe('string');
      expect(typeof item.line_total_cents).toBe('string');
      expect(typeof item.quantity).toBe('number');
    }
  });

  async function createAccount(email: string) {
    const res = await app
      .inject()
      .post('/accounts')
      .send({ name: email.split('@')[0], email });
    return res.json();
  }
});
```
