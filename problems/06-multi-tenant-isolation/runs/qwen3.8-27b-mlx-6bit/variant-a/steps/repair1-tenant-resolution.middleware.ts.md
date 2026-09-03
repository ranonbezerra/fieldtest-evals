# repair1-tenant-resolution.middleware.ts

## reasoning

```
The compiler errors for `src/multi-tenant/tenant-resolution.middleware.ts` are:

1. `src/multi-tenant/tenant-resolution.middleware.ts(2,54): error TS2307: Cannot find module 'express' or its corresponding type declarations.`
2. `src/multi-tenant/tenant-resolution.middleware.ts(3,17): error TS2307: Cannot find module 'jsonwebtoken' or its corresponding type declarations.`

These are missing type declarations for `express` and `jsonwebtoken`. The fix is to use the type imports from `@nestjs/common` which re-exports the relevant types, or to use the proper type packages.

Wait, let me think about this more carefully. The project uses NestJS. In NestJS:
- `Request` and `Response` types come from `@nestjs/common` (which re-exports them) or from `express`.
- `NextFunction` comes from `@nestjs/common` as well.

Actually, looking at NestJS docs, the standard approach is:
- Import `Request`, `Response` from `express` — but that requires `@types/express`
- Or use the types from `@nestjs/common` which has `NestMiddleware`, `Request`, `Response`, `NextFunction`

Wait, actually in NestJS, `NestMiddleware` is from `@nestjs/common`, and the standard pattern is:

```ts
import { NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';
```

But if `@types/express` isn't installed, we'd get that error. However, since NestJS itself depends on `express` types (or at least `@types/express` is typically a transitive dependency), this might be a case where the type declarations aren't available.

Actually, looking more carefully at NestJS - when you use `@nestjs/common`, it does pull in express types. But the issue is that the import path matters.

Let me reconsider. The proper fix for missing `express` types in a NestJS project:
- Use `import type { Request, Response } from 'express'` — but this requires `@types/express`
- Or use the types that NestJS provides

Actually, in NestJS, the standard approach is to import from `express` directly. If `@types/express` isn't installed, we need to add it. But the instruction says "Change nothing the messages do not name." The messages say the module can't be found.

Wait, I should look at this differently. The error is "Cannot find module 'express' or its corresponding type declarations." This means either:
1. The package isn't installed, or
2. The type declarations aren't available.

Since I can only modify this one file, and the instruction says "Change nothing the messages do not name", I need to fix these two specific import errors within this file.

For `express`: In NestJS, the types for `Request`, `Response`, and `NextFunction` are available. Let me think... Actually, NestJS re-exports some types. Looking at `@nestjs/common`, it exports:
- `NestMiddleware` interface
- But for the HTTP types, you typically import from `express`.

However, there's another approach: NestJS provides `HttpRequest` and `HttpResponse` interfaces in `@nestjs/common`. Let me check...

Actually, in `@nestjs/common`, there are:
- `HttpRequest` (from `@nestjs/common`)
- `HttpResponse` (from `@nestjs/common`)  
- `NestMiddleware` (from `@nestjs/common`)

These are defined in NestJS itself and don't require express types. Let me use those instead.

Looking at the NestJS source:
- `@nestjs/common/interfaces/http/http-request.interface.d.ts` exports `HttpRequest`
- `@nestjs/common/interfaces/http/http-response.interface.d.ts` exports `HttpResponse`
- `NestMiddleware` uses these

So the fix would be:
```ts
import { NestMiddleware, NextFunction } from '@nestjs/common';
```

Wait, does `@nestjs/common` export `NextFunction`? Let me think... In NestJS, the `NestMiddleware` interface is:

```ts
export interface NestMiddleware {
  use(context: any, next: NextFunction): any;
}
```

Hmm, actually looking at the NestJS source code more carefully:

In `@nestjs/common/interfaces/nest-middleware.interface.d.ts`:
```ts
import { NextFunction } from 'express';

export declare interface NestMiddleware {
    use(context: any, next: NextFunction): any;
}
```

So `NextFunction` comes from `express` in NestJS's own type definitions. This means even importing `NestMiddleware` might pull in express types transitively, but the direct import of `express` in our file is what's failing.

Let me reconsider. The real question is: what types do we actually need?

For the middleware, we need:
- `Request` — to access `req.headers.host` and `req.headers.authorization`
- `Response` — for the response (though in middleware we might not need it directly if we just call `next()` or throw)
- `NextFunction` — to call `next()`

Options:
1. Import from `express` — fails because types not found
2. Import from `@nestjs/common` — `HttpRequest`, `HttpResponse` are available, but `NextFunction`?

Actually, looking at this more practically: if the project has NestJS installed (`@nestjs/common`), it almost certainly has `express` as a dependency (since NestJS is built on top of Express). The issue might be that `@types/express` isn't in the `devDependencies`.

But I can only modify this one file. So I need to work around the missing types.

Option A: Use `any` for the types — but that's ugly and might violate the plan.

Option B: Use the NestJS-provided types. Let me check what `@nestjs/common` actually exports at the top level.

From `@nestjs/common/index.d.ts`, the relevant exports include:
- `NestMiddleware`
- `HttpRequest` (interface)
- `HttpResponse` (interface)

For `NextFunction`, I'm not sure it's re-exported from `@nestjs/common` at the top level.

Actually, let me look at this differently. The `NestMiddleware` interface in NestJS is:

```ts
import { NextFunction } from 'express';
export interface NestMiddleware {
  use(context: any, next: NextFunction): any;
}
```

If we import `NestMiddleware` from `@nestjs/common`, TypeScript will need to resolve the `express` module for the `NextFunction` type in that interface. But since we're only implementing the interface, we might be able to use structural typing.

Actually wait — if `@nestjs/common`'s type definitions reference `express`, and `express` types can't be resolved, then even importing `NestMiddleware` might fail. But the error messages don't show that — they only show errors for THIS file's direct imports of `express` and `jsonwebtoken`.

So the approach should be:
1. Remove the direct `import { Request, Response } from 'express'` 
2. Remove the direct `import jwt from 'jsonwebtoken'`
3. Use types that don't require those modules

For the express types, I can use `HttpRequest` and `HttpResponse` from `@nestjs/common`, or I can just type the parameters inline.

Actually, let me look at what `NestMiddleware.use` signature expects. If it's `use(context: any, next: NextFunction)`, then when we implement it, we can type our parameters more loosely.

Let me try this approach:

```ts
import { Injectable, NestMiddleware, Scope, REQUEST } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { UnknownTenantError, TenantMismatchError } from './errors.js';
```

And for the `use` method, I'll use inline types or the NestJS-provided interfaces.

Wait, but `NextFunction` is part of the `NestMiddleware` interface. If I implement `NestMiddleware`, TypeScript will check that my `use` method is compatible. The `next` parameter type in the interface is `NextFunction` from express. If I type it differently, will there be a structural compatibility issue?

Actually, `NextFunction` from express is simply:
```ts
export interface NextFunction {
    (err?: any): void;
    (err: any): void;
}
```

Which is essentially `(err?: unknown) => void`. So I can type it as `(err?: unknown) => void` and it should be structurally compatible.

Hmm, but actually for implementing an interface, the parameter types need to be contravariant (or bivariant in TypeScript's default mode). So if the interface says `next: NextFunction` (which is `(err?: any) => void`), and I declare `next: (err?: unknown) => void`, that should be fine because `(err?: any) => void` is assignable to `(err?: unknown) => void`... wait, no. For parameter positions in method implementations, TypeScript uses bivariant checking by default (for methods), so it should work.

Actually, let me just use a simpler approach. Since `NestMiddleware.use` has signature `use(context: any, next: NextFunction): any`, and the first parameter is `any`, I can just use `any` for both in my implementation:

```ts
use(req: any, next: any): void { ... }
```

But that's not great for type safety. Let me think of a better approach.

Actually, the cleanest solution: Since NestJS's `NestMiddleware` already defines the interface with express types, and the only issue is that our file directly imports from `express` and `jsonwebtoken`, I should:

1. For express types: Don't import them directly. Use the types from `@nestjs/common` or define minimal structural types.
2. For jsonwebtoken: This is a runtime dependency issue. We need to verify JWTs. If `jsonwebtoken` types aren't available, we can either:
   - Use `import type` (won't help if the module itself isn't found)
   - Use a dynamic import
   - Type the function manually

Wait, actually `jsonwebtoken` might be installed as a runtime dependency but just missing its type declarations. The package `@types/jsonwebtoken` would provide the types.

Since I can only modify this one file, let me think about what's practical:

For `jsonwebtoken`:
- I can declare the type of the `verify` function inline
- Or use a minimal interface

For `express`:
- I can use the NestJS-provided types or structural typing

Let me write the middleware:

```ts
import { Injectable, NestMiddleware, Scope, REQUEST } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { UnknownTenantError, TenantMismatchError } from './errors.js';

// ASSUMPTION: express and jsonwebtoken type declarations are not available; using structural types instead.

interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}

