# repair2-bigint-format.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/bigint-format.spec.ts`.

Looking at the error messages, I see errors from:
- `test/null-vs-missing.spec.ts`
- `test/transaction-failure.spec.ts`
- `test/validate-negative-price.spec.ts`
- `test/validate-quantity.spec.ts`
- `test/void-invoice.spec.ts`

Wait, I don't see any errors specifically from `test/bigint-format.spec.ts` in the list. Let me re-read...

The user says: "`test/bigint-format.spec.ts` does not compile. These are the compiler's exact messages for the whole workspace"

So the compiler messages are for the whole workspace, and I need to fix `test/bigint-format.spec.ts` specifically. But none of the error lines reference `test/bigint-format.spec.ts` directly. 

Wait, let me re-read more carefully. The first line is:
```
39): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.
```

This starts with `39)` which means it's a continuation - the file path is cut off. It's likely `test/bigint-format.spec.ts(39): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`

So the error in `test/bigint-format.spec.ts` is at line 39, column something: Cannot find module '@nestjs/common'.

But wait - if `@nestjs/common` can't be found, that's a dependency issue. But the task says to fix what the messages require of THIS file. The message says "Cannot find module '@nestjs/common'". 

Hmm, but looking at the other test files, they ALL have the same error - `@nestjs/common`, `@nestjs/testing`, `supertest`, etc. are all "not found". This suggests the packages aren't installed (no `node_modules`). But the task is to fix the file, not install dependencies.

Wait, let me reconsider. The errors for other files also include:
- `Cannot find module 'node:net'` 
- `Cannot find module 'node:crypto'`
- `Cannot find module '../src/app.module'`
- `Cannot find module '../src/db/database.module'`
- `Cannot find module 'drizzle-orm'`
- `Cannot find module '../src/accounts/accounts.repository'`
- `Cannot find module '../src/invoices/invoices.repository'`
- `Cannot find module '../src/db/client.js'` (relative import paths need explicit file extensions)
- `Cannot find module '../src/db/schema.js'` (relative import paths need explicit file extensions)

So the issues are:
1. Missing dependencies (`@nestjs/common`, `@nestjs/testing`, `supertest`, `drizzle-orm`, etc.)
2. Missing type declarations for node built-in modules (`node:net`, `node:crypto`)
3. Cannot find local modules (`../src/app.module`, `../src/db/database.module`, etc.)
4. ESM import path issues (need `.js` extensions for relative imports)

For `test/bigint-format.spec.ts`, the error is at line 39: Cannot find module '@nestjs/common'.

Now, the task says "Rewrite `test/bigint-format.spec.ts` complete, fixing what these messages require of this file."

The message for this file is just one: line 39, Cannot find module '@nestjs/common'.

But wait - if the other files have issues with:
- ESM relative import paths needing `.js` extensions
- `@nestjs/common` not found
- `@nestjs/testing` not found
- `supertest` not found
- `drizzle-orm` not found
- local src modules not found

And `test/bigint-format.spec.ts` only shows ONE error (line 39, @nestjs/common), that seems odd. Unless the file only imports `@nestjs/common` and nothing else problematic, OR the compiler stopped reporting after a certain number of errors.

Actually, looking more carefully at the error list - it seems like the errors are listed per file. For `test/bigint-format.spec.ts`, there's only one error shown: line 39 with `@nestjs/common`. This is the first error alphabetically (the file starts with `test/bigint-format.spec.ts` which comes before `test/null-vs-missing.spec.ts` etc.).

Wait no, the first line is just `39): error TS2307` - it's missing the file prefix. This is likely because the output was truncated at the beginning. The full line would be something like:
`test/bigint-format.spec.ts(39): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`

So the only error in `test/bigint-format.spec.ts` is at line 39 - cannot find `@nestjs/common`.

Now, what should the file look like? Based on the PLAN.md:

| Test file / describe | Proves |
|---|---|
| `test/bigint-format.spec.ts` — "zero-amount invoice serialises as '0'" | total_cents=0 → `"total_cents":"0"` (string, not number, not omitted) |
| `test/bigint-format.spec.ts` — "negative balance serialises with minus sign" | balance_cents=-50 → `"balance_cents":"-50"` |

The manifest says:
```
test/bigint-format.spec.ts | reads: src/invoices/invoices.repository.ts, src/accounts/accounts.repository.ts | BigInt→string wire format edge cases (0, negative)
```

So this test file needs to:
1. Test that a zero-amount invoice serializes total_cents as "0" (string)
2. Test that a negative balance serializes with minus sign as "-50" (string)

