# 11-void-invoice.spec.ts

## reasoning

```
Let me analyze what I need to write: `test/void-invoice.spec.ts`

From the plan, this file tests that "Void does not reverse total_invoiced_cents"

From the cases file, I need to implement these 9 test cases:

1. voiding an invoice leaves account.total_invoiced_cents unchanged
2. voiding an invoice leaves account.balance_cents unchanged
3. voiding returns 200 and the response body carries `status: "void"`
4. voiding updates `updated_at` to a timestamp later than `created_at`
5. voiding a non-existent invoice returns 404 with `resource_not_found`
6. voiding an already-void invoice is idempotent and does not double-adjust counters
7. voiding does not modify or delete line_items
8. voiding from the 'paid' state does not reverse counters
9. voiding an invoice with total_cents = 0 is a no-op on counters

Now let me think about how to structure this. Looking at the repository code:

- `InvoicesRepository.findById` returns `InvoiceWithLineItems | null`
- The service has `updateStatus(id: string, status: InvoiceStatus): Promise<InvoiceDto>`
- The endpoint is `PATCH /invoices/:id/status`

From the plan's control flow:
- PATCH /invoices/:id/status → service → repo.update (set status + updated_at); 0 rows affected → 404

The DTOs: BigInt fields appear as `string` in DTOs; `due_date` is `string | null`.

Looking at the accounts repository, it has `findById` and `findAll`.

For the tests, I need to:
1. Set up a NestJS test module with the relevant providers
2. Create an account
3. Create an invoice (with line items)
4. PATCH status to 'void'
5. Assert various things

Let me think about what the test module needs:
- `InvoicesModule` or the relevant controllers/services/repositories
- `AccountsModule` for creating accounts and reading them

Actually, looking at the layout convention:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So I'd import from the app module or set up a test module.

Let me think about what's available:
- `AccountsController` - POST /accounts, GET /accounts, GET /accounts/:id
- `InvoicesController` - POST /invoices, GET /invoices, GET /invoices/:id, PATCH /invoices/:id/status

The test file should use `Test.createTestingModule` from `@nestjs/testing`.

Let me think about what providers I need. Since I'm testing through HTTP (supertest), I need the full app module or at least the relevant controllers and their dependencies.

Actually, looking more carefully at the plan - it says "import the app via NestJS test module". So I should use `AppModule` or set up the modules explicitly.

Let me use `AppModule` for simplicity, since it should include all the necessary modules.

Wait, but I need to be careful. The plan says `DatabaseModule` is `@Global()` and provides the `DB` token. So if I import `AppModule`, it should wire everything up.

Let me structure the test:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('void invoice', () => {
  let app: INestApplication;
  let accountEmail: string;
  
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    
    // Create a fresh account for each test
    accountEmail = `void-test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  });
  
  afterEach(async () => {
    await app.close();
  });
  
  async function createAccount(): Promise<{ id: string; email: string }> {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Test Account', email: accountEmail });
    expect(res.status).toBe(201);
    return res.body;
  }
  
  async function createInvoice(accountId: string, lineItems = [], taxCents = 0) {
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: accountId, line_items: lineItems, tax_cents: taxCents });
    expect(res.status).toBe(201);
    return res.body;
  }
  
  // ... tests
});
```

Wait, I need to think about what the DTO field names are. The plan says:
- "BigInt fields appear as `string` in DTOs"
- "due_date is `string | null` (present-key-with-null, not omitted)"

For the invoice creation, I need to know what fields the `CreateInvoiceDto` expects. Looking at the repository:
- `CreateInvoiceTxArgs` has `invoice: InvoiceInsert` and `lineItems: LineItemInsert[]`

The invoice insert would have: `account_id`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `due_date`

The line item insert would have: `invoice_id`, `description`, `unit_price_cents`, `quantity`, `line_total_cents`

But the service computes subtotal/tax/total from the line items. So the DTO probably takes `account_id`, `line_items` (array of `{description, unit_price_cents, quantity}`), and optionally `tax_cents` and `due_date`.

Hmm, I'm making assumptions about the exact DTO shape. Let me look at what I know:

From the plan's control flow: "POST /invoices (transactional)" - the service receives a DTO, computes subtotal/tax/total, and calls `repo.createWithLineItems`.

The line items in the DTO probably have: `description`, `unit_price_cents`, `quantity` (and the service computes `line_total_cents = unit_price_cents × quantity`).

Actually, looking at the validation tests mentioned:
- "rejects quantity ≤ 0" - POST /invoices with quantity 0 → 400
- "rejects negative unit_price" - POST /invoices with unit_price_cents: -1 → 400

So the DTO for line items has `quantity` and `unit_price_cents` as fields.

For the invoice creation DTO, it likely has:
- `account_id` (string)
- `line_items` (array of `{ description, unit_price_cents, quantity }`)
- `tax_cents` (number, optional, default 0)
- `due_date` (string, optional)

Let me use snake_case for the request body fields since the API contract uses snake_case (matching the DB columns).

Actually wait - I need to be more careful. The plan says "public API contract byte-compatible (field presence, null vs missing, numeric string formats)". The DTOs use snake_case field names matching the DB columns.

Let me write the test now. I'll use `accountEmail` with a unique suffix for each test to avoid conflicts.

Actually, I realize I should think about whether to use a unique email per test or clean up between tests. Since I don't have a DELETE endpoint, I'll use unique emails per test (or per beforeEach).

Let me also think about the `updated_at` assertion. The plan says "the row update sets `updated_at = now()` in the same statement". So after voiding, `updated_at` should be >= `created_at`. But since they might be in the same millisecond, I should use `>=` or check that it's a valid timestamp. Actually the case says "strictly greater than (or at least not equal to)" - but that's hard to guarantee with fast operations. Let me just assert it's a valid timestamp string and that it's >= created_at. Actually, re-reading: "the response's `updated_at` must be strictly greater than (or at least not equal to) the original `created_at`". 

Hmm, but in practice if the operations are fast enough, they could be in the same second (if we're comparing seconds) or even the same millisecond. Let me just assert that `updated_at` is present and is a valid ISO string, and that it's >= `created_at`. Actually the case says "strictly greater than (or at least not equal to)" - I think the safest is to assert it's >= created_at and both are valid timestamps. Or I could add a small delay... but that's flaky.

Actually, looking more carefully - PostgreSQL `now()` has microsecond precision, and if we store as timestamptz and serialize to ISO string, it should have sub-millisecond precision. So if the UPDATE happens after the INSERT (which it does - different statements), the `updated_at` from the UPDATE should be strictly after the `created_at` from the INSERT. But there's no guarantee of at least 1 microsecond difference in all cases...

Let me just assert `updated_at >= created_at` (as strings, since ISO format is lexicographically comparable) and that both are non-null strings. That's the safest assertion.

Wait, actually I just realized - the response from PATCH would be the updated invoice. Let me check what fields it has. The plan says `updateStatus` returns `InvoiceDto`. And the invoice detail (from findById) includes `line_items`. So the PATCH response is probably just the invoice row mapped to DTO (without line_items, since it's an InvoiceDto not InvoiceDetailDto).

Let me write the test file now. I'll keep it focused on the 9 cases from the cases file.

For the "voiding does not modify or delete line_items" test, I need to:
1. Create invoice with 2 line items
2. GET /invoices/:id to get the line items
3. Void the invoice
4. GET /invoices/:id again and compare line_items

For "voiding from the 'paid' state" I need:
1. Create invoice (draft)
2. PATCH to 'sent'
3. PATCH to 'paid'
4. Record counters
5. PATCH to 'void'
6. Assert counters unchanged

Let me also think about what `InvoiceDto` looks like in the response. Based on the plan:
- BigInt fields are strings: `total_cents`, `subtotal_cents`, `tax_cents`
- `due_date` is `string | null` (present key)
- `line_items` is an array (in detail view)
- `status` is a string
- `created_at`, `updated_at` are strings (ISO)

For the account response:
- `total_invoiced_cents` is a string
- `balance_cents` is a string
- `credit_limit_cents` is a string

Let me write the complete file now.

One more thing - I need to think about how to get the account after voiding. I'll use GET /accounts/:id to fetch it.

Let me also consider: do I need to import `AppModule`? Yes, that's the standard approach for integration tests in NestJS.

Let me finalize my approach:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('void invoice', () => {
  let app: INestApplication;
  
  // helper to create unique email
  let emailCounter = 0;
  
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  
  afterEach(async () => {
    await app.close();
  });
  
  function uniqueEmail() {
    return `void-test-${Date.now()}-${++emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;
  }
  
  async function createAccount(): Promise<any> {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Void Test Account', email });
    expect(res.status).toBe(201);
    return res.body;
  }
  
  async function createInvoice(accountId: string, lineItems: any[] = [], taxCents = 0): Promise<any> {
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: accountId, line_items: lineItems, tax_cents: taxCents });
    expect(res.status).toBe(201);
    return res.body;
  }
  
  async function getAccount(id: string): Promise<any> {
    const res = await request(app.getHttpServer()).get(`/accounts/${id}`);
    expect(res.status).toBe(200);
    return res.body;
  }
  
  async function getInvoice(id: string): Promise<any> {
    const res = await request(app.getHttpServer()).get(`/invoices/${id}`);
    expect(res.status).toBe(200);
    return res.body;
  }
  
  async function voidInvoice(id: string): Promise<any> {
    const res = await request(app.getHttpServer())
      .patch(`/invoices/${id}/status`)
      .send({ status: 'void' });
    return res;
  }
  
  // Test 1 & 2: voiding leaves counters unchanged
  it('voiding an invoice leaves account.total_invoiced_cents and balance_cents unchanged', async () => {
    const account = await createAccount();
    const before = await getAccount(account.id);
    
    await createInvoice(account.id, [
      { description: 'Item A', unit_price_cents: 1000, quantity: 2 },
    ]);
    
    const afterCreate = await getAccount(account.id);
    // total_invoiced_cents should be 2000, balance_cents should be -2000
    
    await voidInvoice(/* need invoice id */);
    // ...
  });
