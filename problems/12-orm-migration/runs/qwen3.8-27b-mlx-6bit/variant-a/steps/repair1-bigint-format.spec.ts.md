# repair1-bigint-format.spec.ts

## reasoning

```
The user is asking me to fix `test/bigint-format.spec.ts` based on compiler errors. However, looking at the error messages carefully, they ALL refer to `test/void-invoice.spec.ts`, not `test/bigint-format.spec.ts`. 

Wait, let me re-read. The user says "test/bigint-format.spec.ts does not compile" but then shows error messages that are all from `test/void-invoice.spec.ts`. This is confusing.

Let me re-read the instruction: "Rewrite `test/bigint-format.spec.ts` complete, fixing what these messages require of this file."

But the messages are all about `test/void-invoice.spec.ts`. The errors are:
- Cannot find name 'expect'
- Cannot find name 'it'

These are standard Vitest globals that need to be imported or the tsconfig needs `types: ["vitest/globals"]`.

Wait, I need to think about this differently. The user says the compiler messages are "for the whole workspace" and asks me to rewrite `test/bigint-format.spec.ts`. But all the errors shown are from `test/void-invoice.spec.ts`. 

The instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

Actually wait - let me re-read more carefully. The user says "These are the compiler's exact messages for the whole workspace — not a summary of them" and then shows errors all from `test/void-invoice.spec.ts`. Then asks me to rewrite `test/bigint-format.spec.ts`.

This seems like the errors are from a different file than what I'm asked to fix. The instruction says "Change nothing the messages do not name." The messages name `test/void-invoice.spec.ts`, not `test/bigint-format.spec.ts`.

But the user explicitly asks: "Rewrite `test/bigint-format.spec.ts` complete, fixing what these messages require of this file."

I think the situation is: `test/bigint-format.spec.ts` has the same problem as `test/void-invoice.spec.ts` - it's missing imports for `describe`, `it`, `expect` from vitest. The compiler messages shown are from another file that has the same issue, and `test/bigint-format.spec.ts` likely has the same problem (it would produce identical errors if it also uses globals without importing them).

Actually, re-reading again: "These are the compiler's exact messages for the whole workspace — not a summary of them" - this means these are ALL the errors in the workspace. If `test/bigint-format.spec.ts` had the same issue, it would show up here too. So either:
1. `test/bigint-format.spec.ts` doesn't exist yet (needs to be created)
2. `test/bigint-format.spec.ts` compiles fine and the user is confused

Given the context of the PLAN.md which specifies what `test/bigint-format.spec.ts` should contain, and the user asking me to "Rewrite test/bigint-format.spec.ts complete", I think the file needs to be written (or rewritten) with proper imports.

The fix for the errors shown (which are about missing vitest globals) would be to properly import `describe`, `it`, `expect` from `'vitest'` in the file. Since the user asks me to rewrite `test/bigint-format.spec.ts`, I should write it with proper imports.

Let me write `test/bigint-format.spec.ts` according to the PLAN.md:
- "zero-amount invoice serialises as '0'" — total_cents=0 → `"total_cents":"0"` (string, not number, not omitted)
- "negative balance serialises with minus sign" — balance_cents=-50 → `"balance_cents":"-50"`

The tests should use the NestJS test module approach, importing from vitest explicitly (not relying on globals).

Looking at the project structure and conventions:
- NestJS + Vitest
- Tests in `test/` directory
- The tests should test behavior (API responses), not implementation

Let me write the file with explicit imports from 'vitest':

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
```

Now I need to figure out what the test infrastructure looks like. Based on the PLAN.md, tests use NestJS test module and make HTTP calls. Let me write a proper test file.

Actually, I don't have the actual source code of the project - I only have the PLAN.md and the error messages. The user says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The key issue: the errors shown are from `test/void-invoice.spec.ts`, not from `test/bigint-format.spec.ts`. The user asks me to rewrite `test/bigint-format.spec.ts` "fixing what these messages require of this file."

What do the messages require? They require that `expect` and `it` (and by extension `describe`) are properly resolved. The fix is to import them from 'vitest'.

Since I'm writing `test/bigint-format.spec.ts` and it needs to compile, I need to:
1. Import `describe`, `it`, `expect` from 'vitest'
2. Write the tests specified in PLAN.md

For the test infrastructure, I'll need to assume the standard NestJS testing pattern. Let me write something reasonable based on what the PLAN describes.

Looking at the plan more carefully:
- The app has accounts and invoices endpoints
- BigInt fields are serialized as strings in DTOs
- The test needs to verify:
  1. A zero-amount invoice serialises total_cents as "0" (string)
  2. A negative balance serialises with minus sign as "-50"

I'll need to set up a NestJS test module. Let me assume the standard pattern with `Test.createTestingModule` from `@nestjs/testing`.

Let me write this:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';

