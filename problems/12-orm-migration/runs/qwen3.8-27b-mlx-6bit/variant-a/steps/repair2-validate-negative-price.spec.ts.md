# repair2-validate-negative-price.spec.ts

## reasoning

```
Let me analyze the compiler errors specific to `test/validate-negative-price.spec.ts`:

1. `test/validate-negative-price.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.`
2. `test/validate-negative-price.spec.ts(2,34): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`
3. `test/validate-negative-price.spec.ts(4,21): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.`
4. `test/validate-negative-price.spec.ts(5,27): error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.`

These are all TS2307 "Cannot find module" errors. This means the modules aren't installed or the type declarations aren't available. But wait - looking at other test files, they have the same errors (e.g., `test/void-invoice.spec.ts` also can't find `@nestjs/common`, `@nestjs/testing`, `../src/app.module`). So these are workspace-wide issues, not specific to this file.

The task says "Rewrite `test/validate-negative-price.spec.ts` complete, fixing what these messages require of this file."

So I need to fix the issues that are specifically about this file. The errors for this file are:
1. Line 1, col 22: Cannot find module '@nestjs/testing'
2. Line 2, col 34: Cannot find module '@nestjs/common'
3. Line 4, col 21: Cannot find module 'supertest'
4. Line 5, col 27: Cannot find module '../src/app.module'

These are all "Cannot find module" errors. The other test files have the same issues, so this is likely a workspace-wide problem (missing dependencies or type declarations). But the task says to fix what these messages require of THIS file.

Wait, let me re-read: "Change nothing the messages do not name." So I should only fix things that the compiler messages point to in this file.

The errors are all TS2307 - module not found. This could be because:
- The packages aren't installed (but they're in package.json presumably)
- The type declarations aren't found

But looking at the other files, they have the same errors. So this is a systemic issue. However, the task says to fix what these messages require of THIS file specifically.

Hmm, but if the modules genuinely can't be found, there's not much I can do in the file itself unless I change the import paths or add type declarations.

Wait - let me look more carefully. The error says `test/validate-negative-price.spec.ts(4,21): error TS2307: Cannot find module 'supertest'`. Line 4, column 21. And line 5 is `Cannot find module '../src/app.module'`.

Looking at the pattern of other test files like `test/void-invoice.spec.ts`:
- Line 2: `@nestjs/common`
- Line 3: `@nestjs/testing`
- Line 4: `../src/app.module`

And `test/validate-quantity.spec.ts`:
- Line 3: `@nestjs/testing`
- Line 4: `@nestjs/common`
- Line 5: `supertest`
- Line 6: `../src/app.module`

So the validate-negative-price file has a similar structure. The errors are all about modules not being found.

Given that these are the same types of errors that appear in ALL test files (they're workspace-wide), and the task says to fix "what these messages require of this file", I think the expectation is that I write the file correctly and the module resolution issues are a systemic problem (perhaps the node_modules aren't installed, or tsconfig needs adjustment).

But wait - the task says "These are the compiler's exact messages for the whole workspace" and asks me to fix what they require of THIS file. If the modules genuinely can't be resolved, there's nothing I can do in the file itself to fix TS2307 errors for third-party modules unless I change how I import them.

Let me reconsider. Perhaps the issue is that the file needs to be written in a way that avoids these imports? But the plan says tests use NestJS test module and supertest...

Actually, I think the most reasonable interpretation is: write the file correctly according to the plan, and the TS2307 errors are a workspace configuration issue (missing `node_modules`, or missing `@types/supertest`, etc.) that would be fixed by installing dependencies. The file itself should be correct in its imports and logic.

Let me look at what the plan says this test should do:
- `test/validate-negative-price.spec.ts` — "rejects negative unit_price" | POST /invoices with unit_price_cents: -1 → 400 `validation_error`

So I need to write a test that:
1. Sets up the NestJS test module with AppModule
2. Makes a POST request to /invoices with a line item having negative unit_price_cents
3. Expects a 400 response with the error envelope containing code "validation_error"

Let me write this following the patterns I can infer from the other test files and the plan.

Looking at the structure of similar tests (validate-quantity.spec.ts has the same structure), I'll model after that.

The imports needed:
- `Test` from `@nestjs/testing`
- `INestApplication` from `@nestjs/common`
- `request` from `supertest`
- `AppModule` from `../src/app.module`

Wait, but the error on line 5 says `Cannot find module '../src/app.module'`. That's a relative path. If the file is in `test/`, then `../src/app.module` would be correct (going up to root, then into src). That should work.

Let me just write the file properly. The TS2307 errors are likely because the packages aren't installed in the environment where compilation happened. My job is to write the file correctly.

Actually, re-reading the instructions more carefully: "Rewrite `test/validate-negative-price.spec.ts` complete, fixing what these messages require of this file."

The messages for this file are all TS2307 (module not found). If I can't fix module resolution from within the file, then perhaps the "fix" is just to write the file correctly and acknowledge that the module resolution is a workspace issue.

But wait - maybe I should look at this differently. What if the file currently has incorrect import paths or missing type declarations that I should add? Let me think about what a correct version looks like.

Given the plan and conventions:
- ESM with `"type": "module"` 
- The convention says `node16` or `nodenext` module resolution (based on the TS2835 errors in other files)

For `node16`/`nodenext` module resolution, relative imports need explicit file extensions! That's what the TS2835 errors in `test/transaction-failure.spec.ts` are about:
```
error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/db/client.js'?
```

But in `test/validate-negative-price.spec.ts`, there's no TS2835 error - only TS2307. So the relative import `../src/app.module` doesn't trigger a TS2835... wait, that's strange. If moduleResolution is node16/nodenext, then `../src/app.module` should trigger TS2835 too.

Unless... the TS2307 error takes precedence? Like, if it can't find the module at all, it reports TS2307 instead of TS2835?

Actually yes, that makes sense. If the module literally cannot be found (no file exists at that path), TypeScript reports TS2307. If the module is found but the import syntax is wrong for the resolution mode, it reports TS2835.

So for `test/validate-negative-price.spec.ts`, the `../src/app.module` import is getting TS2307, which means either:
1. The file `src/app.module.ts` doesn't exist yet (but the plan says it should)
2. Or with node16 resolution, it's looking for `../src/app.module` literally (without extension) and not finding it

Given that other files like `test/void-invoice.spec.ts` also have TS2307 for `../src/app.module`, and `test/transaction-failure.spec.ts` has TS2835 for `../src/db/client` (suggesting the file exists but needs .js extension), it seems like:
- `src/app.module.ts` might not exist yet
- Or the resolution mode requires `.js` extension

But since I'm only asked to fix THIS file, and the errors are TS2307 (module not found), I should write the imports in the correct form. If the moduleResolution is `node16`/`nodenext`, I should use `.js` extensions for relative imports.

Wait, but the error message for this file is TS2307, not TS2835. If I change `../src/app.module` to `../src/app.module.js`, would that fix it? If the file exists as `src/app.module.ts`, then with node16 resolution, importing `../src/app.module.js` would correctly resolve to `src/app.module.ts`.

Let me look at the pattern: in `test/transaction-failure.spec.ts`, the error is TS2835 for `../src/db/client` suggesting to use `../src/db/client.js`. This means the file EXISTS but the import needs the extension. For `test/validate-negative-price.spec.ts`, the error is TS2307 for `../src/app.module` - this could mean either the file doesn't exist OR it needs an extension.

Given that the plan explicitly lists `src/app.module.ts` as a file that should exist, and other test files reference it with the same pattern, I think the safest approach is to use `../src/app.module.js` (with the .js extension) since the project uses ESM with node16/nodenext resolution.

Actually wait - let me reconsider. The task says "Change nothing the messages do not name." The messages for this file are:
1. Line 1, col 22: TS2307 for '@nestjs/testing'
2. Line 2, col 34: TS2307 for '@nestjs/common'  
3. Line 4, col 21: TS2307 for 'supertest'
4. Line 5, col 27: TS2307 for '../src/app.module'

For errors 1-3 (third-party modules), there's nothing I can do in the file to fix them - they need the packages installed. These are workspace issues.

For error 4 (relative module), I could potentially fix it by adding the `.js` extension: `../src/app.module.js`. This is consistent with the TS2835 errors in other files that suggest `.js` extensions are needed.

But wait - if I change the import to `../src/app.module.js` and the file still can't be found (because it doesn't exist yet), I'd still get TS2307. But at least the syntax would be correct for the resolution mode.

Hmm, but the instruction says "Change nothing the messages do not name." The message names line 5 with the import of `../src/app.module`. So I am allowed to change that import.

Let me think about what the correct file should look like based on the plan:

```typescript
import { Test } from '@nestjs/testing';           // line 1
import { INestApplication } from '@nestjs/common'; // line 2
// maybe line 3 is something else or blank
import request from 'supertest';                   // line 4
import { AppModule } from '../src/app.module';     // line 5
```

The column positions:
- Line 1, col 22: `@nestjs/testing` starts at col 22. Let me count: `import { Test } from '` - that's 21 chars, so col 22 is the start of the module name. ✓
- Line 2, col 34: `@nestjs/common` starts at col 34. `import { INestApplication } from '` - let me count: i(1)m(2)p(3)o(4)r(5)t(6) (7){(8) (9)I(10)N(11)e(12)s(13)t(14)A(15)p(16)p(17)l(18)i(19)c(20)a(21)t(22)i(23)o(24)n(25) (26)}(27) (28)f(29)r(30)o(31)m(32) (33)'(34) - so col 34 is the opening quote, and the module name starts at col 35. Hmm, that doesn't quite match. Let me recount.