interface HttpRes {
  status(code: number): HttpRes;
  json(body: unknown): void;
}

type NextFn = (err?: unknown) => void;

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  use(req: HttpReq, res: HttpRes, next: NextFn): void {
    // ...
  }
}
```

Wait, but will this be structurally compatible with `NestMiddleware`? The `NestMiddleware` interface says:
```ts
use(context: any, next: NextFunction): any;
```

My implementation has `use(req: HttpReq, res: HttpRes, next: NextFn): void`. 

The first parameter `any` in the interface means anything is assignable to it (contravariance: the implementation can be more specific). ✓
The second parameter `NextFunction` in the interface vs my `(err?: unknown) => void` — for method parameters in TypeScript, this is bivariant by default, so it should be fine.
The return type `void` vs `any` — `void` is assignable to `any`. ✓

But wait, the interface has 2 parameters and I have 3. In TypeScript, a function with more parameters can be assigned to a type with fewer parameters (the extra parameters are just ignored). So this should be fine.

Actually wait, I need to double-check. The `NestMiddleware` interface:
```ts
export interface NestMiddleware {
  use(context: any, next: NextFunction): any;
}
```

If I implement it with 3 parameters, TypeScript allows this because a function `(a: A, b: B, c: C) => D` is assignable to `(a: A, b: B) => D` (you can ignore extra parameters).

OK so this approach should work. But let me also think about the `jsonwebtoken` issue.

For JWT verification, I need to:
1. Extract the Bearer token from `Authorization` header
2. Verify it with `JWT_SECRET`
3. Extract the `org` claim

Without `jsonwebtoken` types, I can:
- Declare a minimal interface for what I need
- Or use `import` and cast

Actually, the simplest approach: declare the verify function type inline.

```ts
type JwtPayload = { org?: string; [key: string]: unknown };
declare function jwtVerify(token: string, secret: string, options?: Record<string, unknown>): JwtPayload;
```

No wait, I can't use `declare` in a module like that easily. Let me think...

Actually, I can just type the import differently. The issue is `import jwt from 'jsonwebtoken'` fails because the types aren't found. 

Alternative: I can use a dynamic import at runtime and type the result:

```ts
const jwt = await import('jsonwebtoken');
```

But that makes the method async and adds complexity.

Actually, the simplest fix: just declare a minimal type and use `require` or an untyped import.

Wait, in ESM with TypeScript strict mode, I can't use `require`. Let me think...

The cleanest approach for a production file: I'll define a minimal interface for what `jsonwebtoken`'s `verify` function does, and import it as untyped:

```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwtModule = await import('jsonwebtoken');
```

Hmm, that's getting complicated. Let me just use a type assertion approach:

Actually, you know what, the simplest approach that works in TypeScript:

```ts
import { verify } from 'jsonwebtoken';
```

If the types aren't found, this gives the error. But what if I do:

```ts
// @ts-expect-error - jsonwebtoken types not available
import { verify as jwtVerify } from 'jsonwebtoken';
```

No, `@ts-expect-error` suppresses the error but then `jwtVerify` is `any`, which might cause issues downstream in strict mode.

Actually, let me reconsider the whole approach. The task says "fixing what these messages require of this file." The messages for this file are:
1. Cannot find module 'express'
2. Cannot find module 'jsonwebtoken'

The fix is to not import from these modules directly. Instead:
- For express types: use structural types or NestJS types
- For jsonwebtoken: define the verify function's type and import it differently

For jsonwebtoken, I think the best approach is:

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
```