// I need to import the app module and database module
```

But I don't know the exact module names or structure. Let me make reasonable assumptions based on the PLAN.md and add ASSUMPTION lines where needed.

Actually, looking at this more carefully - the user's instruction is very specific: "Rewrite `test/bigint-format.spec.ts` complete, fixing what these messages require of this file." The messages are about missing `expect` and `it` globals. So the fix is simply to import them from vitest.

But I need to write the complete file. Let me write it with proper vitest imports and reasonable test code based on the plan.

Let me think about what assumptions I need:
1. The app module is at `src/app.module.ts` (per conventions)
2. There's a way to set up the test with a database connection
3. The endpoints are as described in the plan

I'll write the test file with explicit imports and reasonable structure. Where I can't see the actual shapes, I'll add ASSUMPTION lines.

Let me write a complete test file:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';

// ASSUMPTION: AppModule is the root module exported from src/app.module.ts
import { AppModule } from '../src/app.module';
// ASSUMPTION: DatabaseModule is the global module providing the DB connection
import { DatabaseModule } from '../src/db/database.module';

describe('bigint-format', () => {
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

  it('zero-amount invoice serialises as "0"', async () => {
    // Create an account
    const createAccountRes = await app.injector.get('http') ... 
  });
});
```

Hmm, I'm getting into guessing territory. Let me think about what's the minimal thing I can do that:
1. Fixes the compiler errors (import from vitest)
2. Follows the PLAN.md test descriptions
3. Uses reasonable NestJS testing patterns

Actually, I realize I should look at this from a different angle. The user said the errors are "for the whole workspace" and they're all from `test/void-invoice.spec.ts`. This means `test/bigint-format.spec.ts` either:
- Doesn't exist yet (I need to create it)
- Already compiles fine

Given the user says "Rewrite test/bigint-format.spec.ts complete", I'll create it fresh with proper imports.

For the testing approach, based on the conventions and PLAN, I'll use supertest or NestJS's built-in test utilities to make HTTP requests. Let me go with the standard NestJS testing approach using `app.inject()` or supertest.

Actually, looking at NestJS testing conventions, the typical pattern is:

```ts
import * as request from 'supertest';
// or
import { Test } from '@nestjs/testing';
```

Let me use a pattern that's common in NestJS + Vitest projects. I'll use `app.getHttpServer()` with a request library, or I can use the built-in methods.

Let me just write a clean test file that:
1. Imports from 'vitest' explicitly (fixing the compiler issue)
2. Sets up a NestJS test app
3. Tests the two behaviors from the plan
4. Uses ASSUMPTION lines where I'm guessing at shapes

Here's my approach - I'll keep it focused and practical:
```

## reply

```ts
// ASSUMPTION: The compiler errors shown are from test/void-invoice.spec.ts, not this file.
// They indicate missing Vitest globals (expect, it, describe). This file is written with
// explicit imports from 'vitest' so the same class of error cannot occur here.
//
// ASSUMPTION: The root module is exported as AppModule from src/app.module.ts, and the
// DatabaseModule from src/db/database.module.ts is @Global() so importing AppModule
// alone is sufficient to wire the DB provider into the test context.
//
// ASSUMPTION: The HTTP endpoints follow the kebab-case plural convention from the plan:
//   POST /accounts, POST /invoices, GET /invoices/:id, GET /accounts/:id
// and the response DTOs expose bigint money fields as JSON strings.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';

// ASSUMPTION: AppModule is the composition root that imports all feature modules
// (AccountsModule, InvoicesModule) and the global DatabaseModule.
import { AppModule } from '../src/app.module';

describe('bigint-format', () => {
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

  it('zero-amount invoice serialises as "0"', async () => {
    // Create an account to attach the invoice to.
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Zero Account', email: `zero-${Date.now()}@test.io` });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    // Create an invoice with no line items and zero tax → total_cents = 0.
    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({ account_id: accountId, tax_cents: 0, line_items: [] });
    expect(invRes.status).toBe(201);

    // Fetch the invoice back by id.
    const invoiceId: string = invRes.body.id;
    const getRes = await request(app.getHttpServer()).get(`/invoices/${invoiceId}`);
    expect(getRes.status).toBe(200);

    // total_cents must be the JSON string "0", not the number 0 and not absent.
    expect(getRes.body.total_cents).toBe('0');
    expect(typeof getRes.body.total_cents).toBe('string');
  });

  it('negative balance serialises with minus sign', async () => {
    // Create an account.
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Balance Account', email: `neg-${Date.now()}@test.io` });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    // Create an invoice for 50 cents so the account balance goes negative
    // (balance_cents = balance_cents - total_cents → 0 - 50 = -50).
    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        tax_cents: 0,
        line_items: [{ description: 'x', unit_price_cents: 50, quantity: 1 }],
      });
    expect(invRes.status).toBe(201);

    // Read the account back; balance_cents should be the string "-50".
    const getAcctRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(getAcctRes.status).toBe(200);
    expect(getAcctRes.body.balance_cents).toBe('-50');
    expect(typeof getAcctRes.body.balance_cents).toBe('string');
  });
});
```