Now, looking at the patterns from other test files in the error messages:
- They import from `@nestjs/testing` (Test)
- They import from `@nestjs/common` (INestApplication or similar)
- They import `supertest`
- They import from `../src/app.module`

The error at line 39 says `@nestjs/common` cannot be found. This is a dependency resolution issue - the package isn't installed. But I can't fix that by rewriting the file... unless the import path is wrong.

Wait, actually - looking at the conventions: "ESM, `"type": "module"`". And the tsconfig likely has `moduleResolution: "node16"` or `"nodenext"` based on the TS2835 errors in other files.

With `moduleResolution: "node16"` or `"nodenext"`, package imports should work fine (they resolve to the package's entry point). The issue is that the packages aren't installed.

But the task says "fixing what these messages require of this file." If the message is "Cannot find module '@nestjs/common'", what can I do in the file to fix it? Nothing - it's a missing dependency. Unless...

Hmm, wait. Let me reconsider. Maybe the file doesn't actually need `@nestjs/common`. If I restructure the test to not import from `@nestjs/common`, the error goes away. But that would change the test approach.

Actually, looking at this differently: the task says these are the compiler's exact messages for the WHOLE workspace. The file `test/bigint-format.spec.ts` has an error at line 39 about `@nestjs/common`. 

But ALL other test files also have the same error. This is clearly a "dependencies not installed" situation. The fix isn't in the file itself - it's in `package.json` / running `pnpm install`.

But the task explicitly says "Rewrite `test/bigint-format.spec.ts` complete, fixing what these messages require of this file." So I need to produce a file that would compile.

If the dependencies aren't installed, no import of them will work. But the task says to fix what the messages require. The message is "Cannot find module '@nestjs/common'". 

I think the intent here is: the file as currently written has an import of `@nestjs/common` at line 39 that causes this error. The fix is to ensure the file is correct - i.e., write it properly so that once dependencies are installed, it compiles. The "fix" is writing the correct file content.

Actually wait - I think I'm overthinking this. The task is asking me to write the complete file. The compiler errors tell me what's wrong with the current version. For `test/bigint-format.spec.ts`, the only error is at line 39: cannot find `@nestjs/common`. 

The most likely scenario: the current file has an import of `@nestjs/common` at line 39 that shouldn't be there, OR the file structure is wrong and it's importing something it doesn't need.

Given the PLAN says this test should prove:
1. "zero-amount invoice serialises as '0'" - total_cents=0 → `"total_cents":"0"`
2. "negative balance serialises with minus sign" - balance_cents=-50 → `"balance_cents":"-50"`

And the manifest says it reads from `src/invoices/invoices.repository.ts` and `src/accounts/accounts.repository.ts`.

Looking at the patterns from other test files (based on their errors):
- `test/void-invoice.spec.ts` imports `@nestjs/common` (line 2), `@nestjs/testing` (line 3), `../src/app.module` (line 4)
- `test/validate-quantity.spec.ts` imports `@nestjs/testing` (line 3), `@nestjs/common` (line 4), `supertest` (line 5), `../src/app.module` (line 6)
- `test/validate-negative-price.spec.ts` imports `@nestjs/testing` (line 1), `@nestjs/common` (line 2), `supertest` (line 4), `../src/app.module` (line 5)

So the standard pattern for integration tests is:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
```

For `test/bigint-format.spec.ts`, the error is at line 39 for `@nestjs/common`. This is unusual - it would normally be near the top of the file (lines 1-6). Having it at line 39 suggests either:
1. The file has a lot of content before the import (unlikely for a standard import)
2. The file uses a dynamic import or a different pattern

Actually, you know what - I think the line numbers in the error output might be from a DIFFERENT version of the file than what I'd write. The task is to rewrite the file completely. I should just write a correct version that follows the patterns established by the other test files.

Let me think about what the file should contain:

1. It's an integration test (uses the full app via NestJS test module + supertest)
2. It tests BigInt→string wire format edge cases
3. Two test cases:
   - Create an invoice with zero amount → verify total_cents is "0" (string)
   - Create/set up an account with negative balance → verify balance_cents is "-50" (string)

Wait, for the negative balance test - how would an account get a negative balance? Looking at the transaction flow:
- When an invoice is created: `balance_cents = balance_cents - total`
- So if an account has balance 0 and you create an invoice with total 50, the balance becomes -50.

So the test would:
1. Create an account (balance starts at 0)
2. Create an invoice with total_cents = 50 (which makes balance -50)
3. GET the account and verify balance_cents is "-50" (string with minus sign)

For the zero-amount test:
1. Create an account
2. Create an invoice with all zero amounts (line items with price 0 or no line items, tax 0)
3. GET the invoice and verify total_cents is "0"

Wait, but looking at the plan more carefully:
- `test/validate-quantity.spec.ts` — "rejects quantity ≤ 0" - POST /invoices with quantity 0 → 400
- So quantity must be > 0

For a zero-amount invoice, I could have line items with unit_price_cents = 0 and quantity = 1, giving line_total_cents = 0. Then subtotal = 0, tax = 0, total = 0.

Let me write the file:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('BigInt wire format', () => {
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

  it('zero-amount invoice serialises as "0"', async () => {
    // Create account
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Zero Co', email: `zero-${Date.now()}@test.com` })
      .expect(201);
    const accountId = accountRes.body.id;

    // Create invoice with zero-amount line item
    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [{ description: 'Free tier', unitPriceCents: 0, quantity: 1 }],
      })
      .expect(201);

    expect(invoiceRes.body.total_cents).toBe('0');
    expect(typeof invoiceRes.body.total_cents).toBe('string');
  });

  it('negative balance serialises with minus sign', async () => {
    // Create account (balance starts at 0)
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Co', email: `neg-${Date.now()}@test.com` })
      .expect(201);
    const accountId = accountRes.body.id;

    // Create invoice that drives balance negative
    await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [{ description: 'Charge', unitPriceCents: 50, quantity: 1 }],
      })
      .expect(201);

    // Verify balance is "-50" as a string
    const getRes = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .expect(200);

    expect(getRes.body.balance_cents).toBe('-50');
    expect(typeof getRes.body.balance_cents).toBe('string');
  });
});
```

Hmm wait, but I need to think about the field naming. Looking at the plan:
- DTOs have BigInt fields as `string`
- The convention is `snake_case` for table/column names

Looking at the error in `test/void-invoice.spec.ts`:
```
test/void-invoice.spec.ts(147,22): error TS2352: Conversion of type 'Record<string, unknown>' to type 'Record<string, unknown>[]' may be a mistake
```

This suggests the test accesses response body properties. The field names in the API would be... let me think about what the controller returns.

From the plan:
- `AccountDto` - has fields like `id`, `name`, `email`, `credit_limit_cents`, `balance_cents`, `total_invoiced_cents`, `created_at`
- `InvoiceDto` - has fields like `id`, `account_id`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `due_date`, `created_at`, `updated_at`
- `InvoiceDetailDto` - adds `line_items` array

These are `snake_case` in the DTO (matching the column names), which is consistent with the Prisma → wire format mapping.

For the request body (DTOs for creation), the plan mentions `CreateAccountDto` and `CreateInvoiceDto`. The field names would likely be:
- `CreateAccountDto`: `name`, `email`, maybe `credit_limit_cents`
- `CreateInvoiceDto`: `account_id`, `line_items` (array of `{description, unit_price_cents, quantity}`)

Wait, but in TypeScript/NestJS, DTOs often use camelCase for the class properties and the wire format might differ. But given that this is a Prisma-based service where the schema uses snake_case, and the plan says "public API contract byte-compatible", I'll assume the wire format uses snake_case.

Actually, let me look at this more carefully. The plan says:
- "field presence, null vs missing, numeric string formats"
- The columns are snake_case

For the request body, looking at `CreateInvoiceDto` - it would have `account_id` and `line_items` as the field names in the JSON. Each line item would have `description`, `unit_price_cents`, `quantity`.

Let me also consider: does the test need to handle the case where `line_items` is empty for the zero-amount case? No - I'll use a line item with price 0.

Actually wait - can `unit_price_cents` be 0? The validation test says "rejects negative unit_price" but doesn't say it rejects zero. So 0 should be valid.

Let me also think about whether I need `@types/node` for this file. The error messages show `Cannot find module 'node:net'` and `Cannot find module 'node:crypto'` in other files. My file doesn't import those, so it should be fine.

The key error for this file is just: line 39, Cannot find module '@nestjs/common'. If I write the file with the import at line 2 (standard position), and the package is installed, it'll compile. The "fix" is really just having the correct file content.

But wait - maybe the issue is that the current file has `@nestjs/common` imported at line 39 for some reason (maybe a dynamic import or a misplaced import). By rewriting the file with the import at the top, I fix the structural issue.

Actually, I just realized - the error says line 39. If my rewritten file has `@nestjs/common` at line 2, then line 39 would be something else entirely. The point is: I'm rewriting the file to be correct. The compiler errors tell me what was wrong with the old version. My new version should be correct.

Let me also make sure I'm using the right import style. The conventions say ESM with `"type": "module"`. With `moduleResolution: "node16"` or `"nodenext"`, I need to be careful:
- Package imports: `import { Test } from '@nestjs/testing'` - fine
- Relative imports: need `.js` extension? The TS2835 errors in other files confirm this.

Wait, but looking at the errors for other files:
```
test/transaction-failure.spec.ts(5,32): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/db/client.js'?
```

So relative imports need `.js` extensions! This means `../src/app.module` should be `../src/app.module.js`.

But wait - the errors for `test/validate-quantity.spec.ts` show:
```
test/validate-quantity.spec.ts(6,27): error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.
```

This is TS2307 (cannot find module), NOT TS2835 (needs explicit extension). So for `../src/app.module`, the error is "cannot find module" not "needs extension". This might mean that `app.module.ts` doesn't exist yet (it's part of the migration work), OR it could be that the module resolution for `.ts` files without extensions fails differently.

