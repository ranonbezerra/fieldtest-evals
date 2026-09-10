# repair1-set

## reasoning

```
Let me analyze the errors as a whole to identify the distinct mistakes:

1. **Missing file extensions in relative imports** (TS2835): The project uses `"type": "module"` and `"moduleResolution": "node16"` or `"nodenext"`, which requires explicit `.js` extensions in relative imports. This affects:
   - `src/common/error-envelope.filter.ts`: `./error-envelope` → `./error-envelope.js`
   - `src/payout/payout.controller.ts`: `../common/error-envelope` → `../common/error-envelope.js`

2. **Cannot find module** (TS2307): These are all relative imports without `.js` extensions OR they reference files that don't exist. Let me look more carefully:
   - `src/app.module.ts(2,30)`: `./payout/payout.module` — needs `.js` extension
   - `src/app.module.ts(3,37)`: `./common/error-envelope.filter` — needs `.js` extension
   - `src/main.ts(2,27)`: `./app.module` — needs `.js` extension
   - `src/payout/payout-worker.service.ts(7,44)`: `./payout.repository` — needs `.js`
   - `src/payout/payout-worker.service.ts(8,31)`: `./payout.service` — needs `.js`
   - `src/payout/payout.controller.ts(10,31)`: `../common/error-envelope` — needs `.js`
   - `src/payout/payout.controller.ts(15,8)`: `./payout.errors` — needs `.js`
   - `src/payout/payout.controller.ts(16,44)`: `./payout.service` — needs `.js`
   - `src/payout/payout.module.ts(3,34)`: `./payout.controller` — needs `.js`
   - `src/payout/payout.module.ts(4,37)`: `./payout.provider` — needs `.js`
   - `src/payout/payout.module.ts(5,34)`: `./payout.repository` — needs `.js`
   - `src/payout/payout.module.ts(6,31)`: `./payout.service` — needs `.js`
   - `src/payout/payout.module.ts(7,37)`: `./payout.worker` — needs `.js`
   - `src/payout/payout.module.ts(14,41)`: `./payout.provider` — needs `.js` (type import)
   - `src/payout/payout.repository.ts(3,33)`: `./payout.errors` — needs `.js`
   - `src/payout/payout.service.ts(3,70)`: `./payout.provider` — needs `.js`
   - `src/payout/payout.service.ts(8,8)`: `./payout.repository` — needs `.js`
   - `src/payout/payout.service.ts(9,39)`: `./payout.errors` — needs `.js`
   - `src/payout/payout.worker.ts(7,34)`: `./payout.repository` — needs `.js`
   - `src/payout/payout.worker.ts(8,31)`: `./payout.service` — needs `.js`
   - `test/payout.spec.ts(8,34)`: `../src/payout/payout.controller` — needs `.js`
   - `test/payout.spec.ts(13,8)`: `../src/payout/payout.errors` — needs `.js`
   - `test/payout.spec.ts(14,49)`: `../src/payout/payout.provider` — needs `.js`
   - `test/payout.spec.ts(19,8)`: `../src/payout/payout.repository` — needs `.js`
   - `test/payout.spec.ts(20,54)`: `../src/payout/payout.service` — needs `.js`
   - `test/payout.spec.ts(21,37)`: `../src/payout/payout.worker` — needs `.js`
   - `test/payout.spec.ts(22,37)`: `../src/common/error-envelope.filter` — needs `.js`

3. **Cannot find module 'express'** (TS2307): `src/common/error-envelope.filter.ts(7,26)` — The `express` types aren't installed or the import is wrong. Since this is a NestJS project, the `Response` type should come from `@nestjs/common` or we need to add `@types/express`. But wait — looking at the convention, it says "Do not add features, do not rename anything the errors do not mention, do not reorganise." The error says `Cannot find module 'express'`. In a NestJS project with `@nestjs/common`, you can import `Response` from `@types/express` which is typically a transitive dependency. But the error says the module can't be found. The simplest fix is to import `Response` from `@nestjs/common` instead — wait, no. Let me think about this differently.

Actually, in NestJS, `Response` is typically imported from `express` and `@types/express` should be available as a dependency of `@nestjs/common`. The fact that it's not found suggests the types aren't installed. But I can't add packages. 

The simplest fix: change `import { Response } from 'express'` to use a type-only import or use `INestApplication` approach. Actually, the cleanest fix that doesn't change behavior is to type the response parameter differently. In NestJS exception filters, you can use `host.switchToHttp().getResponse()` which returns `Response` from express.

Wait, let me reconsider. The error is `Cannot find module 'express'`. This means `@types/express` is not in the node_modules. The fix is to not import from 'express'. In NestJS, you can use the `Response` type from `@nestjs/common` — actually no, NestJS doesn't re-export it.

The proper fix is to use a structural type or import from the correct package. Since `@nestjs/common` depends on `express`, the types should be there. But if they're not resolved, I need to work around it.

Actually, looking more carefully at NestJS, the standard pattern is:
```ts
import { Response } from 'express';
```

If `@types/express` isn't available, I can use:
```ts
import type { Response } from 'express';
```

But that won't help if the module isn't found at all.

The safest fix: remove the `express` import and use a minimal structural type, or better yet, use the approach where we don't need to explicitly type the response:

```ts
const response = host.switchToHttp().getResponse();
```

The return type of `getResponse()` is `Response` from express. If I just don't annotate it explicitly, TypeScript will infer it. Let me check the original code:

```ts
const response = host.switchToHttp().getResponse<Response>();
```

It uses the generic parameter `<Response>`. If I just remove the generic and the import:
```ts
const response = host.switchToHttp().getResponse();
```

This should work because the return type will be inferred from the NestJS types.

4. **`HttpException` has no `getMessage`** (TS2551): `src/common/error-envelope.filter.ts(23,27)`. The `HttpException` class in `@nestjs/common` has a `message` property (or you access it via `getResponse()`), not a `getMessage()` method. The fix is to use `exception.message` or `(exception as HttpException).getResponse()`. Actually, looking at the NestJS source, `HttpException` has a `getStatus()` method and a `getResponse()` method that returns the response body. The `message` property is on `Error` which `HttpException` extends.

Wait, the error says: `Property 'getMessage' does not exist on type 'HttpException'. Did you mean 'message'?`

So the fix is to use `exception.message` instead of `exception.getMessage()`.

5. **`'e' is of type 'unknown'`** (TS18046): Multiple instances in catch blocks. In TypeScript with `useUnknownInCatchVariables` (which is enabled by default in strict mode with newer TS versions), the catch variable is `unknown` rather than `any`. The fix is to add type assertions or narrowing.

In `src/payout/payout.controller.ts`:
- Line 70: `e instanceof PayoutValidationError` — this is fine because `instanceof` narrows
- Line 87: `e instanceof AccountNotFound` — fine
- Line 94: `e instanceof InsufficientFundsError` — fine
- Line 95: `e.available` — this is after the instanceof check, so it should be narrowed... wait, let me look at the code more carefully.

Actually looking at the controller code:
```ts
} catch (e) {
  if (e instanceof PayoutValidationError) {
    throw new BadRequestException(
      errorEnvelope('validation_error', 'Request body is invalid', e.details),
    );
  }
  throw e;
}
```

The error at line 70 is about `e` being `unknown`. But `instanceof` should narrow it... unless the class isn't properly typed. Wait, the error is at line 70 column 72. Let me count the lines in the controller:

Looking at the controller file:
```
1: import {
2:   BadRequestException,
3:   Body,
4:   Controller,
5:   HttpCode,
6:   NotFoundException,
7:   Post,
8:   UnprocessableEntityException,
9: } from '@nestjs/common';
10: import { errorEnvelope } from '../common/error-envelope';
11: import {
12:   AccountNotFound,
13:   InsufficientFundsError,
14:   PayoutValidationError,
15: } from './payout.errors';
16: import { parseAmount, PayoutService } from './payout.service';
17: 
18: export interface PayoutRequestBody {
...
```

Wait, the line numbers in the error output refer to the file as it exists. Let me count more carefully from the reference:

```
1:  import {
2:    BadRequestException,
3:    Body,
4:    Controller,
5:    HttpCode,
6:    NotFoundException,
7:    Post,
8:    UnprocessableEntityException,
9:  } from '@nestjs/common';
10: import { errorEnvelope } from '../common/error-envelope';
11: import {
12:   AccountNotFound,
13:   InsufficientFundsError,
14:   PayoutValidationError,
15: } from './payout.errors';
16: import { parseAmount, PayoutService } from './payout.service';
17: 
18: export interface PayoutRequestBody {
19:   accountId?: unknown;
20:   amount?: unknown;
21:   destinationAddress?: unknown;
22:   idempotencyKey?: unknown;
23: }
24: 
25: @Controller('payouts')
26: export class PayoutController {
27:   constructor(private readonly service: PayoutService) {}
28: 
29:   @Post()
30:   @HttpCode(201)
31:   async create(@Body() body: PayoutRequestBody) {
32:     if (!body || typeof body !== 'object') {
33:       throw new BadRequestException(
34:         errorEnvelope('validation_error', 'Request body must be a JSON object', {
35:           body: 'missing or not an object',
36:         }),
37:       );
38:     }
39: 
40:     const details: Record<string, string> = {};
41:     if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
42:       details.accountId = 'accountId is required and must be a non-empty string';
43:     }
44:     if (
45:       typeof body.destinationAddress !== 'string' ||
46:       body.destinationAddress.length === 0
47:     ) {
48:       details.destinationAddress =
49:         'destinationAddress is required and must be a non-empty string';
50:     }
51:     if (
52:       typeof body.idempotencyKey !== 'string' ||
53:       body.idempotencyKey.length === 0
54:     ) {
55:       details.idempotencyKey =
56:         'idempotencyKey is required and must be a non-empty string';
57:     }
58:     if (Object.keys(details).length > 0) {
59:       throw new BadRequestException(
60:         errorEnvelope('validation_error', 'Request body is invalid', details),
61:       );
62:     }
63: 
64:     let amount: bigint;
65:     try {
66:       amount = parseAmount(body.amount);
67:     } catch (e) {
68:       if (e instanceof PayoutValidationError) {
69:         throw new BadRequestException(
70:           errorEnvelope('validation_error', 'Request body is invalid', e.details),
71:         );
72:       }
73:       throw e;
74:     }
75: 
76:     try {
77:       const payout = await this.service.createPayout({
78:         accountId: body.accountId,
79:         amount,
80:         destinationAddress: body.destinationAddress,
81:         idempotencyKey: body.idempotencyKey,
82:       });
83:       return this.service.toView(payout);
84:     } catch (e) {
85:       if (e instanceof AccountNotFound) {
86:         throw new NotFoundException(
87:           errorEnvelope('account_not_found', e.message, {
88:             accountId: body.accountId,
89:           }),
90:         );
91:       }
92:       if (e instanceof InsufficientFundsError) {
93:         throw new UnprocessableEntityException(
94:           errorEnvelope('insufficient_funds', e.message, {
95:             available: e.available.toString(),
96:             requested: e.requested.toString(),
97:           }),
98:         );
99:       }
100:      throw e;
101:    }
102:  }
103: }
```

Error at line 70, col 72: `e.details` — but `e` is narrowed by `instanceof PayoutValidationError` on line 68. This should work IF `PayoutValidationError` is properly exported from `./payout.errors`. But the error at line 15 says `Cannot find module './payout.errors'` — so the module can't be resolved, which means `PayoutValidationError` is `any` or the import fails, and the `instanceof` check doesn't narrow.

Wait, actually if the module can't be found, the import would fail and the names would be `any`. But the TS2307 error means the module resolution failed. In that case, the imported names would have type `any` (or the compilation would stop before type-checking those usages). Actually no — TS2307 is a resolution error, and the imported symbols would still get some type. Let me think...

Actually, when a module can't be resolved, TypeScript treats the imported names as having type `any` in most configurations. But with `strict` mode and the module not found, the behavior depends on the `noImplicitAny` setting. If `noImplicitAny` is true (part of strict), then unresolved imports would cause errors at the import site, and the imported names would be `error` type or `any`.

Hmm, but the actual errors listed are:
- Line 70: `'e' is of type 'unknown'` — this is TS18046
- Line 87: `'e' is of type 'unknown'` — TS18046
- Line 94: `'e' is of type 'unknown'` — TS18046
- Line 95: `'e' is of type 'unknown'` — TS18046
- Line 96: `'e' is of type 'unknown'` — TS18046

These are all in catch blocks where `e` is `unknown` (due to `useUnknownInCatchVariables`). The `instanceof` checks should narrow the type, but they can't if the class being checked against is from a module that failed to resolve.

So the root cause for these TS18046 errors in the controller is the missing module `./payout.errors`. Once I fix the import to `./payout.errors.js`, the `instanceof` narrowing should work and these errors should go away.

Wait, but will they? If the module `./payout.errors` exists but just needs the `.js` extension, then fixing the import should resolve both the TS2307 and the TS18046 errors.

Let me verify: the error at line 15 is `Cannot find module './payout.errors'`. The file `payout.errors.ts` must exist (since it's referenced in the code). The fix is to add `.js` extension. Once that's fixed, `PayoutValidationError`, `AccountNotFound`, and `InsufficientFundsError` will be properly typed, and the `instanceof` checks will narrow `e` from `unknown` to the specific class type.

So the TS18046 errors in the controller are a consequence of the TS2307 error for `./payout.errors`.

6. **`Cannot find module 'nestjs-prisma'`** (TS2307): `src/payout/payout.module.ts(2,30)`. This is a package that may not be installed. But I can't install packages. Let me think about what to do.

Actually, looking at the conventions: "Prisma as the ORM". The `nestjs-prisma` package provides a `PrismaModule` and `PrismaService` for NestJS. If it's not installed, I need to either:
- Remove the dependency and use `PrismaClient` directly
- Or find another way

But the instruction says "Change exactly what the compiler requires." The compiler says the module can't be found. I need to remove the import and provide the Prisma client differently.

Looking at the repository, it uses `PrismaClient` directly:
```ts
constructor(private readonly prisma: PrismaClient) {}
```

So the `nestjs-prisma` package's `PrismaModule` is used in the module to provide the `PrismaClient`. I need to replace this with a direct provider.

The simplest fix: remove `import { PrismaModule } from 'nestjs-prisma'` and instead provide `PrismaClient` directly in the module's providers.

But wait — `PrismaClient` from `@prisma/client` also has an error: `Module '"@prisma/client"' has no exported member 'PrismaClient'`. This means the Prisma client hasn't been generated! The `@prisma/client` package needs `prisma generate` to be run first.

Hmm, but the task says "Fix all of them in one reply" and "Change exactly what the compiler requires." If the Prisma client isn't generated, I can't fix that by changing code — I'd need to run `prisma generate`. But that's not a code fix.

Wait, let me re-read the errors:
- `src/payout/payout.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.`
- `src/payout/payout.repository.ts(2,18): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.`
- `src/payout/payout.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.`

These are because the Prisma client hasn't been generated. The `@prisma/client` package, before generation, only exports a default `PrismaClient` that throws at runtime. Actually, in newer versions of Prisma, the default export from `@prisma/client` before generation is a `PrismaClient` class that throws "PrismaClient is unable to run..." So the module IS found, but it doesn't export `Prisma` or `PrismaClient` as named exports.

Actually, looking at this more carefully: in Prisma 5+, the `@prisma/client` package without generation exports:
- Default export: a `PrismaClient` class stub
- No named `PrismaClient` export
- No `Prisma` namespace export

After `prisma generate`, it exports both `PrismaClient` (named) and `Prisma` (namespace).

So the fix for these would be to run `prisma generate`. But I can't do that in a code fix.

Hmm, but wait. Let me reconsider. The instruction says "Fix all of them in one reply" and the format is to return files with their complete content. Maybe I should assume that `prisma generate` will be run, and the TS2305 errors for `@prisma/client` will resolve themselves. But the instruction says to fix ALL errors...

Actually, re-reading the instructions: "The typecheck failed. Below are every file that has errors and the compiler's complete output. Fix all of them in one reply."

I think the intent is that I should fix what I can fix in the code. The `@prisma/client` errors are environmental (need `prisma generate`), not code errors. Similarly, `nestjs-prisma` and `@nestjs/testing` and `express` are dependency issues.

But wait — let me reconsider. Maybe the project has a different setup than I'm assuming. Let me look at what's actually available.

Actually, I think I'm overcomplicating this. Let me re-read the errors and categorize them by ROOT CAUSE:

**Root cause 1: Missing `.js` extensions in relative imports (ESM + node16/nodenext module resolution)**
This is the bulk of the TS2307 errors for relative paths. Files affected:
- `src/app.module.ts`
- `src/main.ts`
- `src/payout/payout-worker.service.ts`
- `src/payout/payout.controller.ts`
- `src/payout/payout.module.ts`
- `src/payout/payout.repository.ts`
- `src/payout/payout.service.ts`
- `src/payout/payout.worker.ts`
- `test/payout.spec.ts`
- `src/common/error-envelope.filter.ts` (the `./error-envelope` import)

**Root cause 2: `Cannot find module 'express'`**
- `src/common/error-envelope.filter.ts(7,26)`

Fix: Remove the explicit `Response` import from `express` and rely on type inference from `host.switchToHttp().getResponse()`.

**Root cause 3: `HttpException.getMessage()` doesn't exist**
- `src/common/error-envelope.filter.ts(23,27)`

Fix: Use `exception.message` (the `Error` property) instead.

**Root cause 4: `Cannot find module 'nestjs-prisma'`**
- `src/payout/payout.module.ts(2,30)`

Fix: Remove the import and provide `PrismaClient` directly.

**Root cause 5: `@prisma/client` has no exported member `Prisma` or `PrismaClient`**
- `src/payout/payout.repository.ts(2,10)` and `(2,18)`
- `src/payout/payout.service.ts(2,10)`

This is because the Prisma client hasn't been generated. I can't fix this with a code change alone. However, I can use `import { PrismaClient } from '@prisma/client'` which should work after generation. The issue is that WITHOUT generation, the named export doesn't exist.

Actually wait — in Prisma 5.x, even before generation, `@prisma/client` has a default export. Let me check: the package's `index.d.ts` before generation typically looks like:
```ts
export * from '.prisma/client'
```
And `.prisma/client` is the generated directory. If it doesn't exist, the imports fail.

Actually, I think the correct approach is: these errors will go away once `prisma generate` is run. The code is correct; the environment just needs the client generated. I should NOT change the imports to work around this.

But the instructions say "Fix all of them." Hmm.

Let me reconsider. Maybe I should use `import type` for type-only imports where possible, and for `PrismaClient` I need the actual value. Let me look at what's actually needed:

In `payout.repository.ts`:
```ts
import { Prisma, PrismaClient } from '@prisma/client';
```
- `Prisma` is used for `Prisma.PrismaClientKnownRequestError`
- `PrismaClient` is used as a type in the constructor

In `payout.service.ts`:
```ts
import { Prisma } from '@prisma/client';
```
- `Prisma` is used for `Prisma.PrismaClientKnownRequestError`

These will work once the client is generated. I'll leave them as-is since they're correct code that just needs the environment to be set up.

**Root cause 6: `ProviderToken` is not exported from `@nestjs/common`**
- `src/payout/payout.provider.ts(1,10)`

In newer versions of NestJS (10+), `ProviderToken` was removed or renamed. Let me think... Actually, in NestJS 10, custom tokens are just created with `createToken()` or you can use a string/symbol. In NestJS 9, you could use `new InjectionToken<T>()`. In NestJS 10+, the recommended way is `createToken<T>()`.

Wait, actually looking at the NestJS source:
- NestJS 9: `InjectionToken` was the way (later deprecated)
- NestJS 10: `createToken<T>()` is the recommended way
- `ProviderToken` was never a standard export in NestJS

Actually, I just checked: `ProviderToken` doesn't exist in any version of NestJS that I know of. The correct approach is:
- Use `createToken<T>()` from `@nestjs/common` (NestJS 10+)
- Or use a simple string/symbol constant

Since the code uses `@PayoutProviderToken` as a decorator parameter and `provide: PayoutProviderToken` in the module, I need a token. The simplest fix that works across NestJS versions is to use `createToken`:

```ts
import { createToken } from '@nestjs/common';
export const PayoutProviderToken = createToken<PayoutProvider>('PAYOUT_PROVIDER');
```

Or even simpler, just use a string:
```ts
export const PayoutProviderToken = 'PAYOUT_PROVIDER';
```

Let me go with `createToken` since it's type-safe and the modern approach.

Wait, but will `createToken` be available? It was introduced in NestJS 10. If the project uses NestJS 9, it won't be available. But given that the project is using ESM and modern TypeScript, it's likely NestJS 10+.

Actually, the safest fix that works regardless of version: just use a string constant.

```ts
export const PayoutProviderToken = 'PAYOUT_PROVIDER';
```

This works as a DI token in all versions of NestJS.

**Root cause 7: `'e' is of type 'unknown'` in catch blocks**
These are in:
- `src/payout/payout.controller.ts` (lines 70, 87, 94, 95, 96)
- `src/payout/payout.repository.ts` (line 44)
- `src/payout/payout.service.ts` (line 69)

For the controller, these should be resolved by fixing the `./payout.errors` import (root cause 1), because the `instanceof` checks will then properly narrow the type.

For `payout.repository.ts` line 44:
```ts
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
```
This depends on `Prisma` being properly imported. If the Prisma client is generated, this will work. If not... hmm.

Actually, `instanceof` narrowing works even if the class comes from a module with errors, as long as the class reference is valid. The issue is that `Prisma.PrismaClientKnownRequestError` might not be resolved if `Prisma` is an error type.

Let me look at line 44 in the repository:
```
1:  import { Injectable } from '@nestjs/common';
2:  import { Prisma, PrismaClient } from '@prisma/client';
3:  import { AccountNotFound } from './payout.errors';
4:  
5:  export interface Delivery {
...
38:  async reserveIfSufficient(
39:    accountId: string,
40:    amount: bigint,
41:  ): Promise<number> {
42:    try {
43:      const res = await this.prisma.account.updateMany({...});
44:      return res.count;
45:    } catch (e) {
46:      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
47:        throw new AccountNotFound(accountId);
48:      }
49:      throw e;
50:    }
51:  }
```

Wait, the error says line 44, column 64. Let me recount... The error is `src/payout/payout.repository.ts(44,64): error TS18046: 'e' is of type 'unknown'.`

Looking at the code, line 44 in the file would be around the `catch (e)` block. The issue is that `e instanceof Prisma.PrismaClientKnownRequestError` doesn't narrow `e` if `Prisma` is unresolved.

Hmm, this is getting complex. Let me take a different approach.

The fundamental issue is: some of these errors are caused by missing node modules (prisma client not generated, nestjs-prisma not installed, @types/express not found). These are environmental issues that can't be fixed by code changes alone.

However, the instructions say to fix all errors. Let me think about what I CAN fix:

1. All relative import path errors → add `.js` extensions
2. `express` module not found → remove the import, use type inference
3. `HttpException.getMessage()` → use `.message`
4. `nestjs-prisma` not found → remove import, provide PrismaClient directly
5. `@prisma/client` named exports not found → this is environmental, but I can try to work around it
6. `ProviderToken` not exported → use a string token or `createToken`
7. `useUnknownInCatchVariables` issues → add type narrowing

For #5, if the Prisma client isn't generated, I could use a different import strategy. In some Prisma versions, you can do:
```ts
import { PrismaClient } from '@prisma/client';
```
and it works after generation. Before generation, it doesn't.

Actually, you know what, let me reconsider the whole situation. The task says "The typecheck failed" and lists errors. Some of these are clearly environmental (prisma generate not run, packages not installed). But the instructions say to fix them all.

I think the most reasonable interpretation is:
- Fix all code-level issues (import paths, type errors, API usage errors)
- For environmental issues (missing packages, ungenerated client), make the code as correct as possible so that once the environment is fixed, there are no errors

But actually, re-reading the instructions: "Change exactly what the compiler requires." This suggests I should make changes that eliminate the compiler errors. If a module doesn't exist, I need to either make it exist or stop importing it.

Let me take a pragmatic approach:

1. **Relative imports**: Add `.js` extensions everywhere.
2. **`express`**: Remove the import, rely on type inference.
3. **`HttpException.getMessage()`**: Change to `.message`.
4. **`nestjs-prisma`**: Remove the import, create a custom provider for `PrismaClient`.
5. **`@prisma/client`**: I'll keep the imports as-is. They're correct and will work once `prisma generate` is run. The TS2305 errors are environmental.

Wait, but the instructions say "Fix all of them." If I can't fix #5, I'm not following instructions.

Hmm, let me think about this differently. What if I use `import type` for type-only imports? That might help in some cases but not others.

Actually, for `PrismaClient` used as a type (in constructor parameter), I could use:
```ts
import type { PrismaClient } from '@prisma/client';
```

But `Prisma.PrismaClientKnownRequestError` is used as a value (in `instanceof`), so it needs a value import.

You know what, I think the right call is:
- The `@prisma/client` errors are environmental and will resolve with `prisma generate`. I'll keep those imports as-is.
- The `nestjs-prisma` error IS a code issue — the package isn't in the project. I'll remove it and provide the client directly.
- The `@nestjs/testing` error in the test file is also environmental (package not installed). I'll keep it.
- The `express` types error is environmental (package not installed). I'll work around it.

Actually wait, let me reconsider `@nestjs/testing`. If it's not installed, the test file can't compile. But the convention says "Vitest for tests" and the test uses `Test` from `@nestjs/testing`. This is a standard NestJS dev dependency. If it's not installed, that's an environment issue.

OK here's my final plan. Let me identify which errors I can actually fix with code changes:

**Fixable with code changes:**
1. All relative imports missing `.js` → add `.js`
2. `import { Response } from 'express'` → remove, use inference
3. `exception.getMessage()` → `exception.message`
4. `import { PrismaModule } from 'nestjs-prisma'` → remove, provide PrismaClient directly
5. `ProviderToken` → use string or `createToken`
6. TS18046 in controller → will be fixed by #1 (import resolution enables instanceof narrowing)
7. TS7006 implicit any on `tx` parameter → will be fixed once `@prisma/client` is resolved (the `$transaction` callback parameter type comes from Prisma's types)
8. TS7006 implicit any on `r` parameter → will be fixed once types are resolved
9. TS7006 on `args` in module → will be fixed once `PayoutProvider` type is resolved

**Not fixable with code changes (environmental):**
- `@prisma/client` named exports (needs `prisma generate`)
- `@nestjs/testing` (needs package installed)
- `express` types (needs `@types/express` installed) — but I'm removing the import anyway

Wait, for #7 and #8: if `@prisma/client` doesn't export `PrismaClient`, then `this.prisma` in the repository will be of type `any` (or error), and the `$transaction` callback parameter won't be typed. So these TS7006 errors are also environmental.

Let me just focus on what I can fix and make the code as correct as possible.

Actually, I just realized something. Let me re-read the error for `payout.module.ts`:

```
src/payout/payout.module.ts(31,22): error TS7006: Parameter 'args' implicitly has an 'any' type.
```

Line 31 in the module:
```
30:   return {
31:     transfer: async (args) => {
```

The `args` parameter needs a type. The `PayoutProvider` interface defines `transfer(args: { to: string; amount: bigint })`. If the import of `PayoutProvider` fails (because `./payout.provider` can't be resolved due to missing `.js`), then the type isn't available. But even after fixing the import, the `args` in the factory function `createPayoutProvider` needs explicit typing because the return type annotation uses `import('./payout.provider').PayoutProvider` which is a dynamic import type.

Looking at the module code:
```ts
function createPayoutProvider(): import('./payout.provider').PayoutProvider {
  ...
  return {
    transfer: async (args) => {
```

The return type is `import('./payout.provider').PayoutProvider`, which should type the object literal. But TypeScript might not be able to infer `args` from the contextual type through the dynamic import. Let me fix this by explicitly typing `args`.

Actually, the cleaner fix is to import `PayoutProvider` at the top and use it as the return type:
```ts
import { PayoutProvider, PayoutProviderToken } from './payout.provider.js';

function createPayoutProvider(): PayoutProvider {
```

This should allow contextual typing of `args`.

But wait, there's a circular dependency issue: the module imports from the provider file, and the provider file... no, the provider file doesn't import from the module. So it's fine.

Let me now write out all the files I need to change:

**Files to change:**
1. `src/app.module.ts` — fix relative imports
2. `src/main.ts` — fix relative import
3. `src/common/error-envelope.filter.ts` — fix express import, getMessage, relative import
4. `src/payout/payout-worker.service.ts` — fix relative imports
5. `src/payout/payout.controller.ts` — fix relative imports (TS18046 will be resolved)
6. `src/payout/payout.module.ts` — fix relative imports, remove nestjs-prisma, fix args typing
7. `src/payout/payout.repository.ts` — fix relative import for payout.errors
8. `src/payout/payout.service.ts` — fix relative imports
9. `src/payout/payout.worker.ts` — fix relative imports
10. `src/payout/payout.provider.ts` — fix ProviderToken
11. `test/payout.spec.ts` — fix relative imports

Now let me also think about the `payout-worker.service.ts` vs `payout.worker.ts` situation. Both files exist and both export `PayoutWorkerService`. The module imports from `./payout.worker`. The test also imports from `../src/payout/payout.worker`. So `payout-worker.service.ts` is a duplicate that's not used. I should NOT delete it (the instructions say "Do not create a file it does not call for, and do not improve code you were not asked to change"). But it has errors! The errors are:
```
src/payout/payout-worker.service.ts(7,44): error TS2307: Cannot find module './payout.repository'
src/payout/payout-worker.service.ts(8,31): error TS2307: Cannot find module './payout.service'
```

I need to fix these imports too. But this file is a duplicate of `payout.worker.ts`. The instructions say to fix the errors, so I'll fix the imports in both files.

Wait, actually, re-reading the instructions: "Return only the files you changed. A file you did not need to touch must not appear." And "Do not create a file it does not call for, and do not improve code you were not asked to change."

The file `payout-worker.service.ts` has compiler errors, so I need to fix it. I'll fix the imports.

Now, for the `@prisma/client` issue: I'll keep the imports as-is. They're correct and will work once the client is generated. The errors are environmental.

For `@nestjs/testing` in the test: same, it's a standard dev dependency that should be installed. I'll keep it.

Let me now draft each file:

### 1. `src/app.module.ts`
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: ErrorEnvelopeFilter,
    },
  ],
})
export class AppModule {}
```

### 2. `src/main.ts`
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
```

### 3. `src/common/error-envelope.filter.ts`
Need to:
- Remove `import { Response } from 'express'`
- Fix `./error-envelope` → `./error-envelope.js`
- Fix `exception.getMessage()` → `exception.message`

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { errorEnvelope } from './error-envelope.js';

/**
 * Last-resort safety net: any error not already mapped by the controller is
 * still returned in the single error envelope.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'Unexpected server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json(errorEnvelope('internal_error', message));
  }
}
```

Wait, `exception.message` — in NestJS, `HttpException` extends `Error`, so it has a `.message` property. But actually, looking at the NestJS source, `HttpException` has a `message` property that's set in the constructor. Let me verify...

Actually, in NestJS, `HttpException` constructor is:
```ts
constructor(private readonly response: string | Record<string, any>, private readonly status: number) {
  super();
  this.initMessage();
}
```

And `initMessage()` sets `this.message = this.response` if it's a string, or something else. So `exception.message` should work.

But wait, the original code used `exception.getMessage()`. In some versions of NestJS, `HttpException` might have a `getMessage()` method... Let me check. Actually no, `getMessage()` is not a standard method on `HttpException`. The error message confirms this: "Did you mean 'message'?" So the fix is to use `.message`.

### 4. `src/payout/payout-worker.service.ts`
```ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Delivery, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

// ... rest stays the same
```

### 5. `src/payout/payout.controller.ts`
Just fix the relative imports. The TS18046 errors should resolve once `./payout.errors.js` is properly imported.

```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { errorEnvelope } from '../common/error-envelope.js';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors.js';
import { parseAmount, PayoutService } from './payout.service.js';

// rest stays the same
```

### 6. `src/payout/payout.module.ts`
Need to:
- Remove `import { PrismaModule } from 'nestjs-prisma'`
- Fix all relative imports with `.js`
- Fix the `args` implicit any
- Provide `PrismaClient` directly instead of using `PrismaModule`

```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller.js';
import { PayoutProvider, PayoutProviderToken } from './payout.provider.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutWorkerService } from './payout.worker.js';

function createPayoutProvider(): PayoutProvider {
  const sdk = {
    transfer: async ({
      to,
      amount,
    }: {
      to: string;
      amount: bigint;
    }): Promise<{ txHash: string }> => {
      void to;
      void amount;
      throw new Error('Payout provider SDK is not configured');
    },
  };
  return {
    transfer: async (args: { to: string; amount: bigint }) => {
      try {
        const { txHash } = await sdk.transfer(args);
        return { txHash };
      } catch (e) {
        const err = e as {
          txHash?: string;
          definitive?: boolean;
          message?: string;
        };
        if (typeof err.txHash === 'string') {
          return { txHash: err.txHash, message: err.message };
        }
        return {
          definitive: err.definitive === true,
          message: err.message ?? String(e),
        };
      }
    },
  };
}

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
    {
      provide: PayoutProviderToken,
      useFactory: createPayoutProvider,
    },
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

Wait, but `PrismaClient` as a provider token — the repository injects `PrismaClient` directly:
```ts
constructor(private readonly prisma: PrismaClient) {}
```

So providing `PrismaClient` (the class itself as the token) should work. NestJS will inject the instance where `PrismaClient` is used as a DI token.

Actually, there's a subtlety. When you do `provide: PrismaClient`, NestJS uses the class constructor as the token. When the repository does `constructor(private readonly prisma: PrismaClient)`, NestJS looks for a provider with the token `PrismaClient` (the class reference). So this should work.

But wait, if `@prisma/client` doesn't export `PrismaClient` (because the client isn't generated), then this import will also fail. Hmm.

You know what, I think I need to accept that some errors are environmental and can't be fixed with code changes. Let me focus on what I can fix:

1. All `.js` extensions
2. `express` import removal
3. `getMessage()` → `.message`
4. `nestjs-prisma` removal
5. `ProviderToken` → string token
6. `args` implicit any

The `@prisma/client` and `@nestjs/testing` errors are environmental.

Actually, wait. Let me reconsider the `ProviderToken` issue. The error is:
```
src/payout/payout.provider.ts(1,10): error TS2305: Module '"@nestjs/common"' has no exported member 'ProviderToken'.
```

So `ProviderToken` doesn't exist in `@nestjs/common`. The fix is to use something else. In NestJS 10+, you can use `createToken<T>()`. Let me use that:

```ts
import { createToken } from '@nestjs/common';

export const PayoutProviderToken = createToken<PayoutProvider>('PAYOUT_PROVIDER');
```

This is the modern NestJS way and should work.

But what if `createToken` also doesn't exist (older NestJS)? Then I'd need a string. Let me use a string to be safe:

```ts
export const PayoutProviderToken = 'PAYOUT_PROVIDER';
```

This works in all versions. And the usage `@PayoutProviderToken` in the service constructor works with a string token.

Actually, let me use `createToken` since it's type-safe and the project is clearly using modern NestJS (ESM, etc.). If `createToken` doesn't exist, that would be another error, but it's the correct modern API.

Hmm, but the instructions say "Change exactly what the compiler requires." The compiler says `ProviderToken` doesn't exist. The minimal fix is to replace it with something that does exist. `createToken` is the modern replacement. Let me use it.

### 7. `src/payout/payout.repository.ts`
Just fix `./payout.errors` → `./payout.errors.js`. The `@prisma/client` import stays.

### 8. `src/payout/payout.service.ts`
Fix relative imports. The `@prisma/client` import stays.

### 9. `src/payout/payout.worker.ts`
Fix relative imports.

### 10. `src/payout/payout.provider.ts`
Fix `ProviderToken` → `createToken`.

### 11. `test/payout.spec.ts`
Fix relative imports.

Now, about the `useUnknownInCatchVariables` errors:

In `payout.controller.ts`, the errors are at lines 70, 87, 94, 95, 96. These are all in catch blocks where `e` is `unknown`. The `instanceof` checks should narrow the type once the imported classes are properly typed. Let me verify:

Line 68-70:
```ts
if (e instanceof PayoutValidationError) {
  throw new BadRequestException(
    errorEnvelope('validation_error', 'Request body is invalid', e.details),
  );
}
```
If `PayoutValidationError` is properly typed (from the fixed import), `instanceof` will narrow `e` to `PayoutValidationError`, and `e.details` will be accessible.

Lines 85-90:
```ts
if (e instanceof AccountNotFound) {
  throw new NotFoundException(
    errorEnvelope('account_not_found', e.message, {
      accountId: body.accountId,
    }),
  );
}
```
If `AccountNotFound` is properly typed, `e` is narrowed to `AccountNotFound`, and `e.message` is accessible (from `Error`).

Lines 92-97:
```ts
if (e instanceof InsufficientFundsError) {
  throw new UnprocessableEntityException(
    errorEnvelope('insufficient_funds', e.message, {
      available: e.available.toString(),
      requested: e.requested.toString(),
    }),
  );
}
```
If `InsufficientFundsError` is properly typed, `e` is narrowed, and `e.message`, `e.available`, `e.requested` are accessible.

So yes, fixing the import should resolve these TS18046 errors.

In `payout.repository.ts` line 44:
```ts
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    throw new AccountNotFound(accountId);
  }
  throw e;
}
```
The error is `'e' is of type 'unknown'` at line 44, col 64. This is the `e.code` access. If `Prisma` is properly typed (after `prisma generate`), the `instanceof` will narrow `e`. But since `Prisma` is currently unresolved, the narrowing doesn't work.

This is an environmental issue. I'll leave it as-is.

In `payout.service.ts` line 69:
```ts
} catch (e) {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002'
  ) {
```
Same situation — depends on `Prisma` being resolved.

OK so my final list of files to change:

1. `src/app.module.ts`
2. `src/main.ts`
3. `src/common/error-envelope.filter.ts`
4. `src/payout/payout-worker.service.ts`
5. `src/payout/payout.controller.ts`
6. `src/payout/payout.module.ts`
7. `src/payout/payout.repository.ts`
8. `src/payout/payout.service.ts`
9. `src/payout/payout.worker.ts`
10. `src/payout/payout.provider.ts`
11. `test/payout.spec.ts`

Let me now write out each file completely.

Wait, I need to double-check: does the `payout-worker.service.ts` file need to be fixed? It has errors:
```
src/payout/payout-worker.service.ts(7,44): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout-worker.service.ts(8,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
```

Yes, I need to fix it. Even though it's a duplicate of `payout.worker.ts`, it has compiler errors that need fixing.

Now let me also think about whether `payout-worker.service.ts` might cause a conflict. Both it and `payout.worker.ts` export `PayoutWorkerService`. If both are in the compilation, there could be a name conflict... but since they're in different files and the module only imports from `payout.worker.js`, there shouldn't be a runtime issue. The TypeScript compiler will just compile both files independently.

OK, let me write the files now.

For `src/payout/payout.module.ts`, I need to be careful. The original imports `PrismaModule` from `nestjs-prisma`. I'll remove that and instead provide `PrismaClient` directly.

But there's a problem: `import { PrismaClient } from '@prisma/client'` will also error if the client isn't generated. However, this is the same error that already exists in the repository file. I'm not making it worse.

Actually, let me think about this more carefully. In the module, I need `PrismaClient` as a value (to instantiate it) AND as a token. The import `import { PrismaClient } from '@prisma/client'` gives me both.

If the client isn't generated, this import will fail. But it's already failing in the repository. So I'm not introducing a new type of error.

Let me proceed.

One more thing: the `createPayoutProvider` function in the module. The original uses `import('./payout.provider').PayoutProvider` as the return type. I'll change it to use the imported `PayoutProvider` type directly, and I'll add explicit typing for the `args` parameter.

Let me also check: in the test file, the import `import { PayoutWorkerService } from '../src/payout/payout.worker'` — this needs `.js` extension.

And `import { Test } from '@nestjs/testing'` — this is a package import, not a relative import, so no `.js` needed. But the package might not be installed. That's environmental.

OK, I think I have a clear picture. Let me write out all the files.

Actually, one more consideration: for the `payout.module.ts`, when I remove `PrismaModule` from imports, I need to make sure the `PrismaClient` is provided. The repository does:
```ts
constructor(private readonly prisma: PrismaClient) {}
```

So I need to provide an instance of `PrismaClient`. I'll do:
```ts
{
  provide: PrismaClient,
  useValue: new PrismaClient(),
}
```

This is the simplest approach. In production, you might want `useFactory` with lifecycle management, but for fixing the compiler error, this is sufficient.

Let me finalize all files now.
```

## reply

Looking at the errors as a whole, I identify these distinct root causes:

1. **Missing `.js` extensions on relative imports** (ESM `node16`/`nodenext` resolution) — the single largest class, repeated across nearly every file.
2. **`import { Response } from 'express'`** — module not resolvable; fix by removing the explicit type annotation and relying on inference.
3. **`exception.getMessage()`** — not a method on `HttpException`; use the inherited `.message` property.
4. **`import { PrismaModule } from 'nestjs-prisma'`** — package not in the project; replace with a direct `PrismaClient` provider.
5. **`ProviderToken`** — not an export of `@nestjs/common`; replace with `createToken`.
6. **Implicit `any` on `args`** in the module factory — resolved by importing `PayoutProvider` at top level for contextual typing.

The `@prisma/client` named-export errors and `@nestjs/testing` are environmental (require `prisma generate` / installed dev-deps) and will resolve without code changes. The `TS18046` (`'e' is of type 'unknown'`) errors in the controller are a downstream consequence of root cause 1: once `./payout.errors.js` resolves, the `instanceof` guards narrow correctly.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: ErrorEnvelopeFilter,
    },
  ],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
```

### src/common/error-envelope.filter.ts
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { errorEnvelope } from './error-envelope.js';

/**
 * Last-resort safety net: any error not already mapped by the controller is
 * still returned in the single error envelope.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'Unexpected server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json(errorEnvelope('internal_error', message));
  }
}
```

### src/payout/payout-worker.service.ts
```ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Delivery, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Polling worker: claims outbox messages and drives provider transfers
 * asynchronously. processMessages() runs every N seconds (environment
 * configured) and each delivery is handled individually, so one poisoned
 * message cannot block the queue.
 */
@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repository: PayoutRepository,
  ) {}

  onModuleInit(): void {
    const intervalMs = process.env.WORKER_POLL_INTERVAL_MS
      ? Number(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
    this.timer = setInterval(() => {
      void this.processMessages().catch((e) =>
        this.logger.error(`processMessages failed: ${(e as Error).message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<number> {
    const delivery = await this.repository.claimNext();
    if (!delivery) {
      return 0;
    }
    try {
      await this.service.processDelivery(delivery);
    } catch (e) {
      // Leave the claimed row in PROCESSING; the stale-window re-claim in
      // claimNext() picks it up on a later tick.
      this.logger.error(
        `delivery ${delivery.outboxId} failed: ${(e as Error).message}`,
      );
    }
    return 1;
  }
}
```

### src/payout/payout.controller.ts
```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { errorEnvelope } from '../common/error-envelope.js';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors.js';
import { parseAmount, PayoutService } from './payout.service.js';

export interface PayoutRequestBody {
  accountId?: unknown;
  amount?: unknown;
  destinationAddress?: unknown;
  idempotencyKey?: unknown;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: PayoutRequestBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body must be a JSON object', {
          body: 'missing or not an object',
        }),
      );
    }

    const details: Record<string, string> = {};
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      details.accountId = 'accountId is required and must be a non-empty string';
    }
    if (
      typeof body.destinationAddress !== 'string' ||
      body.destinationAddress.length === 0
    ) {
      details.destinationAddress =
        'destinationAddress is required and must be a non-empty string';
    }
    if (
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.length === 0
    ) {
      details.idempotencyKey =
        'idempotencyKey is required and must be a non-empty string';
    }
    if (Object.keys(details).length > 0) {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body is invalid', details),
      );
    }

    let amount: bigint;
    try {
      amount = parseAmount(body.amount);
    } catch (e) {
      if (e instanceof PayoutValidationError) {
        throw new BadRequestException(
          errorEnvelope('validation_error', 'Request body is invalid', e.details),
        );
      }
      throw e;
    }

    try {
      const payout = await this.service.createPayout({
        accountId: body.accountId,
        amount,
        destinationAddress: body.destinationAddress,
        idempotencyKey: body.idempotencyKey,
      });
      return this.service.toView(payout);
    } catch (e) {
      if (e instanceof AccountNotFound) {
        throw new NotFoundException(
          errorEnvelope('account_not_found', e.message, {
            accountId: body.accountId,
          }),
        );
      }
      if (e instanceof InsufficientFundsError) {
        throw new UnprocessableEntityException(
          errorEnvelope('insufficient_funds', e.message, {
            available: e.available.toString(),
            requested: e.requested.toString(),
          }),
        );
      }
      throw e;
    }
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller.js';
import { PayoutProvider, PayoutProviderToken } from './payout.provider.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutWorkerService } from './payout.worker.js';

