# repair2-null-vs-missing.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/null-vs-missing.spec.ts`:

1. `test/null-vs-missing.spec.ts(39): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`
2. `test/null-vs-missing.spec.ts(4,34): error TS2307: Cannot find module 'node:net' or its corresponding type declarations.`
3. `test/null-vs-missing.spec.ts(5,27): error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.`

Wait, line 39 references `@nestjs/common` but it's not shown with a full line number prefix like the others. Let me re-read...

Actually looking more carefully:
- Line 39: `error TS2307: Cannot find module '@nestjs/common'` — this seems like a continuation or it's on line 39 of the file
- Line 4: `error TS2307: Cannot find module 'node:net'`
- Line 5: `error TS2307: Cannot find module '../src/app.module'`

So the file has issues on lines 4, 5, and 39. The errors are:
- Line 4: importing `node:net` — can't find module
- Line 5: importing `../src/app.module` — can't find module
- Line 39: importing `@nestjs/common` — can't find module

Wait, but the other test files also have the same `@nestjs/common`, `@nestjs/testing`, `supertest` errors. Those are likely just missing type declarations (node_modules not installed or types not present). The instruction says "Change nothing the messages do not name." So I need to fix what's specifically wrong in THIS file.

Looking at the errors for this file specifically:
1. Line 4: `Cannot find module 'node:net'` — this is importing `node:net` which shouldn't be needed in a test file. This is likely a mistake — maybe they imported `net` to create a socket or something that doesn't belong.
2. Line 5: `Cannot find module '../src/app.module'` — needs explicit file extension per the ESM convention. Should be `../src/app.module.js`
3. Line 39: `Cannot find module '@nestjs/common'` — same issue as other files, likely just missing types. But wait, the other files have the same error and I'm only asked to fix this file.

Actually wait — re-reading the task: "Rewrite `test/null-vs-missing.spec.ts` complete, fixing what these messages require of this file."

So I need to fix the errors in THIS file. The errors are:
1. Line 4: `node:net` module not found — I should remove this import since it's not needed for the test behavior described in the plan.
2. Line 5: `../src/app.module` — needs `.js` extension for ESM/nodenext resolution.
3. Line 39: `@nestjs/common` — this is the same error as all other test files. It's likely a missing type declaration issue (node_modules). But since the instruction says to fix what the messages require, and this is a module resolution error...

Wait, let me reconsider. The other test files have the same `@nestjs/common` error. If I can't install packages, then this error would exist in all files regardless. The task says "fixing what these messages require of this file." 

Looking at the pattern across all test files:
- `test/validate-negative-price.spec.ts(2,34): error TS2307: Cannot find module '@nestjs/common'`
- `test/validate-quantity.spec.ts(4,34): error TS2307: Cannot find module '@nestjs/common'`
- `test/void-invoice.spec.ts(2,33): error TS2307: Cannot find module '@nestjs/common'`

So `@nestjs/common` is missing types across the board. This is likely a node_modules issue, not something I can fix by changing the import in one file. The instruction says "Change nothing the messages do not name." So if the module genuinely doesn't exist in node_modules, I can't fix it by changing the import path.

But wait — the `node:net` import is unusual. In a test file for "null vs missing" behavior, why would you need `node:net`? That's the real bug in this file. The `../src/app.module` without extension is also a bug per the ESM convention (as seen in `test/transaction-failure.spec.ts` which has the same TS2835 error for missing extensions).

Let me think about what this test file should contain based on the PLAN:

From the plan's test section:
- `test/null-vs-missing.spec.ts` — "due_date null is present-key-null" | Invoice with due_date NULL → JSON has `"due_date":null`, key is not absent
- `test/null-vs-missing.spec.ts` — "empty line_items is empty array" | Invoice created with `lineItems: []` → response `"line_items":[]` not missing

So the test file should:
1. Import from `@nestjs/testing`, `@nestjs/common`, `supertest` (for the standard test setup)
2. Import from `../src/app.module.js` (with .js extension)
3. Test that an invoice with `due_date: null` has the key present in JSON with null value
4. Test that an invoice with empty `lineItems: []` has `"line_items":[]` in the response

Now, the errors specific to this file:
1. `node:net` on line 4 — remove it, it's not needed
2. `../src/app.module` on line 5 — change to `../src/app.module.js`
3. `@nestjs/common` on line 39 — this is the same as all other files, likely a node_modules issue

For error 3, since it's the same across all test files and I'm only asked to fix this file, I'll keep the import as-is (it's correct, just missing types in node_modules). The instruction says "Do not drop a requirement to silence an error." So I keep the `@nestjs/common` import.

