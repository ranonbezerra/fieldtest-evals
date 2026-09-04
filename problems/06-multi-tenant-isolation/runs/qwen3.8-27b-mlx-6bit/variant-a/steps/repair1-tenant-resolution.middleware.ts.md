# repair1-tenant-resolution.middleware.ts

## reasoning

```
Let me analyze the compiler errors for `src/tenant/tenant-resolution.middleware.ts`:

1. Line 2, col 54: `Cannot find module 'express' or its corresponding type declarations` - This is a missing type package issue, but the import itself is correct. The fix is to use `@types/express` or just keep the import as-is since it's a dependency issue. Wait, but the task says to fix what the messages require of *this file*. The module 'express' not being found is a dependency issue, not something I can fix in this file. Let me re-read the instructions.

Actually, looking more carefully at the errors for THIS file specifically:

```
src/tenant/tenant-resolution.middleware.ts(2,54): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/tenant/tenant-resolution.middleware.ts(3,28): error TS2307: Cannot find module '@nestjs/jwt' or its corresponding type declarations.
src/tenant/tenant-resolution.middleware.ts(4,34): error TS2307: Cannot find module './tenant.repository' or its corresponding type declarations.
src/tenant/tenant-resolution.middleware.ts(5,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?
src/tenant/tenant-resolution.middleware.ts(6,36): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?
src/tenant/tenant-resolution.middleware.ts(7,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?
```

So the issues are:
1. Line 2: `Cannot find module 'express'` - This is a missing `@types/express` package. I can't fix this in the file itself unless I change how I import express types. But wait - the task says "fixing what these messages require of this file." The module 'express' not being found is a dependency issue. However, I could potentially use a different approach to get the types.

Actually, looking at this more carefully - the project uses ESM with `node16`/`nodenext` module resolution. The TS2307 errors for 'express' and '@nestjs/jwt' are about missing type declarations, which means the packages aren't installed or their types aren't available. But the task says to fix what the messages require of *this file*. 

Wait - let me reconsider. The TS2835 errors are clearly about missing `.js` extensions on relative imports. Those I can fix directly in this file.

For TS2307 on 'express' and '@nestjs/jwt' - these are external module resolution errors. The file can't really fix these by changing its own content unless the packages genuinely aren't installed. But since other files also reference '@nestjs/jwt' (like tenant.module.ts would need it via JwtModule), and the plan explicitly uses @nestjs/jwt, these must be expected dependencies.

Hmm, but looking at the other errors in the workspace:
- `test/tenant-config.spec.ts(4,28): error TS2307: Cannot find module '@nestjs/jwt'`
- `test/customer-isolation.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing'`
- `test/customer-isolation.spec.ts(3,26): error TS2307: Cannot find module 'supertest'`
- `test/customer-isolation.spec.ts(6,22): error TS2307: Cannot find module 'jsonwebtoken'`

These are all missing packages. The task says "fixing what these messages require of this file" - meaning I should only fix issues that can be fixed within this file. The TS2307 for external packages (express, @nestjs/jwt) are dependency issues that can't be fixed by changing the file content.

Wait, but what about `./tenant.repository` on line 4? That's a relative import that can't be found. Looking at the manifest, `src/tenant/tenant.repository.ts` is listed as a file that should exist. So either it doesn't exist yet, or it has the same extension issue. But the error is TS2307 (cannot find module), not TS2835 (needs extension). 

Actually wait - with `node16`/`nodenext` module resolution, if you import `./tenant.repository` without an extension, it would give TS2835 (needs explicit file extension), not TS2307. The fact that line 4 gives TS2307 means the file `./tenant.repository.ts` (or `./tenant.repository.js`) doesn't exist. But the plan says it should exist...

Hmm, but the task says "Change nothing the messages do not name." and "fixing what these messages require of this file." So I need to:
1. Fix TS2835 errors by adding `.js` extensions to relative imports
2. For TS2307 on `./tenant.repository` - the file might not exist yet, but I can't create it. I should add the `.js` extension to make it at least resolve correctly when the file does exist. Wait, but TS2307 says "Cannot find module" which is different from TS2835 "needs explicit file extensions". 

Let me re-read: Line 4 is `./tenant.repository` and gets TS2307. Lines 5, 6, 7 are `./tenant-context` and `../errors/app-exception` and get TS2835.

The difference: TS2835 fires when the compiler knows the file exists but you're missing the extension. TS2307 fires when the compiler can't find the file at all (even trying with extensions).

So `./tenant.repository` genuinely doesn't exist as a file. But `./tenant-context` and `../errors/app-exception` do exist (just need the `.js` extension).

For `./tenant.repository`, I should still write the import with `.js` extension since that's what the module resolution requires. The file just hasn't been created yet (or will be created by another step). The import statement in this file is correct per the plan.

Actually wait - let me reconsider. If `./tenant-context.ts` exists (giving TS2835 instead of TS2307), then adding `.js` will fix it. If `./tenant.repository.ts` doesn't exist (giving TS2307), then adding `.js` won't help - it'll still be TS2307. But I should still add the `.js` extension because that's what the module resolution system requires, and when the file is created, it will resolve.

Actually, I think the right approach is:
- For all relative imports, add `.js` extension (fixes TS2835, and is correct for node16/nodenext)
- For external packages (express, @nestjs/jwt), I can't fix the missing types from within this file

But wait - for `express`, maybe I can use a different import strategy. In NestJS, you typically get `Request` and `Response` types from express. If `@types/express` isn't available, I could potentially use `import type { Request, Response, NextFunction } from 'express'` which would still fail...

Or I could use `import('express').Request` or similar. But that would still fail if the types aren't installed.

I think the right approach is:
1. Add `.js` extensions to all relative imports
2. Keep the express and @nestjs/jwt imports as they are (they're correct, the issue is missing dependencies)
3. Add `// ASSUMPTION:` comments for things I can't reconcile

Actually, re-reading the instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The TS2307 for 'express' and '@nestjs/jwt' are about missing type declarations, not about shapes I can't see. The imports are correct per the plan. I'll add an ASSUMPTION noting that these packages need to be installed.

Let me now write the file based on the PLAN:

From the plan:
- `hostToTenantSlug(host: string, baseDomain: string): string | undefined` - exported function
- `TenantResolutionMiddleware implements NestMiddleware` with constructor taking `TenantRepository` and `JwtService`
- `use(req: Request, res: Response, next: NextFunction): Promise<void>`

Ordering:
1. Host→slug parse → if no slug, `unknown_tenant` (403)
2. Load tenant by slug → if not found, `unknown_tenant` (403)
3. Verify JWT → if invalid/missing, `unauthorized` (401)
4. Compare `org` to slug → if mismatch, `tenant_mismatch` (403)
5. Set ALS via `tenantStorage.run(ctx, () => next())`

Wait, let me re-read the ordering: "Host→slug parse → load tenant by slug (`unknown_tenant` if absent) → verify JWT (`unauthorized`) → compare `org` to slug (`tenant_mismatch`) → set ALS"

So:
1. Parse host to get slug. If no slug → `unknown_tenant`
2. Look up tenant by slug. If not found → `unknown_tenant`
3. Extract and verify JWT. If no token or invalid → `unauthorized`
4. Compare token's `org` claim to slug. If different → `tenant_mismatch`
5. Run `tenantStorage.run(ctx, () => next())`

Now let me write the code:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository.js';
import { tenantStorage, type TenantContext } from './tenant-context.js';
import { AppException } from '../errors/app-exception.js';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  if (!host) return undefined;
  const base = `.${baseDomain}`;
  if (host.endsWith(base)) {
    const slug = host.slice(0, -base.length);
    return slug || undefined;
  }
  return undefined;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly jwt: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const baseDomain = process.env.TENANT_BASE_DOMAIN;
      if (!baseDomain) {
        throw AppException.tenantContextMissing();
      }

      const host = req.hostname;
      const slug = hostToTenantSlug(host, baseDomain);
      if (!slug) {
        throw AppException.unknownTenant(host);
      }

      const tenant = await this.tenants.findBySlug(slug);
      if (!tenant) {
        throw AppException.unknownTenant(host);
      }

      // Extract and verify JWT
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw AppException.unauthorized();
      }
      const token = authHeader.slice(7);
      let payload: { org?: string };
      try {
        payload = this.jwt.verify(token) as { org?: string };
      } catch {
        throw AppException.unauthorized();
      }

      if (payload.org !== slug) {
        throw AppException.tenantMismatch(slug, payload.org ?? '');
      }

      const ctx: TenantContext = {
        tenantId: tenant.id,
        slug: tenant.slug,
        domain: tenant.domain,
      };

      await tenantStorage.run(ctx, () => next());
    } catch (err) {
      next(err);
    }
  }
}
```

Wait, I need to think about how errors propagate. In NestJS middleware, if you call `next(err)`, the error goes to the global exception filter. But actually, in NestJS, middleware errors are handled differently. If I throw an error in middleware, NestJS will catch it and pass it to the exception filter.

Actually, looking at this more carefully - in NestJS, if a middleware throws an error, it's caught by the framework and passed to the exception filters. So I can just throw the AppException directly without wrapping in try/catch and calling next(err). But wait, if I throw inside `tenantStorage.run`, it should still propagate up.

Let me reconsider. The standard pattern in NestJS middleware for error handling:
- If you throw, NestJS catches it and routes to exception filters
- If you call `next(err)`, Express's error handling kicks in (which NestJS also handles)

Either approach works. Throwing is cleaner and more NestJS-idiomatic. Let me just throw:

```typescript
async use(req: Request, res: Response, next: NextFunction): Promise<void> {
  const baseDomain = process.env.TENANT_BASE_DOMAIN;
  if (!baseDomain) {
    throw AppException.tenantContextMissing();
  }

  const host = req.hostname;
  const slug = hostToTenantSlug(host, baseDomain);
  if (!slug) {
    throw AppException.unknownTenant(host);
  }

  const tenant = await this.tenants.findBySlug(slug);
  if (!tenant) {
    throw AppException.unknownTenant(host);
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw AppException.unauthorized();
  }
  const token = authHeader.slice(7);
  let payload: { org?: string };
  try {
    payload = this.jwt.verify(token) as { org?: string };
  } catch {
    throw AppException.unauthorized();
  }

  if (payload.org !== slug) {
    throw AppException.tenantMismatch(slug, payload.org ?? '');
  }

  const ctx: TenantContext = {
    tenantId: tenant.id,
    slug: tenant.slug,
    domain: tenant.domain,
  };

  await tenantStorage.run(ctx, () => Promise.resolve(next()));
}
```

Hmm, but `next()` returns void in Express. So `tenantStorage.run(ctx, () => next())` should be fine since `next()` returns void and the callback can return void.

Actually, `AsyncLocalStorage.run` returns the return value of the callback. If the callback returns void, it returns undefined. And since `use` is async and returns Promise<void>, this is fine.

Wait, but there's a subtlety. If `next()` triggers an async handler that throws, will the error propagate through `tenantStorage.run`? In Express, `next()` is synchronous - it starts the next handler but doesn't await it. So errors in downstream handlers won't propagate back through the middleware.

This is actually correct behavior - the middleware's job is to set up the context and call next. Errors in the controller/service will be caught by NestJS's exception handling mechanism (which runs within the same async context because NestJS uses the same promise chain).

Actually wait - does NestJS preserve the AsyncLocalStorage context? Yes, because NestJS handlers are async and the ALS context is maintained across `await` points within the same execution context. Since we wrap `next()` in `tenantStorage.run`, and NestJS will call the controller within that same async execution flow, the ALS context will be available.

But there's a potential issue: `next()` in Express is fire-and-forget in the sense that it doesn't return a promise. However, NestJS middleware integration means that `next()` will trigger the NestJS pipeline which is async. The key question is whether the ALS context is preserved.

In Node.js, `AsyncLocalStorage` contexts are preserved across `await` boundaries within the same execution context. Since NestJS will call the route handler as part of the same promise chain (which is initiated within `tenantStorage.run`), the context should be preserved.

Actually, I need to be more careful. The `run` method creates a new async context for the callback. Any async operations initiated within that callback (including those triggered by `next()`) will inherit that context. So yes, this should work.

Let me also consider: should I use `next()` or `next(Err)` for error handling? Since I'm throwing AppException, NestJS will catch it. But in middleware, the standard pattern is:

Option 1: Throw (NestJS catches it)
Option 2: Call `next(error)` (Express error handling)

Both work with NestJS. I'll go with throwing since it's cleaner and the global exception filter will handle it.

Now, about the `// ASSUMPTION:` lines. The TS2307 errors for 'express' and '@nestjs/jwt' are because those packages' types aren't available. I can't fix this from within the file - it's a dependency issue. I should note this.