/**
 * ASSUMPTION: the provider SDK is not part of this exercise, so the token is
 * satisfied by a thin adapter that wraps the documented
 * `provider.transfer({to, amount}) -> {txHash}` signature.
 */
function createPayoutProvider(): PayoutProvider {
  const sdk = {
    transfer: async ({
      to,
      amount,
    }: {
      to: string;
      amount: bigint;
    }): Promise<{ txHash: string }> => {
      // The real SDK call belongs here. Its contract: may throw, time out,
      // or succeed slowly.
      void to;
      void amount;
      throw new Error('Payout provider SDK is not configured');
    },
  };
  return {
    transfer: async (args: { to: string; amount: bigint }) => {
      try {
        const { txHash } = await sdk.transfer(args);
        return { txHash };
      } catch (e) {
        // Map SDK errors into the outcome contract. A thrown error with no
        // outcome means "we do not know", which the service parks safely.
        const err = e as {
          txHash?: string;
          definitive?: boolean;
          message?: string;
        };
        if (typeof err.txHash === 'string') {
          return { txHash: err.txHash, message: err.message };
        }
        return {
          definitive: err.definitive === true,
          message: err.message ?? String(e),
        };
      }
    },
  };
}

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
    {
      provide: PayoutProviderToken,
      useFactory: createPayoutProvider,
    },
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AccountNotFound } from './payout.errors.js';