Actually wait, let me re-read the errors more carefully. Line 39 has `@nestjs/common`. But in a typical test file, you'd import `@nestjs/common` near the top (lines 1-5), not on line 39. Unless there's a dynamic import or something unusual going on. Or maybe the file has a lot of imports/setup before line 39.

Hmm, but I don't have the original file content. I need to write it from scratch based on:
1. What the plan says it should test
2. The error messages telling me what was wrong

The errors tell me:
- Line 4 had `node:net` import → I should NOT include this
- Line 5 had `../src/app.module` (without .js) → I should use `../src/app.module.js`
- Line 39 had `@nestjs/common` → This is odd for a top-level import to be on line 39

Wait, maybe the original file had a weird structure. But since I'm rewriting it completely, I just need to make sure:
1. No `node:net` import
2. Use `.js` extension for relative imports (per ESM/nodenext)
3. Keep `@nestjs/common` import (it's needed, the error is just missing types)

Let me write the file properly:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('null vs missing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('due_date null is present-key-null', async () => {
    // Create an account
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Null Test Acct', email: 'null-test@example.com' });
    const accountId = acctRes.body.id;

    // Create an invoice without due_date (should be null)
    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [{ description: 'Test item', unitPriceCents: 100, quantity: 1 }],
      });

    expect(invRes.status).toBe(201);
    // due_date key must be present with null value, not absent
    expect(invRes.body).toHaveProperty('due_date');
    expect(invRes.body.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    // Create an account
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Empty Items Acct', email: 'empty-items@example.com' });
    const accountId = acctRes.body.id;

    // Create an invoice with no line items
    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [],
      });

    expect(invRes.status).toBe(201);
    // line_items must be present as empty array, not absent
    expect(invRes.body).toHaveProperty('line_items');
    expect(Array.isArray(invRes.body.line_items)).toBe(true);
    expect(invRes.body.line_items).toHaveLength(0);
  });
});
```

Wait, but I need to think about what the actual API looks like. Looking at the plan:
- The DTOs use `due_date` (snake_case) in the wire format
- `line_items` (snake_case) in the wire format
- BigInt fields as strings

But wait, looking at the plan more carefully: "DTOs (`AccountDto`, `InvoiceDto`, `InvoiceDetailDto`, `CreateInvoiceDto`, etc.) are identical to the current Prisma version. BigInt fields appear as `string` in DTOs; `due_date` is `string | null` (present-key-with-null, not omitted)."

So the wire format uses snake_case for `due_date` and `line_items`. But what about the request body? The plan says "CreateInvoiceDto" — I need to think about what the input format is.

Looking at the plan's control flow:
- POST /invoices takes a `CreateInvoiceDto` which has `accountId`, `lineItems` (with `description`, `unitPriceCents`, `quantity`)

Actually, I'm not sure about the exact input format. Let me look at what the plan says about the API contract. The plan mentions "public API contract byte-compatible (field presence, null vs missing, numeric string formats)". The plan mentions `CreateInvoiceDto` but doesn't spell out its exact shape.

Given that the output uses snake_case (`due_date`, `line_items`, `unit_price_cents`), the input likely also uses snake_case. But it could use camelCase for input and snake_case for output (NestJS convention with class-transformer).

Hmm, I need to be careful. Let me look at the error in `test/void-invoice.spec.ts`:
```
test/void-invoice.spec.ts(147,22): error TS2352: Conversion of type 'Record<string, unknown>' to type 'Record<string, unknown>[]' may be a mistake
```

This suggests that in `test/void-invoice.spec.ts`, the response body is typed as `Record<string, unknown>` (from supertest's default typing), and they're trying to cast it to an array. This confirms that the test files use supertest with `request(app.getHttpServer())`.

For my file, I'll use the same pattern. Let me also consider: since I can't see the actual source files, I should write the test based on what the plan describes. The plan says:
- `due_date` is present-key-with-null in the output
- `line_items` is an array (empty array when no items)

Let me also consider the import of `@nestjs/common` on line 39. In my rewrite, I'll put it at the top with other imports. The fact that it was on line 39 in the original suggests the original had a weird structure, but my rewrite will be clean.

Actually, I realize I should also think about whether `node:net` was imported for a reason. In some test setups, people import `net` to check if a port is available or to create a server. But for a NestJS test using `Test.createTestingModule`, you don't need `node:net` — the app handles its own server. So it's safe to remove.

Let me also think about the `ValidationPipe`. The plan mentions validation errors (400 `validation_error`). But for my tests, I'm just testing the null/missing behavior on successful responses, so I don't strictly need a global ValidationPipe. However, it's good practice to include it for consistency with the app setup. Actually, the app module might already have it configured. Let me not add it explicitly — the `AppModule` should handle its own pipes.

Actually, looking at other test files in the plan, they all use `Test.createTestingModule({ imports: [AppModule] })` pattern. I'll follow that.

Let me also think about the request body format. Since this is a billing service and the plan mentions the API contract is byte-compatible with the Prisma version, and the output uses snake_case, I'll assume the input also uses snake_case (which is common in NestJS APIs that use class-transformer with `@Expose` or similar).

Actually, I just realized — I should look at what the plan says about `CreateInvoiceDto`. It mentions:
- `accountId` 
- `lineItems` (array of items with `description`, `unitPriceCents`, `quantity`)

But wait, in the output format it's `line_items` (snake_case). In NestJS, it's common to have camelCase in DTOs and snake_case in the wire format via a global interceptor or transformer. Or it could be that both input and output use snake_case.

Given the ambiguity, and since the plan says the API is byte-compatible with the Prisma version, I'll use snake_case for both input and output in my test. This is the safest assumption for a service that already uses snake_case in its wire format.

Actually, let me reconsider. The plan says:
- "public API contract byte-compatible (field presence, null vs missing, numeric string formats — invoices carry BigInt amounts serialized as strings today)"

And in the data model section, columns are `snake_case`. The plan mentions DTOs but doesn't specify the exact field names in the wire format for input. However, the output clearly uses snake_case (due_date, line_items, etc.).

I'll go with snake_case for the input too, as that's consistent with the output format and is the most common pattern when the database uses snake_case.

Let me finalize my test file:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('null vs missing', () => {
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
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Null Test Acct', email: 'null-test@example.com' });
    const accountId = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Test item', unit_price_cents: 100, quantity: 1 }],
      });

    expect(invRes.status).toBe(201);
    expect(invRes.body).toHaveProperty('due_date');
    expect(invRes.body.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Empty Items Acct', email: 'empty-items@example.com' });
    const accountId = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [],
      });

    expect(invRes.status).toBe(201);
    expect(invRes.body).toHaveProperty('line_items');
    expect(Array.isArray(invRes.body.line_items)).toBe(true);
    expect(invRes.body.line_items).toHaveLength(0);
  });
});
```