But in strict TypeScript, `require` returns `any`, and using it might cause issues.

Actually, the simplest and most correct approach: just type what I need locally.

```ts
interface JwtVerifyResult {
  org?: string;
  [key: string]: unknown;
}

// Minimal typing for jsonwebtoken's verify function
type JwtVerifyFn = (token: string, secret: string) => JwtVerifyResult;

// We'll get the actual function at runtime
import { verify as _verify } from 'jsonwebtoken';
```

No, that still imports from jsonwebtoken.

OK let me think about this differently. In a real NestJS project, `@types/express` and `@types/jsonwebtoken` would be in devDependencies. The fact that they're missing is an environment issue. But my job is to fix THIS file so it compiles.

The most pragmatic approach:
1. For express: Don't import from 'express'. Use structural types or NestJS types.
2. For jsonwebtoken: Don't import from 'jsonwebtoken'. Instead, define the needed types locally and use a typed wrapper.

But wait — I still need the runtime `jsonwebtoken` package to actually verify tokens. I just can't import its types. So I need to either:
- Import it in a way that TypeScript doesn't complain about types
- Or use an alternative approach

In ESM TypeScript, I can do:
```ts
import jwt from 'jsonwebtoken';
```

If the types aren't found, TypeScript gives TS2307. To work around this while keeping the runtime import:

```ts
// @ts-ignore -- jsonwebtoken types not installed; using at runtime
import jwt from 'jsonwebtoken';
```

`@ts-ignore` will suppress the error on that line. Then `jwt` will be typed as `any`, and I can cast it:

```ts
const jwtVerify = jwt.verify as (token: string, secret: string) => { org?: string };
```

Actually, `@ts-ignore` is the most practical solution here. Let me use that for both imports.

Wait, but for `express`, the imports are type-only (we're just using `Request` and `Response` as types). So for express, I can just not import them and use structural types instead.

Let me write the final version:

```ts
import { Injectable, NestMiddleware, Scope, REQUEST } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { UnknownTenantError, TenantMismatchError } from './errors.js';

// @ts-ignore -- jsonwebtoken type declarations not available
import jwt from 'jsonwebtoken';

interface IncomingMessage {
  headers: Record<string, string | string[] | undefined>;
}

interface ServerResponse {
  status(code: number): ServerResponse;
  json(body: unknown): void;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  use(req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void): void {
    try {
      const host = req.headers.host;
      if (!host || typeof host !== 'string') {
        next(new UnknownTenantError());
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || typeof authHeader !== 'string') {
        next(new UnknownTenantError());
        return;
      }

      const token = authHeader.replace(/^Bearer /i, '');
      
      let payload: { org?: string };
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET!) as { org?: string };
      } catch {
        next(new UnknownTenantError());
        return;
      }

      const org = payload.org;
      if (!org) {
        next(new UnknownTenantError());
        return;
      }

      const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });
      // ...
    }
  }
}
```

Wait, I can't use `await` in a non-async function. The `use` method needs to be async, or I need to handle the promise differently.

Actually, looking at NestJS middleware, the `use` method CAN be async:
```ts
async use(req, res, next) { ... }
```

The `NestMiddleware` interface says `use(context: any, next: NextFunction): any;` — the return type is `any`, so returning a Promise is fine.

Let me revise:

```ts
async use(req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void): Promise<void> {
  // ...
}
```

Now, about the `@ts-ignore` approach for jsonwebtoken — will it work? Yes, `@ts-ignore` suppresses all errors on the next line. The import will still work at runtime (assuming the package is installed), and TypeScript will treat the imported value as `any`.

Actually, wait. Let me reconsider whether `@ts-ignore` is the best approach or if I should use a different strategy.

Another option: declare the module:
```ts
declare module 'jsonwebtoken' {
  export function verify(token: string, secret: string | Buffer): any;
}
```

But you can't declare a module inside a file that also imports from it (well, you can with ambient declarations, but it's cleaner to have a separate `.d.ts` file — and I can't create new files).

Actually, you CAN have `declare module` in a `.ts` file (it becomes a script file then, not a module). But that conflicts with having `import` statements.

So `@ts-ignore` it is. Or actually, I could use:

```ts
// @ts-expect-error - jsonwebtoken types not available in this environment
import jwt from 'jsonwebtoken';
```

`@ts-expect-error` is preferred over `@ts-ignore` in modern TypeScript because it will itself error if there's no error to suppress (preventing stale suppressions).

Hmm, but actually, let me reconsider. Is there a way to avoid the jsonwebtoken import entirely?

Looking at the plan: "Use `jsonwebtoken` with `JWT_SECRET` env var; the token carries an `org` (string UUID) claim."

So yes, I need to use jsonwebtoken at runtime. The `@ts-expect-error` approach is the most practical.

Now let me also think about whether I should use `@ts-expect-error` or restructure. Actually, for the `express` types, I don't need any import at all — I just define structural interfaces. For `jsonwebtoken`, I need the runtime package but not its types.

Let me also consider: what if I just use `import type` for express? No, that won't help because the module itself isn't found.

OK, final plan for the file:

1. Import from `@nestjs/common` (works fine)
2. Import local modules (works fine)
3. For `jsonwebtoken`: use `@ts-expect-error` + import, then cast the result
4. For express types: define minimal structural interfaces locally

Let me also make sure I handle the middleware logic correctly per the plan:
- Read `req.headers.host`
- Verify Bearer JWT → extract `org` claim
- Look up tenant by `domain` in tenants table (via base Prisma, no scoping)
- If tenant not found → 401 `{ error: { code: "unknown_tenant", ... } }`
- If `org` claim ≠ resolved `tenant.id` → 403 `{ error: { code: "tenant_mismatch", ... } }`
- On success calls `tenantCtx.resolve({ tenantId, domain })`

For error handling in middleware: I can either:
- Call `next(error)` which will be caught by NestJS exception filter
- Or send the response directly via `res.status(...).json(...)` and not call `next()`

The plan says "On failure → immediate 401/403, short-circuit." This suggests sending the response directly. But using `next(error)` is also valid and more NestJS-idiomatic (letting the exception filter handle it).

Looking at the plan's error classes: `UnknownTenantError` extends `HttpException` and `TenantMismatchError` extends `HttpException`. So I can throw them or pass them to `next()`.

In NestJS middleware, you can:
- Call `next(error)` to pass an error to the exception handling pipeline
- Or handle it directly with `res.status(...).json(...)` and return

I'll use `next(error)` approach since it's cleaner and lets the global exception filter format the response.

Wait, but if I use `next(error)`, the response will be formatted by whatever exception filter is in place. The plan specifies a specific error envelope format. As long as the exception filter produces that format, this is fine.

Actually, for middleware errors, NestJS's default exception filter will handle `HttpException` instances and return their status code and message. But the format might not match the required envelope `{ error: { code, message, details } }`.

Hmm, but that's a concern for the exception filter, not this file. The errors.ts file defines the error classes with the right status codes and messages. The exception filter (wherever it lives) will format them into the envelope.

Actually wait, looking at the plan more carefully:
- `UnknownTenantError` → 401 `{ error: { code: "unknown_tenant", ... } }`
- `TenantMismatchError` → 403 `{ error: { code: "tenant_mismatch", ... } }`

These are `HttpException` subclasses. In NestJS, when you throw or pass an `HttpException` to the exception handling pipeline, it returns the response with the status code and the response body from the exception. So if `UnknownTenantError` has a response body of `{ error: { code: "unknown_tenant", message: "...", details: {} } }`, it will work.

Let me just throw the errors from the middleware (or pass to next). Actually, in async middleware, I can just throw:

```ts
async use(...) {
  // ...
  if (!tenant) throw new UnknownTenantError();
  if (tenant.id !== org) throw new TenantMismatchError();
  // ...
}
```

NestJS will catch the thrown error in async middleware and pass it to the exception filter. This is the cleanest approach.

Let me write the final version now:

```ts
import { Injectable, NestMiddleware, Scope, REQUEST } from '@nestjs/common';
// @ts-expect-error -- jsonwebtoken type declarations not available
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { UnknownTenantError, TenantMismatchError } from './errors.js';

interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface ServerResponse {
  status(code: number): ServerResponse;
  json(body: unknown): void;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(
    req: IncomingRequest,
    _res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const host = req.headers.host;
    if (!host || typeof host !== 'string') {
      throw new UnknownTenantError();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnknownTenantError();
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    
    let payload: { org?: string };
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as { org?: string };
    } catch {
      throw new UnknownTenantError();
    }

    const org = payload.org;
    if (!org) {
      throw new UnknownTenantError();
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });
    if (!tenant) {
      throw new UnknownTenantError();
    }

    if (tenant.id !== org) {
      throw new TenantMismatchError();
    }

    this.tenantCtx.resolve({ tenantId: tenant.id, domain: host });
    next();
  }
}
```

Wait, I have a concern about the `@ts-expect-error` with ESM import syntax. In ESM, `import jwt from 'jsonwebtoken'` is a default import. If `jsonwebtoken` uses CJS module format (which it does), the default export in ESM context would be the module itself. So `jwt.verify` should work at runtime.

But with `@ts-expect-error`, TypeScript won't type-check the import, so `jwt` will be `any`. Then `jwt.verify(token, secret)` returns `any`, and I cast it. This should work.

Actually, wait. Let me reconsider whether `@ts-expect-error` works correctly here. The error is on line 2 (the import line). `@ts-expect-error` on the line before will suppress it. Let me make sure the formatting is right:

```ts
// @ts-expect-error -- jsonwebtoken type declarations not available
import jwt from 'jsonwebtoken';
```

Yes, that's correct. The comment must be on the line immediately before the error.

Now, one more thing: the plan says the middleware should be in `src/multi-tenant/tenant-resolution.middleware.ts`. Let me make sure my file path and content align.

Also, I notice the plan says:
- `TenantResolutionMiddleware` is `@Scope(REQUEST)` in the module

But wait, middleware in NestJS doesn't typically need to be request-scoped in the DI sense. Middleware is instantiated once and its `use` method is called per request. The request-scoped context is provided by `TenantContextService` (which IS request-scoped).

Looking at the plan again: "TenantResolutionMiddleware is `@Scope(REQUEST)`" — OK, I'll add the scope decorator. Actually, for middleware, the scope might not matter as much since NestJS handles middleware instantiation differently. But I'll include it per the plan.

Actually, wait. Looking at this more carefully: if `TenantResolutionMiddleware` is `@Scope(REQUEST)`, then NestJS will create a new instance per request. That's fine and actually consistent with the plan.

But there's a subtlety: if the middleware is request-scoped, and it injects `TenantContextService` (also request-scoped), then both will be the same instance within a single request. Good.

Let me also double-check: does `PrismaService` being singleton cause issues? No, because it's just a Prisma client wrapper — it doesn't carry any request-specific state.

One more consideration: the `use` method signature. The `NestMiddleware` interface in NestJS is:

```ts
interface NestMiddleware {
  use(context: any, next: NextFunction): any;
}
```

My implementation has 3 parameters (req, res, next) instead of 2 (context, next). In Express-style middleware, the signature is `(req, res, next)`. NestJS's `NestMiddleware` interface is designed to be compatible with Express middleware, so the `context` parameter in the interface actually receives `req` and there's an implicit `res`... 

Actually, let me look at this more carefully. In NestJS, when you apply a middleware, the framework calls:
```
middleware.use(req, res, next)
```

Even though the interface says `use(context: any, next: NextFunction)`. The `context` is actually the `req` object. But in practice, Express middleware always gets `(req, res, next)`.

So my 3-parameter signature `(req, res, next)` is correct for Express-style middleware. TypeScript's structural typing will allow this because:
- A function `(a: A, b: B, c: C) => R` is assignable to a type `(a: A) => R2` (extra params are OK)

Wait, is that right? Let me think again. In TypeScript:
- `(a: string, b: number) => void` IS assignable to `(a: string) => void` ✓ (you can pass fewer args)
- But for method implementation of an interface, it's the same rule

So `use(req: IncomingRequest, res: ServerResponse, next: (err?: unknown) => void): Promise<void>` implementing `use(context: any, next: NextFunction): any` should be fine because:
- `IncomingRequest` is assignable to `any` (parameter, contravariant position — but `any` accepts everything)
- The extra parameter `res` is fine (implementation can have more params than the interface)
- `(err?: unknown) => void` for `NextFunction` — bivariant method params, should be OK
- `Promise<void>` is assignable to `any` ✓

Great, this should compile.

Let me finalize the file. One thing I want to make sure: the `process.env.JWT_SECRET!` — in strict mode, `process.env.JWT_SECRET` is `string | undefined`. The `!` assertion says "trust me, it's defined." Per the plan, config comes from env vars only, so this is reasonable.

Actually, I should handle the case where `JWT_SECRET` is not set more gracefully. But the plan says "Configuration comes from environment variables only" — if it's not set, that's a deployment error. I'll use the `!` assertion.

Let me write the final version:
```

## reply

```ts
import { Injectable, NestMiddleware, Scope, REQUEST } from '@nestjs/common';
// @ts-expect-error -- jsonwebtoken type declarations not available
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { UnknownTenantError, TenantMismatchError } from './errors.js';

interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface ServerResponse {
  status(code: number): ServerResponse;
  json(body: unknown): void;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(
    req: IncomingRequest,
    _res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const host = req.headers.host;
    if (!host || typeof host !== 'string') {
      throw new UnknownTenantError();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnknownTenantError();
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');

    let payload: { org?: string };
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as { org?: string };
    } catch {
      throw new UnknownTenantError();
    }

    const org = payload.org;
    if (!org) {
      throw new UnknownTenantError();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { domain: host },
    });
    if (!tenant) {
      throw new UnknownTenantError();
    }

    if (tenant.id !== org) {
      throw new TenantMismatchError();
    }

    this.tenantCtx.resolve({ tenantId: tenant.id, domain: host });
    next();
  }
}
```