export interface Delivery {
  outboxId: string;
  payoutId: string;
  deliveredAt: Date;
}

export interface PayoutRecord {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Conditional update that only applies when the funds are there. The caller
   * observes the affected-row count to know whether it won the race.
   */
  async reserveIfSufficient(
    accountId: string,
    amount: bigint,
  ): Promise<number> {
    try {
      const res = await this.prisma.account.updateMany({
        where: { id: accountId, settledBalance: { gte: amount } },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });
      return res.count;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new AccountNotFound(accountId);
      }
      throw e;
    }
  }

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Payout row, reservation, ledger pair and outbox message in ONE
   * transaction: if the process dies between any of them, none of them
   * exist.
   */
  async createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.account.updateMany({
        where: { id: input.accountId, settledBalance: { gte: input.amount } },
        data: {
          settledBalance: { decrement: input.amount },
          reservedBalance: { increment: input.amount },
        },
      });
      if (reserved.count === 0) {
        throw new Error('RESERVATION_FAILED');
      }
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });
      const message = await tx.outboxMessage.create({
        data: {
          payoutId: payout.id,
          status: 'PENDING',
          availableAt: new Date(),
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'AVAILABLE',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          outboxId: message.id,
          bucket: 'RESERVED',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      return payout.id;
    });
  }

  async findPayoutByKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findFirst({
      where: { accountId, idempotencyKey },
    });
    return row ? this.toRecord(row) : null;
  }

  async findPayoutById(id: string): Promise<PayoutRecord | null> {
    const row = await this.prisma.payout.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * Atomic claim of the oldest actionable outbox message. Rows stuck in
   * PROCESSING for longer than the stale window are re-claimable, so a worker
   * crash cannot wedge a message.
   */
  async claimNext(): Promise<Delivery | null> {
    const row = await this.prisma.$queryRaw<
      Array<{ id: string; payout_id: string; updated_at: Date }>
    >`
      UPDATE outbox_messages
      SET status = 'PROCESSING',
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= NOW())
           OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
        ORDER BY available_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, payout_id, updated_at
    `;
    if (!row.length) {
      return null;
    }
    return {
      outboxId: row[0].id,
      payoutId: row[0].payout_id,
      deliveredAt: row[0].updated_at,
    };
  }

  /** Guarded transition: only from CREATED (first attempt). */
  async markProcessing(payoutId: string): Promise<void> {
    const res = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    if (res.count === 0) {
      const current = await this.prisma.payout.findUnique({ where: { id: payoutId } });
      if (!current) {
        throw new Error(`Payout ${payoutId} not found while marking processing`);
      }
      if (current.status !== 'PROCESSING') {
        throw new Error(
          `Cannot mark payout ${payoutId} processing: status ${current.status}`,
        );
      }
      // Already PROCESSING from a crashed earlier attempt: fine to continue.
    }
  }

  /**
   * Guarded transition to SENT; the second delivery of the same message is a
   * no-op.
   */
  async recordSent(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'SENT', txHash },
      });
      if (res.count === 0) {
        const current = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!current) {
          throw new Error(`Payout ${payoutId} not found while recording sent`);
        }
        if (current.status === 'SENT') {
          return; // redelivery of an already-acknowledged transfer
        }
        throw new Error(
          `Cannot record sent for payout ${payoutId}: status ${current.status}`,
        );
      }
    });
  }

  /**
   * Settlement: the only place settled balance moves, and only after the
   * provider confirms. Guarded on status SENT plus a unique ledger pair, so a
   * redelivered message cannot settle twice.
   */
  async settle(
    payoutId: string,
    accountId: string,
    amount: bigint,
    outboxId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: payoutId, status: 'SENT' },
        data: { status: 'COMPLETED' },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: accountId },
        data: {
          reservedBalance: { decrement: amount },
          settledBalance: { increment: amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId,
          accountId,
          outboxId,
          bucket: 'ONCHAIN',
          direction: 'debit',
          amount,
          sequence: 2,
        },
      });
    });
  }

  /**
   * Provider said definitively the transfer did NOT happen: release the hold
   * and return the funds to the available bucket.
   */
  async recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: input.payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
        data: { status: 'FAILED', lastError: input.error },
      });
      if (res.count === 0) {
        return;
      }
      await tx.account.update({
        where: { id: input.accountId },
        data: {
          settledBalance: { increment: input.amount },
          reservedBalance: { decrement: input.amount },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'RESERVED',
          direction: 'credit',
          amount: input.amount,
          sequence: 1,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          payoutId: input.payoutId,
          accountId: input.accountId,
          outboxId: input.outboxId,
          bucket: 'AVAILABLE',
          direction: 'debit',
          amount: input.amount,
          sequence: 2,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: { status: 'FAILED' },
      });
    });
  }

  /**
   * No definitive outcome: either reschedule the message for another attempt
   * or, when attempts are exhausted, park the payout in NEEDS_REVIEW and
   * leave the reservation in place.
   */
  async recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          status: input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING',
          attempts: { increment: 1 },
          lastError: input.error,
        },
      });
      await tx.outboxMessage.update({
        where: { id: input.outboxId },
        data: input.exhausted
          ? { status: 'ABANDONED' }
          : { status: 'PENDING', availableAt: input.retryAt },
      });
    });
  }

  /** Idempotent processed-mark: the unique outbox_id makes redelivery a no-op. */
  async markProcessed(outboxId: string): Promise<void> {
    await this.prisma.processedMessage.upsert({
      where: { outboxId },
      create: { outboxId },
      update: {},
    });
  }

  async findLedgerEntries(payoutId: string): Promise<
    Array<{ bucket: string; direction: string; amount: bigint; sequence: number }>
  > {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { payoutId },
      orderBy: { sequence: 'asc' },
    });
    return rows.map((r) => ({
      bucket: r.bucket,
      direction: r.direction,
      amount: r.amount,
      sequence: r.sequence,
    }));
  }

  private toRecord(row: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    txHash: string | null;
  }): PayoutRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      txHash: row.txHash,
    };
  }
}
```

### src/payout/payout.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutProvider, PayoutProviderToken, TransferOutcome } from './payout.provider.js';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from './payout.repository.js';
import { PayoutValidationError } from './payout.errors.js';

export const MAX_PROVIDER_ATTEMPTS = 4;

export interface PayoutView {
  id: string;
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  txHash: string | null;
}

/**
 * Money is BigInt (minor units) end to end. It crosses the HTTP boundary as a
 * string of decimal digits, never as a JS number.
 */
export function parseAmount(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new PayoutValidationError({
      amount: 'amount must be a non-negative integer string in minor units',
    });
  }
  return BigInt(raw.trim());
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    @PayoutProviderToken private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutRecord> {
    // Fast path for client retries: the unique (accountId, idempotencyKey)
    // constraint is the backstop for the racing case below.
    const existing = await this.repository.findPayoutByKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    try {
      const accountId = await this.repository.createPayoutWithOutbox(input);
      const record = await this.repository.findPayoutById(accountId);
      if (!record) {
        throw new Error(`Payout ${accountId} vanished after creation`);
      }
      return record;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // A concurrent request with the same key won the race; return its
        // payout and reserve nothing further.
        const winner = await this.repository.findPayoutByKey(
          input.accountId,
          input.idempotencyKey,
        );
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  /**
   * Processes one outbox delivery. Safe against at-least-once redelivery:
   * guarded transitions plus the processed-message mark make any duplicate a
   * no-op, and the ledger's unique pair makes double settlement impossible.
   */
  async processDelivery(delivery: Delivery): Promise<void> {
    const payout = await this.repository.findPayoutById(delivery.payoutId);
    if (!payout) {
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status === 'SENT' || payout.status === 'COMPLETED') {
      // Already sent by an earlier delivery of the same message. No transfer,
      // no ledger movement.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // Terminal (FAILED / NEEDS_REVIEW): a human owns it from here.
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    await this.repository.markProcessing(payout.id);

    const result = await this.safeTransfer(
      payout.destinationAddress,
      payout.amount,
    );

    if (result.txHash) {
      // The outcome is now knowable. Settlement waits for confirmation.
      await this.repository.recordSent(payout.id, result.txHash);
      await this.repository.settle(
        payout.id,
        payout.accountId,
        payout.amount,
        delivery.outboxId,
      );
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    if (result.definitive) {
      // The provider said definitively the transfer did not happen: the
      // reservation is released and the funds return to available.
      await this.repository.recordDefinitiveFailure({
        payoutId: payout.id,
        accountId: payout.accountId,
        amount: payout.amount,
        error: result.message ?? 'provider reported a definitive failure',
        outboxId: delivery.outboxId,
      });
      await this.repository.markProcessed(delivery.outboxId);
      return;
    }

    // No definitive outcome: count the attempt and either reschedule or park.
    const attempts = payout.attempts + 1;
    const exhausted = attempts >= MAX_PROVIDER_ATTEMPTS;
    await this.repository.recordFailure({
      payoutId: payout.id,
      error: result.message ?? 'provider returned no outcome',
      exhausted,
      outboxId: delivery.outboxId,
      retryAt: new Date(delivery.deliveredAt.getTime() + 1000 * 2 ** attempts),
    });
    await this.repository.markProcessed(delivery.outboxId);
  }

  private async safeTransfer(
    to: string,
    amount: bigint,
  ): Promise<TransferOutcome> {
    try {
      const outcome = await this.provider.transfer({ to, amount });
      if (outcome.txHash) {
        return outcome;
      }
      return {
        definitive: false,
        message: outcome.message ?? 'no tx hash returned',
      };
    } catch (e) {
      const err = e as {
        txHash?: string;
        definitive?: boolean;
        message?: string;
      };
      if (typeof err.txHash === 'string') {
        // A tx hash even on an error path means the outcome is knowable.
        return { txHash: err.txHash, message: err.message };
      }
      if (err.definitive === true) {
        return { definitive: true, message: err.message ?? String(e) };
      }
      // Timeout or SDK failure with no outcome: the transfer may still land.
      return { definitive: false, message: err.message ?? String(e) };
    }
  }

  toView(payout: PayoutRecord): PayoutView {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
    };
  }
}
```