Hmm, but I'm not 100% sure about the input field names. Let me think about this differently. The plan mentions `CreateInvoiceDto` and the service method signature:

```ts
create(dto: CreateInvoiceDto): Promise<InvoiceDto>;
```

The plan doesn't specify the exact field names of `CreateInvoiceDto`. But given that:
1. The output uses snake_case (`due_date`, `line_items`, `unit_price_cents`)
2. The database uses snake_case
3. The API is "byte-compatible"

I'll go with snake_case for input too. If the actual API uses camelCase for input, this would be wrong, but I have no way to know from the information given. The safest bet is consistency with the output format.

Wait, actually I should add an `// ASSUMPTION:` comment about this since I can't see the actual DTO shape. The instructions say: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

But actually, the errors don't refer to a shape I can't see. The errors are about module resolution. The shape issue is just something I need to figure out to write a correct test. Let me add an assumption comment.

Actually, re-reading the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." The compiler messages don't refer to shapes — they're all module resolution errors. So I don't strictly need an ASSUMPTION line for the shape. But it's good practice to note my assumption about the input format.

Let me also reconsider: do I need `ValidationPipe`? The plan mentions validation errors for quantity ≤ 0 and negative prices. But those are tested in other files (`test/validate-quantity.spec.ts`, `test/validate-negative-price.spec.ts`). My file only tests null-vs-missing behavior on successful responses. I don't need ValidationPipe for my tests.

One more thought: the `node:net` import on line 4 of the original file. This is clearly wrong for this test file and should be removed. The `../src/app.module` without `.js` extension is wrong per ESM/nodenext and should be `../src/app.module.js`. The `@nestjs/common` on line 39 is just a missing types issue (same as all other files).

Let me write the final version. I'll keep it clean and focused on what the plan specifies.
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

// ASSUMPTION: CreateInvoiceDto uses snake_case field names in the request body,
// consistent with the snake_case wire format of all output fields (due_date, line_items, etc.).
// The compiler messages do not expose the DTO shape; this is inferred from the output contract.

describe('null vs missing', () => {
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
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Null Test Acct', email: 'null-test@example.com' });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Test item', unit_price_cents: 100, quantity: 1 }],
      });

    expect(invRes.status).toBe(201);
    // Key must be present in the JSON with a null value, not absent from the object.
    expect(invRes.body).toHaveProperty('due_date');
    expect(invRes.body.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Empty Items Acct', email: 'empty-items@example.com' });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [],
      });

    expect(invRes.status).toBe(201);
    // Key must be present as an empty array, not absent or null.
    expect(invRes.body).toHaveProperty('line_items');
    expect(Array.isArray(invRes.body.line_items)).toBe(true);
    expect((invRes.body.line_items as unknown[]).length).toBe(0);
  });
});
```