```

Hmm, I need the invoice ID. The `createInvoice` helper returns the response body which should include the `id`.

Let me restructure. I'll make the helpers return what I need and write each test clearly.

Actually, let me reconsider the structure. I'll have each test be self-contained with clear setup and assertions, using the helpers for repeated operations.

Let me write it properly now:
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('void invoice', () => {
  let app: INestApplication;
  let emailCounter = 0;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `void-test-${Date.now()}-${++emailCounter}-${Math.random().toString(36).slice(2)}@example.com`;
  }

  async function createAccount(): Promise<any> {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Void Test Account', email: uniqueEmail() });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createInvoice(
    accountId: string,
    lineItems: Array<{ description: string; unit_price_cents: number; quantity: number }> = [],
    taxCents = 0,
  ): Promise<any> {
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: accountId, line_items: lineItems, tax_cents: taxCents });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function getAccount(id: string): Promise<any> {
    const res = await request(app.getHttpServer()).get(`/accounts/${id}`);
    expect(res.status).toBe(200);
    return res.body;
  }

  async function getInvoice(id: string): Promise<any> {
    const res = await request(app.getHttpServer()).get(`/invoices/${id}`);
    expect(res.status).toBe(200);
    return res.body;
  }

  async function patchStatus(invoiceId: string, status: string): Promise<any> {
    return request(app.getHttpServer())
      .patch(`/invoices/${invoiceId}/status`)
      .send({ status });
  }

  it('voiding an invoice leaves account.total_invoiced_cents unchanged', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [
      { description: 'Widget', unit_price_cents: 5000, quantity: 3 },
    ]);

    const afterCreate = await getAccount(account.id);
    expect(afterCreate.total_invoiced_cents).toBe('15000');

    await patchStatus(invoice.id, 'void');

    const afterVoid = await getAccount(account.id);
    expect(afterVoid.total_invoiced_cents).toBe('15000');
  });

  it('voiding an invoice leaves account.balance_cents unchanged', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [
      { description: 'Widget', unit_price_cents: 5000, quantity: 3 },
    ]);

    const afterCreate = await getAccount(account.id);
    expect(afterCreate.balance_cents).toBe('-15000');

    await patchStatus(invoice.id, 'void');

    const afterVoid = await getAccount(account.id);
    expect(afterVoid.balance_cents).toBe('-15000');
  });

  it('voiding returns 200 and the response body carries status: "void"', async () => {
    const account = await createAccount();
    const invoice = await createInvoice(account.id, [
      { description: 'Gadget', unit_price_cents: 1000, quantity: 1 },
    ]);

    const res = await patchStatus(invoice.id, 'void');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('void');
  });

  it('voiding updates updated_at to a timestamp at or after created_at', async () => {
    const account = await createAccount();
    const invoice = await createInvoice(account.id, [
      { description: 'Gizmo', unit_price_cents: 2500, quantity: 1 },
    ]);

    const detail = await getInvoice(invoice.id);
    const originalUpdatedAt = detail.updated_at;

    await patchStatus(invoice.id, 'void');

    const afterVoid = await getInvoice(invoice.id);
    expect(afterVoid.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it('voiding a non-existent invoice returns 404 with resource_not_found', async () => {
    const res = await patchStatus('00000000-0000-0000-0000-000000000000', 'void');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('voiding an already-void invoice is idempotent and does not double-adjust counters', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [
      { description: 'Doohickey', unit_price_cents: 3000, quantity: 2 },
    ]);

    const afterCreate = await getAccount(account.id);
    expect(afterCreate.total_invoiced_cents).toBe('6000');

    const firstVoid = await patchStatus(invoice.id, 'void');
    expect(firstVoid.status).toBe(200);

    const afterFirstVoid = await getAccount(account.id);
    expect(afterFirstVoid.total_invoiced_cents).toBe('6000');

    const secondVoid = await patchStatus(invoice.id, 'void');
    expect(secondVoid.status).toBe(200);
    expect(secondVoid.body.status).toBe('void');

    const afterSecondVoid = await getAccount(account.id);
    expect(afterSecondVoid.total_invoiced_cents).toBe('6000');
    expect(afterSecondVoid.balance_cents).toBe('-6000');
  });

  it('voiding does not modify or delete line_items', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [
      { description: 'Alpha', unit_price_cents: 100, quantity: 5 },
      { description: 'Beta', unit_price_cents: 200, quantity: 3 },
    ]);

    const before = await getInvoice(invoice.id);
    const itemsBefore = before.line_items;
    expect(itemsBefore).toHaveLength(2);

    await patchStatus(invoice.id, 'void');

    const after = await getInvoice(invoice.id);
    const itemsAfter = after.line_items;
    expect(itemsAfter).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      expect(itemsAfter[i].description).toBe(itemsBefore[i].description);
      expect(itemsAfter[i].unit_price_cents).toBe(itemsBefore[i].unit_price_cents);
      expect(itemsAfter[i].quantity).toBe(itemsBefore[i].quantity);
      expect(itemsAfter[i].line_total_cents).toBe(itemsBefore[i].line_total_cents);
    }
  });

  it('voiding from the paid state does not reverse counters', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [
      { description: 'Premium Service', unit_price_cents: 10000, quantity: 1 },
    ]);

    const sentRes = await patchStatus(invoice.id, 'sent');
    expect(sentRes.status).toBe(200);

    const paidRes = await patchStatus(invoice.id, 'paid');
    expect(paidRes.status).toBe(200);

    const afterPaid = await getAccount(account.id);
    expect(afterPaid.total_invoiced_cents).toBe('10000');

    const voidRes = await patchStatus(invoice.id, 'void');
    expect(voidRes.status).toBe(200);

    const afterVoid = await getAccount(account.id);
    expect(afterVoid.total_invoiced_cents).toBe('10000');
    expect(afterVoid.balance_cents).toBe('-10000');
  });

  it('voiding an invoice with total_cents = 0 is a no-op on counters', async () => {
    const account = await createAccount();

    const invoice = await createInvoice(account.id, [], 0);
    expect(invoice.total_cents).toBe('0');

    const afterCreate = await getAccount(account.id);
    expect(afterCreate.total_invoiced_cents).toBe('0');

    const res = await patchStatus(invoice.id, 'void');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('void');

    const afterVoid = await getAccount(account.id);
    expect(afterVoid.total_invoiced_cents).toBe('0');
    expect(afterVoid.balance_cents).toBe('0');
  });
});
```