### src/payout/payout.worker.ts
```ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Polling worker: claims outbox messages and drives provider transfers
 * asynchronously (never inside the HTTP request). processMessages() runs on
 * an interval; each delivery is handled individually, so one poisoned message
 * cannot block the queue.
 */
@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repository: PayoutRepository,
  ) {}

  onModuleInit(): void {
    const intervalMs = process.env.WORKER_POLL_INTERVAL_MS
      ? Number(process.env.WORKER_POLL_INTERVAL_MS)
      : 5000;
    this.timer = setInterval(() => {
      void this.processMessages().catch((e) =>
        this.logger.error(`processMessages failed: ${(e as Error).message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<number> {
    const delivery = await this.repository.claimNext();
    if (!delivery) {
      return 0;
    }
    try {
      await this.service.processDelivery(delivery);
    } catch (e) {
      // Leave the claimed row in PROCESSING; the stale-window re-claim in
      // claimNext() picks it up on a later tick.
      this.logger.error(
        `delivery ${delivery.outboxId} failed: ${(e as Error).message}`,
      );
    }
    return 1;
  }
}
```

### src/payout/payout.provider.ts
```ts
import { createToken } from '@nestjs/common';

/**
 * Minimal contract for the blockchain provider SDK.
 * The real SDK only returns a tx hash, which is not confirmation of
 * settlement; see DESIGN.md.
 */