Actually in TypeScript errors, the column is 1-based and points to where the error is detected. For `import { X } from 'module'`, the error TS2307 typically points to the string literal of the module. Let me not overthink the exact column positions - they're just telling me which import is failing.

OK so my plan for the file:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
```

Wait, but should I use `.js` extension? The error is TS2307 (not found), not TS2835 (needs extension). If I add `.js` and the file exists, it would work. If the file doesn't exist, it still wouldn't work. But adding `.js` is the correct form for node16/nodenext ESM resolution.

However, I notice that `test/void-invoice.spec.ts` line 4 has the same TS2307 for `../src/app.module` without a TS2835. And `test/validate-quantity.spec.ts` line 6 also has TS2307 for `../src/app.module`. So all of them have the same issue.

Given that the task is specifically about `test/validate-negative-price.spec.ts` and I should fix what the messages require of THIS file, and the messages only say TS2307 (module not found), I think the correct approach is:

1. Write the file with correct imports and test logic
2. For the relative import, use `.js` extension since the project uses ESM with node16/nodenext (as evidenced by TS2835 errors in other files)
3. The third-party module errors (TS2307 for @nestjs/testing, @nestjs/common, supertest) are workspace issues that can't be fixed from within the file

Actually, I just realized - maybe I'm overthinking this. The task says to fix what the messages require. If the modules can't be found, perhaps the "fix" is just to ensure the file is correctly written and the errors would be resolved once dependencies are installed. The file content itself should be correct.

Let me write the complete test file based on the plan:

The plan says:
- `test/validate-negative-price.spec.ts` — "rejects negative unit_price" | POST /invoices with unit_price_cents: -1 → 400 `validation_error`

I need to:
1. Set up a test application with AppModule
2. Create an account (needed for creating an invoice)
3. POST to /invoices with a line item having negative unit_price_cents
4. Assert 400 with error code "validation_error"

Let me look at the API structure from the plan:
- POST /invoices requires an accountId and lineItems
- Each line item has: description, unit_price_cents, quantity

The DTO for creating an invoice would be something like:
```json
{
  "account_id": "...",
  "line_items": [
    { "description": "...", "unit_price_cents": -1, "quantity": 1 }
  ]
}
```

Wait, I need to think about what the actual request body looks like. The plan mentions `CreateInvoiceDto` but doesn't show its exact shape. Let me infer from the context:
- It needs an account reference (account_id)
- It needs line items
- Possibly due_date, tax info

Looking at the invoice creation flow:
- The service takes a `CreateInvoiceDto`
- The DTO likely has: accountId, lineItems (array of {description, unitPriceCents, quantity}), possibly dueDate, taxCents

For the API endpoint, it would be something like:
```
POST /invoices
{
  "accountId": "...",
  "lineItems": [
    { "description": "Test item", "unitPriceCents": -1, "quantity": 1 }
  ]
}
```

But I'm not 100% sure about the exact field names in the request body. Let me think about what makes sense given the conventions...

The plan says endpoints are kebab-case and plural. The DTOs use camelCase in TypeScript but the JSON wire format... hmm.

Actually, looking at the plan more carefully:
- "BigInt fields appear as `string` in DTOs"
- The error envelope uses snake_case for codes

For the request body, I'll need to make assumptions about the exact shape. Let me use what seems most natural for a NestJS API:

```json
{
  "accountId": "<uuid>",
  "lineItems": [
    { "description": "Test", "unitPriceCents": -1, "quantity": 1 }
  ]
}
```

Or it could be snake_case in the JSON body:
```json
{
  "account_id": "<uuid>",
  "line_items": [
    { "description": "Test", "unit_price_cents": -1, "quantity": 1 }
  ]
}
```

Given that the plan mentions the API contract should be "byte-compatible" with the Prisma version, and the Prisma version likely used a specific format... I'll need to make an assumption here.

Actually, looking at the conventions section: "Table and column: snake_case". But that's for the database. For the API, it could be either.

Let me look at what makes sense. The plan says:
- `CreateInvoiceDto` is the input DTO
- The service method is `create(dto: CreateInvoiceDto): Promise<InvoiceDto>`

In NestJS, DTOs typically use camelCase for properties. The JSON body would match the DTO property names unless there's a transformation.

I'll go with camelCase in the request body since that's the NestJS convention:
```json
{
  "accountId": "<uuid>",
  "lineItems": [
    { "description": "Test", "unitPriceCents": -1, "quantity": 1 }
  ]
}
```

Hmm, but actually I realize I'm guessing at the exact API shape. The task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The compiler messages don't refer to any shape - they're all about module resolution. So I don't think I need ASSUMPTION lines for the API shape. But I should write something reasonable.

Let me also consider: do I need to create an account first? Yes, because creating an invoice requires a valid account_id (FK constraint). So the test needs to:
1. Create an account via POST /accounts
2. Try to create an invoice with negative unit_price_cents
3. Expect 400 validation_error

Let me write the file now. I'll model it after what a typical NestJS integration test looks like with supertest:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('invoices - validation', () => {
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

  it('rejects negative unit_price', async () => {
    // Create an account first
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Test Account', email: `neg-price-${Date.now()}@test.com` });
    expect(accountRes.status).toBe(201);
    const accountId = accountRes.body.id;

    // Try to create invoice with negative unit price
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [
          { description: 'Bad item', unitPriceCents: -1, quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
```