Hmm, actually with `node16`/`nodenext` resolution:
- TS2835 is when you have a relative path that clearly maps to a `.ts` file but you didn't add `.js`
- TS2307 is when the module simply can't be found at all

For `../src/app.module` - if `src/app.module.ts` exists, you'd get TS2835. If it doesn't exist, you'd get TS2307. The fact that we get TS2307 suggests `src/app.module.ts` doesn't exist yet (it's part of the migration to create).

But for my file, I need to import `AppModule` from somewhere. If the file doesn't exist yet, I can't fix that by changing my import - the module simply isn't there.

However, the task says "fixing what these messages require of this file." The only message for `test/bigint-format.spec.ts` is the `@nestjs/common` one. So I just need to make sure my file doesn't have that error. Since `@nestjs/common` is a package (not a relative import), and it would be installed via package.json, the "fix" is just having the correct import statement.

I think the right approach is: write the file correctly, assuming all dependencies and source files will be in place. The compiler errors are telling me what's wrong with the CURRENT file, and I'm writing a NEW correct version.

Let me also consider: should I use `import * as request from 'supertest'` or `import request from 'supertest'`? With ESM and `node16` resolution, supertest has a default export... actually, supertest is a CJS module. With `esModuleInterop` (which is typically enabled in NestJS projects), `import request from 'supertest'` should work. But to be safe, let me use `import * as request from 'supertest'` which is the pattern I see suggested in NestJS docs for ESM.

Actually, looking at the other test files' errors - `test/validate-negative-price.spec.ts(4,21): error TS2307: Cannot find module 'supertest'` - this is just a missing dependency, not an import style issue.

Let me go with the standard NestJS testing pattern:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
```

Wait, but if I add `.js` to the relative import and the file is `app.module.ts`, that's correct for ESM/node16 resolution. But the error for other files importing `../src/app.module` is TS2307 (not found), not TS2835 (needs extension). This suggests the file doesn't exist yet. If I write `../src/app.module.js` and the file doesn't exist, I'll still get an error. But that's not my problem to fix - it's a missing source file, not a problem with my test file.

Hmm, but actually - should I use `.js` extension or not? Let me look at the TS2835 errors again:
```
test/transaction-failure.spec.ts(5,32): error TS2835: ... Did you mean '../src/db/client.js'?
test/transaction-failure.spec.ts(7,47): error TS2835: ... Did you mean '../src/db/schema.js'?
```

These files (`client.ts` and `schema.ts`) DO exist (they were created as part of the migration). So the compiler can find them but complains about missing `.js` extension.

For `../src/app.module` - TS2307 means the compiler can't find it at all. This could be because:
1. The file doesn't exist, OR
2. Without the `.js` extension, the compiler can't resolve it in node16 mode

Actually, in node16/nodenext mode, if you write `import ... from '../src/app.module'`, the compiler looks for:
- `../src/app.module.ts` (it strips `.js` and tries `.ts`)... wait no, it looks for the exact path or with extensions.

Actually in `node16` mode:
- Relative imports MUST have an extension
- `../src/app.module` without extension → error (TS2835 if the file exists, TS2307 if it doesn't)

So `../src/app.module` should be `../src/app.module.js` in my file. If the source file doesn't exist yet, I'll still get an error, but that's expected - it's not a problem with my test file's syntax.

OK let me just write the file. I'll use `.js` extensions for relative imports to be correct under node16/nodenext.

Actually, wait. Let me reconsider whether to use `.js` or not. The convention section says:

"ESM, `"type": "module"`"

And the TS2835 errors confirm that `moduleResolution` is `node16` or `nodenext`. So yes, relative imports need `.js` extensions.

But here's the thing - if ALL the other test files use `../src/app.module` (without `.js`) and get TS2307, maybe the tsconfig is actually set to `bundler` resolution (which doesn't require extensions) and the TS2835 errors are from a different cause?

No - TS2835 explicitly says "when '--moduleResolution' is 'node16' or 'nodenext'". So the resolution IS node16/nodenext.

OK, I'll use `.js` extensions for relative imports. Final answer:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('BigInt wire format', () => {
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

  it('zero-amount invoice serialises as "0"', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Zero Co', email: `zero-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Free tier', unit_price_cents: 0, quantity: 1 }],
      })
      .expect(201);

    expect(invoiceRes.body.total_cents).toBe('0');
    expect(typeof invoiceRes.body.total_cents).toBe('string');
  });

  it('negative balance serialises with minus sign', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Co', email: `neg-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Charge', unit_price_cents: 50, quantity: 1 }],
      })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .expect(200);

    expect(getRes.body.balance_cents).toBe('-50');
    expect(typeof getRes.body.balance_cents).toBe('string');
  });
});
```

Wait, I need to double-check the request body field names. In the plan:
- `CreateInvoiceDto` is mentioned but its exact fields aren't specified in detail
- The API uses snake_case for columns

Looking at the `void-invoice.spec.ts` error:
```
test/void-invoice.spec.ts(147,22): error TS2352: Conversion of type 'Record<string, unknown>' to type 'Record<string, unknown>[]'
```

This suggests the test does something like `body.line_items as Record<string, unknown>[]` - so the response field is `line_items` (snake_case).

For the request, I'll assume snake_case as well: `account_id`, `line_items`, `unit_price_cents`.

Actually, hmm - let me think about this differently. In NestJS with Prisma, the typical pattern is:
- Prisma models use camelCase in TypeScript
- The API might use camelCase or snake_case depending on the DTO mapping

But the plan explicitly says:
- "field presence, null vs missing, numeric string formats"
- Columns are snake_case
- The DTOs have fields that serialize BigInt as string

Given that the plan says "public API contract byte-compatible" and the columns are snake_case, I'll go with snake_case for the wire format.

Actually, I just realized I should look at this from a different angle. The plan says the DTOs are:
- `AccountDto` - with fields like `credit_limit_cents`, `balance_cents`, etc.
- These are the field names in the TypeScript type

In NestJS, if you define:
```ts
class AccountDto {
  credit_limit_cents: string;
  balance_cents: string;
}
```

Then the JSON will have `credit_limit_cents` and `balance_cents` as keys.

For the input DTO:
```ts
class CreateInvoiceDto {
  account_id: string;
  line_items: LineItemDto[];
}
```

This gives `account_id` and `line_items` in the JSON request.

I'll go with snake_case throughout. This is consistent with the Prisma schema using `@map` for snake_case columns.

One more thought: the `expect` function - in Vitest, it's globally available (if configured) or needs to be imported. Since the project uses Vitest, `expect` should be globally available via the `vitest/globals` config or by importing from 'vitest'. 

Looking at the other test files, none of them show an error about `expect` not being found. So either:
1. It's globally available (vitest globals enabled in config), OR
2. It's imported and the import doesn't cause an error (because vitest is installed)

I'll assume globals are enabled (common in NestJS + Vitest setups). If not, I'd need `import { expect } from 'vitest'`. But since no error mentions `expect`, I'll leave it as a global.

Let me finalize my answer.
```

## reply

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('BigInt wire format', () => {
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

  it('zero-amount invoice serialises as "0"', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Zero Co', email: `zero-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Free tier', unit_price_cents: 0, quantity: 1 }],
      })
      .expect(201);

    expect(invoiceRes.body.total_cents).toBe('0');
    expect(typeof invoiceRes.body.total_cents).toBe('string');
  });

  it('negative balance serialises with minus sign', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Co', email: `neg-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Charge', unit_price_cents: 50, quantity: 1 }],
      })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .expect(200);

    expect(getRes.body.balance_cents).toBe('-50');
    expect(typeof getRes.body.balance_cents).toBe('string');
  });
});
```