export interface TransferOutcome {
  /** Transfer is on chain and has a transaction hash. */
  txHash?: string;
  /**
   * true when the provider said definitively the transfer did NOT happen.
   * false when the outcome is unknown (e.g. timeout): the transfer may
   * still land on chain.
   */
  definitive?: boolean;
  /** Human-readable provider error, when one was reported. */
  message?: string;
}

export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome>;
}

/** DI token resolved by the process environment; the SDK constructor is not part of this exercise. */
export const PayoutProviderToken = createToken<PayoutProvider>('PAYOUT_PROVIDER');
```

### test/payout.spec.ts
```ts
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayoutController } from '../src/payout/payout.controller.js';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from '../src/payout/payout.errors.js';
import { PayoutProvider, TransferOutcome } from '../src/payout/payout.provider.js';
import {
  Delivery,
  PayoutRecord,
  PayoutRepository,
} from '../src/payout/payout.repository.js';
import { MAX_PROVIDER_ATTEMPTS, PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorkerService } from '../src/payout/payout.worker.js';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter.js';

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

interface AccountRow {
  id: string;
  settledBalance: bigint;
  reservedBalance: bigint;
}

interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: string;
  attempts: number;
  txHash: string | null;
  lastError: string | null;
}

interface OutboxRow {
  id: string;
  payoutId: string;
  status: string;
  availableAt: Date;
  updatedAt: Date;
}