Wait, but I need to think about whether the validation happens in the controller or service layer. The plan says:
- "controller validates input and calls the service. Zero business logic."

So validation of unit_price_cents being negative would happen in the controller (or via DTO validation pipes). The error code would be `validation_error`.

Actually, looking at the plan's control flow section: "Validation of input DTOs (happens in controller / before repo call)." This confirms validation is at the controller level.

Now, for the response format on validation error, it should follow the error envelope:
```json
{ "error": { "code": "validation_error", "message": "...", "details": {} } }
```

Let me also think about whether I need `expect` from vitest. In Vitest, `expect`, `describe`, `it`, `beforeAll`, `afterAll` are available globally (if configured) or need to be imported.

Looking at the plan: "Test files use `.spec.ts` in `test/`, run under Vitest". In Vitest, if you have the globals option enabled, you don't need to import. But if not, you need `import { describe, it, expect, beforeAll, afterAll } from 'vitest'`.

Since the compiler errors don't mention missing `describe`, `it`, `expect` etc., it's likely that globals are enabled in the vitest config. So I won't import them.

Let me finalize my file. One more consideration: the `.js` extension on the relative import. 

Looking at the evidence:
- `test/transaction-failure.spec.ts` has TS2835 errors suggesting `.js` extensions are needed for relative imports
- `test/validate-negative-price.spec.ts` has TS2307 for `../src/app.module` (not TS2835)

The difference might be because:
- In transaction-failure, the target files exist but need .js extension → TS2835
- In validate-negative-price, maybe `src/app.module.ts` doesn't exist yet → TS2307 (can't even check if extension is needed)

Or it could be that TS2307 takes precedence over TS2835 when the base path can't be resolved at all.

Either way, using `../src/app.module.js` is the correct form for ESM with node16/nodenext resolution. If the file exists as `src/app.module.ts`, TypeScript with node16 resolution will correctly map `.js` → `.ts`.

I'll use the `.js` extension. This is the "fix" that the module resolution mode requires.

Let me write the final version:
```

## reply

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('POST /invoices – negative unit price', () => {
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

  it('rejects negative unit_price_cents with validation_error', async () => {
    // Arrange – create an account so the FK is satisfied
    const unique = Date.now().toString(36);
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Price Acct', email: `neg-price-${unique}@example.com` });
    expect(accountRes.status).toBe(201);
    const accountId: string = accountRes.body.id;

    // Act – attempt to create an invoice with a negative unit price
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [
          { description: 'Bad item', unitPriceCents: -1, quantity: 1 },
        ],
      });

    // Assert – single error envelope with the validation_error code
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual({});
  });
});
```