Actually, wait. Let me re-read the instructions: "fixing what these messages require of this file." The TS2307 for 'express' requires that the module be resolvable, which is a dependency issue. The TS2835 for relative imports requires adding `.js` extensions, which I can fix.

For the `./tenant.repository` TS2307 - this file doesn't exist yet. I should still write the import with `.js` extension (correct for node16/nodenext), and note that the file is expected to exist per the plan.

Let me finalize my answer. I'll add ASSUMPTION comments for:
1. 'express' and '@nestjs/jwt' type declarations not found (missing dependencies)
2. './tenant.repository' not found (file expected per plan but not yet created)

Actually, the instructions say "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." This is about shapes, not missing files. The TS2307 for external packages isn't really a "shape I cannot see" - it's a missing dependency. I'll add brief ASSUMPTION notes.

Let me write the final version:
```

## reply

```typescript
// ASSUMPTION: 'express' and '@nestjs/jwt' type declarations are unavailable in the
// current workspace (TS2307). The imports below are correct per the plan and will
// resolve once those packages (and @types/express) are installed.
import type { Request, Response, NextFunction } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
// ASSUMPTION: './tenant.repository.js' is not yet present on disk (TS2307); it is
// specified by the plan and will resolve once created.
import { TenantRepository } from './tenant.repository.js';
import { tenantStorage, type TenantContext } from './tenant-context.js';
import { AppException } from '../errors/app-exception.js';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  if (!host) return undefined;
  const suffix = `.${baseDomain}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    return slug.length > 0 ? slug : undefined;
  }
  return undefined;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly jwt: JwtService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const baseDomain = process.env.TENANT_BASE_DOMAIN;
    if (!baseDomain) {
      throw AppException.tenantContextMissing();
    }

    const host = req.hostname;
    const slug = hostToTenantSlug(host, baseDomain);
    if (!slug) {
      throw AppException.unknownTenant(host);
    }

    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) {
      throw AppException.unknownTenant(host);
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppException.unauthorized();
    }

    const token = authHeader.slice('Bearer '.length);
    let payload: { org?: string };
    try {
      payload = this.jwt.verify(token) as { org?: string };
    } catch {
      throw AppException.unauthorized();
    }

    if (payload.org !== slug) {
      throw AppException.tenantMismatch(slug, payload.org ?? '');
    }

    const ctx: TenantContext = {
      tenantId: tenant.id,
      slug: tenant.slug,
      domain: tenant.domain,
    };

    await tenantStorage.run(ctx, () => next());
  }
}
```