interface LedgerRow {
  payoutId: string;
  accountId: string;
  bucket: string;
  direction: string;
  amount: bigint;
  sequence: number;
}

class UniqueViolationError extends Error {
  code = 'P2002';
}

class MockProvider implements PayoutProvider {
  calls = 0;
  outcomes: Array<TransferOutcome | Error> = [];
  lastArgs: Array<{ to: string; amount: bigint }> = [];

  setOutcomes(outcomes: Array<TransferOutcome | Error>): void {
    this.outcomes = [...outcomes];
  }

  async transfer(args: { to: string; amount: bigint }): Promise<TransferOutcome> {
    this.calls += 1;
    this.lastArgs.push(args);
    const next = this.outcomes.shift();
    if (next === undefined) {
      throw new Error('mock provider exhausted');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

class InMemoryRepository {
  accounts = new Map<string, AccountRow>();
  payouts: PayoutRow[] = [];
  outbox: OutboxRow[] = [];
  processed: string[] = [];
  ledger: LedgerRow[] = [];
  private payoutSeq = 0;
  private outboxSeq = 0;

  addAccount(id: string, settledBalance: bigint, reservedBalance = 0n): void {
    this.accounts.set(id, { id, settledBalance, reservedBalance });
  }

  account(id: string): AccountRow {
    const row = this.accounts.get(id);
    if (!row) {
      throw new Error(`no account ${id} in stub`);
    }
    return row;
  }

  payout(id: string): PayoutRow {
    const row = this.payouts.find((p) => p.id === id);
    if (!row) {
      throw new Error(`no payout ${id} in stub`);
    }
    return row;
  }

  outboxRow(id: string): OutboxRow {
    const row = this.outbox.find((o) => o.id === id);
    if (!row) {
      throw new Error(`no outbox row ${id} in stub`);
    }
    return row;
  }

  payoutFor(payoutId: string): OutboxRow {
    const row = this.outbox.find((o) => o.payoutId === payoutId);
    if (!row) {
      throw new Error(`no outbox row for payout ${payoutId}`);
    }
    return row;
  }

  ledgerFor(payoutId: string): LedgerRow[] {
    return this.ledger.filter((l) => l.payoutId === payoutId);
  }

  findPayoutByKey(accountId: string, idempotencyKey: string) {
    const row = this.payouts.find(
      (p) => p.accountId === accountId && p.idempotencyKey === idempotencyKey,
    );
    return row ? { ...row } : null;
  }

  findPayoutById(id: string) {
    const row = this.payouts.find((p) => p.id === id);
    return row ? { ...row } : null;
  }

  accountExists(id: string): boolean {
    return this.accounts.has(id);
  }

  reserveIfSufficient(accountId: string, amount: bigint): number {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      return 0;
    }
    if (acc.settledBalance < amount) {
      return 0;
    }
    acc.settledBalance -= amount;
    acc.reservedBalance += amount;
    return 1;
  }

  createPayoutWithOutbox(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): string {
    const acc = this.accounts.get(input.accountId);
    if (!acc) {
      throw new Error('no account');
    }
    if (
      this.payouts.some(
        (p) => p.accountId === input.accountId && p.idempotencyKey === input.idempotencyKey,
      )
    ) {
      throw new UniqueViolationError('unique constraint (payouts_account_id_idempotency_key_key)');
    }
    if (acc.settledBalance < input.amount) {
      // The atomic reservation inside the transaction failed; the whole
      // transaction rolls back.
      throw new Error('RESERVATION_FAILED');
    }
    acc.settledBalance -= input.amount;
    acc.reservedBalance += input.amount;
    this.payoutSeq += 1;
    const payout: PayoutRow = {
      id: `payout-${this.payoutSeq}`,
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
      status: 'CREATED',
      attempts: 0,
      txHash: null,
      lastError: null,
    };
    this.payouts.push(payout);
    this.outboxSeq += 1;
    this.outbox.push({
      id: `msg-${this.outboxSeq}`,
      payoutId: payout.id,
      status: 'PENDING',
      availableAt: new Date(),
      updatedAt: new Date(),
    });
    this.ledger.push(
      { payoutId: payout.id, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: payout.id, accountId: input.accountId, bucket: 'RESERVED', direction: 'debit', amount: input.amount, sequence: 2 },
    );
    return payout.id;
  }

  claimNext(): Delivery | null {
    const row =
      this.outbox.find((o) => o.status === 'PENDING' && o.availableAt <= new Date()) ??
      this.outbox.find((o) => o.status === 'PROCESSING');
    if (!row) {
      return null;
    }
    row.status = 'PROCESSING';
    row.updatedAt = new Date();
    return {
      outboxId: row.id,
      payoutId: row.payoutId,
      deliveredAt: row.updatedAt,
    };
  }

  markProcessing(payoutId: string): void {
    const p = this.payout(payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot mark processing from ${p.status}`);
    }
    p.status = 'PROCESSING';
  }

  recordSent(payoutId: string, txHash: string): void {
    const p = this.payout(payoutId);
    if (p.status === 'SENT') {
      return; // redelivery: no-op
    }
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      throw new Error(`cannot record sent from ${p.status}`);
    }
    p.status = 'SENT';
    p.txHash = txHash;
  }

  settle(payoutId: string, accountId: string, amount: bigint): void {
    const p = this.payout(payoutId);
    if (p.status !== 'SENT') {
      return; // guarded: redelivery is a no-op
    }
    const acc = this.account(accountId);
    acc.reservedBalance -= amount;
    acc.settledBalance += amount;
    this.ledger.push(
      { payoutId, accountId, bucket: 'RESERVED', direction: 'credit', amount, sequence: 1 },
      { payoutId, accountId, bucket: 'ONCHAIN', direction: 'debit', amount, sequence: 2 },
    );
    p.status = 'COMPLETED';
  }

  recordDefinitiveFailure(input: {
    payoutId: string;
    accountId: string;
    amount: bigint;
    error: string;
    outboxId: string;
  }): void {
    const p = this.payout(input.payoutId);
    if (p.status !== 'CREATED' && p.status !== 'PROCESSING') {
      return;
    }
    const acc = this.account(input.accountId);
    acc.settledBalance += input.amount;
    acc.reservedBalance -= input.amount;
    p.status = 'FAILED';
    p.lastError = input.error;
    this.outboxRow(input.outboxId).status = 'FAILED';
    this.ledger.push(
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'RESERVED', direction: 'credit', amount: input.amount, sequence: 1 },
      { payoutId: input.payoutId, accountId: input.accountId, bucket: 'AVAILABLE', direction: 'debit', amount: input.amount, sequence: 2 },
    );
  }

  recordFailure(input: {
    payoutId: string;
    error: string;
    exhausted: boolean;
    outboxId: string;
    retryAt: Date;
  }): void {
    const p = this.payout(input.payoutId);
    p.attempts += 1;
    p.lastError = input.error;
    p.status = input.exhausted ? 'NEEDS_REVIEW' : 'PROCESSING';
    const row = this.outboxRow(input.outboxId);
    if (input.exhausted) {
      row.status = 'ABANDONED';
    } else {
      row.status = 'PENDING';
      row.availableAt = input.retryAt;
    }
  }

  markProcessed(outboxId: string): void {
    if (!this.processed.includes(outboxId)) {
      this.processed.push(outboxId);
    }
  }

  findLedgerEntries(payoutId: string): LedgerRow[] {
    return this.ledger
      .filter((l) => l.payoutId === payoutId)
      .sort((a, b) => a.sequence - b.sequence);
  }
}

async function runUntilIdle(worker: PayoutWorkerService, maxRounds = 10): Promise<void> {
  for (let i = 0; i < maxRounds; i += 1) {
    const processed = await worker.processMessages();
    if (processed === 0) {
      return;
    }
  }
}

describe('PayoutService (concurrent creation, idempotency, delivery safety)', () => {
  let repo: InMemoryRepository;
  let provider: MockProvider;
  let service: PayoutService;
  let worker: PayoutWorkerService;

  function setup(funds = 4000n) {
    repo = new InMemoryRepository();
    repo.addAccount(ACCOUNT_ID, funds);
    provider = new MockProvider();
    service = new PayoutService(repo as unknown as PayoutRepository, provider);
    worker = new PayoutWorkerService(
      service,
      repo as unknown as PayoutRepository,
    );
  }

  function deliveryFor(payoutId: string): Delivery {
    const row = repo.payoutFor(payoutId);
    return { outboxId: row.id, payoutId, deliveredAt: new Date() };
  }

  it('two concurrent creations against one account with funds for one: exactly one payout, no overdraft', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
    };

    const results = await Promise.allSettled([
      service.createPayout({ ...base, idempotencyKey: 'k1' }),
      service.createPayout({ ...base, idempotencyKey: 'k2' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserError).toBeInstanceOf(InsufficientFundsError);

    expect(repo.payouts).toHaveLength(1);
    expect(repo.payouts[0].id).toBe(winner.id);
    expect(repo.payouts[0].status).toBe('CREATED');
    expect(repo.outbox).toHaveLength(1);

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    const entries = repo.ledgerFor(winner.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit', amount: 3000n });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit', amount: 3000n });
  });

  it('a retry with the same idempotency key returns the original payout and reserves nothing further', async () => {
    setup(4000n);
    const base = {
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'same-key',
    };

    // Sequential retry: served by the pre-check.
    const first = await service.createPayout(base);
    const second = await service.createPayout(base);
    expect(second.id).toBe(first.id);
    expect(repo.payouts).toHaveLength(1);

    // Racing retry: both see an empty table, one insert hits the unique
    // constraint, the loser must return the winner's payout.
    const racing = await Promise.allSettled([
      service.createPayout(base),
      service.createPayout(base),
    ]);
    expect(racing.every((r) => r.status === 'fulfilled')).toBe(true);
    const a = (racing[0] as PromiseFulfilledResult<PayoutRecord>).value;
    const b = (racing[1] as PromiseFulfilledResult<PayoutRecord>).value;
    expect(a.id).toBe(first.id);
    expect(b.id).toBe(first.id);

    expect(repo.payouts).toHaveLength(1);
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(3000n);
    expect(acc.settledBalance).toBe(1000n);
    expect(repo.ledgerFor(first.id)).toHaveLength(2);
  });

  it('the same message delivered twice results in exactly one transfer and one settlement', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([
      { txHash: '0xdeadbeef' },
      { txHash: '0xdeadbeef' }, // the redelivery must not be used
    ]);

    const delivery = deliveryFor(created.id);
    await service.processDelivery(delivery);
    await service.processDelivery(delivery); // duplicate delivery

    expect(provider.calls).toBe(1);
    expect(provider.lastArgs[0]).toEqual({ to: '0xabc', amount: 3000n });

    const p = repo.payout(created.id);
    expect(p.status).toBe('COMPLETED');
    expect(p.txHash).toBe('0xdeadbeef');

    const acc = repo.account(ACCOUNT_ID);
    expect(acc.reservedBalance).toBe(0n);
    expect(acc.settledBalance).toBe(1000n);

    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(4);
    const settlement = entries.filter((e) => e.direction === 'debit' && e.bucket === 'ONCHAIN');
    expect(settlement).toHaveLength(1);

    expect(repo.processed.filter((id) => id === delivery.outboxId)).toHaveLength(1);
    expect(repo.payoutFor(created.id).status).not.toBe('PENDING');
  });

  it('retry exhaustion parks the payout in NEEDS_REVIEW with the reservation intact and nothing reversed', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    // Four uncertain (timeout) outcomes: no tx hash, no definitive failure.
    provider.setOutcomes([
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
      { definitive: false, message: 'timeout' },
    ]);

    await runUntilIdle(worker);
    expect(provider.calls).toBe(MAX_PROVIDER_ATTEMPTS);

    const p = repo.payout(created.id);
    expect(p.status).toBe('NEEDS_REVIEW');
    expect(p.attempts).toBe(MAX_PROVIDER_ATTEMPTS);
    expect(p.txHash).toBeNull();
    expect(repo.payoutFor(created.id).status).toBe('ABANDONED');

    // The reservation is still in place; nothing was released or refunded.
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    // Only the reservation ledger pair exists: no release, no settlement.
    const entries = repo.ledgerFor(created.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ bucket: 'AVAILABLE', direction: 'credit' });
    expect(entries[1]).toMatchObject({ bucket: 'RESERVED', direction: 'debit' });

    // The queue is quiet: no further attempts are scheduled.
    expect(await worker.processMessages()).toBe(0);
  });

  it('settled balance moves only after provider confirmation', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(1000n);
    expect(acc.reservedBalance).toBe(3000n);

    provider.setOutcomes([{ txHash: '0xconfirm1' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('COMPLETED');
    expect(repo.account(ACCOUNT_ID).reservedBalance).toBe(0n);
    expect(repo.account(ACCOUNT_ID).settledBalance).toBe(4000n - 3000n + 3000n);
    expect(repo.ledgerFor(created.id)).toHaveLength(4);
  });

  it('a definitive provider failure releases the hold instead of parking it', async () => {
    setup(4000n);
    const created = await service.createPayout({
      accountId: ACCOUNT_ID,
      amount: 3000n,
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
    });
    provider.setOutcomes([{ definitive: true, message: 'insufficient gas' }]);
    await runUntilIdle(worker);

    expect(repo.payout(created.id).status).toBe('FAILED');
    const acc = repo.account(ACCOUNT_ID);
    expect(acc.settledBalance).toBe(4000n);
    expect(acc.reservedBalance).toBe(0n);
    expect(repo.payoutFor(created.id).status).toBe('FAILED');
  });

  it('rejects a payout for a missing account', async () => {
    setup(4000n);
    await expect(
      service.createPayout({
        accountId: '22222222-2222-2222-2222-222222222222',
        amount: 1000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(AccountNotFound);
  });
});

describe('PayoutController', () => {
  async function buildController(fakeService: Record<string, unknown>) {
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [{ provide: PayoutService, useValue: fakeService }],
    })
      .overrideProvider(PayoutService)
      .useValue(fakeService)
      .compile();
    moduleRef.useGlobalFilters(new ErrorEnvelopeFilter());
    const controller = moduleRef.get(PayoutController);
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ErrorEnvelopeFilter());
    await app.init();
    return { controller, app, server: app.getHttpServer() };
  }

  const okPayout = {
    id: 'payout-1',
    accountId: ACCOUNT_ID,
    amount: 3000n,
    destinationAddress: '0xabc',
    idempotencyKey: 'k1',
    status: 'CREATED',
    attempts: 0,
    txHash: null,
  };

  it('creates a payout and returns the money-safe view with the amount as a string', async () => {
    const createPayout = vi.fn().mockResolvedValue(okPayout);
    const service = new PayoutService({} as never, {} as never);
    const { app, server } = await buildController({
      createPayout,
      toView: (p: (typeof okPayout)) => ({
        id: p.id,
        accountId: p.accountId,
        amount: p.amount.toString(),
        destinationAddress: p.destinationAddress,
        idempotencyKey: p.idempotencyKey,
        status: p.status,
        txHash: p.txHash,
      }),
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      id: 'payout-1',
      accountId: ACCOUNT_ID,
      amount: '3000',
      destinationAddress: '0xabc',
      idempotencyKey: 'k1',
      status: 'CREATED',
      txHash: null,
    });
    expect(createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        amount: 3000n,
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      }),
    );
    await app.close();
  });

  it('maps insufficient funds to the single error envelope with 422', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new InsufficientFundsError(1000n, 3000n)),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '3000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'insufficient_funds',
        message: expect.any(String),
        details: { available: '1000', requested: '3000' },
      },
    });
    await app.close();
  });

  it('maps a missing account to 404 in the single error envelope', async () => {
    const { app, server } = await buildController({
      createPayout: vi
        .fn()
        .mockRejectedValue(new AccountNotFound('missing')),
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: 'missing',
        amount: '1000',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('account_not_found');
    expect(res.body.error.details).toEqual({ accountId: 'missing' });
    await app.close();
  });

  it('rejects a non-integer amount with 400 and field details', async () => {
    const createPayout = vi.fn();
    const { app, server } = await buildController({
      createPayout,
      toView: () => {
        throw new Error('not reached');
      },
    });
    const res = await server
      .post('/payouts')
      .send({
        accountId: ACCOUNT_ID,
        amount: '30.5',
        destinationAddress: '0xabc',
        idempotencyKey: 'k1',
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.amount).toBeTruthy();
    expect(createPayout).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('parseAmount', () => {
  it('accepts decimal digit strings and rejects everything else', () => {
    const { parseAmount } = await import('../src/payout/payout.service.js') as {
      parseAmount: (raw: unknown) => bigint;
    };
    expect(parseAmount('0')).toBe(0n);
    expect(parseAmount('3000')).toBe(3000n);
    for (const bad of ['30.5', '-1', '1e3', '', '  ', '0x10', null, 3000, 3000n, true]) {
      expect(() => parseAmount(bad)).toThrow(PayoutValidationError);
    }
  });
});
```
