# 14-tenant-resolution.middleware.ts

## reasoning

```
Let me analyze the plan to understand what `tenant-resolution.middleware.ts` needs to contain.

From the plan:

```
`src/tenant/tenant-resolution.middleware.ts`
export function hostToTenantSlug(host: string, baseDomain: string): string | undefined;

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(tenants: TenantRepository, jwt: JwtService);
  use(req: Request, res: Response, next: NextFunction): Promise<void>;
}
```

Key behaviors:
- No bearer token or invalid signature → `unauthorized` (401)
- Host has no tenant slug → `unknown_tenant` (403)
- Token `org` ≠ resolved slug → `tenant_mismatch` (403)
- On success, runs the downstream chain inside `tenantStorage.run(ctx, …)`

Ordering rules:
- Host→slug parse → load tenant by slug (`unknown_tenant` if absent) → verify JWT (`unauthorized`) → compare `org` to slug (`tenant_mismatch`) → set ALS

Wait, let me re-read the ordering: "Host→slug parse → load tenant by slug (`unknown_tenant` if absent) → verify JWT (`unauthorized`) → compare `org` to slug (`tenant_mismatch`) → set ALS"

So the order is:
1. Parse host to get slug (using `hostToTenantSlug` with `TENANT_BASE_DOMAIN` from env)
2. If no slug → throw `unknown_tenant`
3. Look up tenant by slug in DB → if not found, throw `unknown_tenant`
4. Verify JWT (extract bearer token, verify) → if invalid, throw `unauthorized`
5. Compare token's `org` claim to the slug → if mismatch, throw `tenant_mismatch`
6. Set ALS context and call `next()` inside `tenantStorage.run(ctx, ...)`

The `hostToTenantSlug` function:
- Takes host and baseDomain
- Returns the slug or undefined
- Logic: if host ends with `.<baseDomain>`, extract the subdomain part as slug. If host equals `<something>.<baseDomain>`, the something is the slug.

Wait, let me re-read: "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

Actually those are the same thing. If host is `app.operator-x.com` and base is `operator-x.com`, then slug is `app`.

Wait, but the plan says "The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"

Hmm, that's confusing. Let me re-read: "e.g. `app.operator-x.com` → `operator-x`"

Wait, that doesn't make sense. If the host is `app.operator-x.com`, the subdomain label would be `app`, not `operator-x`. Unless the base domain is something else.

Let me re-read: "Base domain from env. `TENANT_BASE_DOMAIN` (e.g. `operator-x.com`) configures host→slug parsing; host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`."

So if base domain is `operator-x.com` and host is `app.operator-x.com`, then slug would be `app`.

But the first assumption says: "The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`)"

This is contradictory. If the base domain is just `com`, then `app.operator-x.com` → slug would be `operator-x`. But the plan says base domain is `operator-x.com`.

Wait, I think I'm misreading. Let me look again at the example: "e.g. `app.operator-x.com` → `operator-x`"

I think this is a typo or shorthand in the plan. The actual logic based on the base domain env var would be:
- If `TENANT_BASE_DOMAIN` = `com`, then `app.operator-x.com` → slug = `operator-x` (strip `.com`)
- If `TENANT_BASE_DOMAIN` = `operator-x.com`, then `app.operator-x.com` → slug = `app` (strip `.operator-x.com`)

Given the plan says "host is considered tenant-owned only if it ends in `.<base>`", the slug is what's before that. So:
- `hostToTenantSlug('app.operator-x.com', 'operator-x.com')` → `'app'`
- `hostToTenantSlug('operator-x.com', 'operator-x.com')` → `undefined` (no subdomain)

Actually wait, re-reading: "host is considered tenant-owned only if it ends in `.<base>` or equals `<slug>.<base>`"

These two conditions are the same. A host ends in `.<base>` means it's `<something>.<base>`. So the slug is the `<something>` part.

I'll go with: `hostToTenantSlug` extracts the subdomain by stripping the base domain suffix. If the host doesn't end with `.<baseDomain>`, return undefined.

Now for the middleware:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository';
import { tenantStorage, TenantContext } from './tenant-context';
import { AppException } from '../errors/app-exception';
```

The `hostToTenantSlug` function:
```typescript
export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  const suffix = `.${baseDomain}`;
  if (host.endsWith(suffix)) {
    return host.slice(0, -suffix.length);
  }
  return undefined;
}
```

The middleware `use` method:
1. Get host from request (strip port)
2. Get `TENANT_BASE_DOMAIN` from env
3. Parse slug from host using `hostToTenantSlug`
4. If no slug → throw `AppException.unknownTenant(host)`
5. Look up tenant by slug via `this.tenants.findBySlug(slug)`
6. If not found → throw `AppException.unknownTenant(host)`
7. Extract bearer token from `req.headers.authorization`
8. If no token → throw `AppException.unauthorized()`
9. Verify JWT → if fails, throw `AppException.unauthorized()`
10. Check `payload.org` === slug → if not, throw `AppException.tenantMismatch(slug, payload.org)`
11. Create TenantContext and run next inside `tenantStorage.run`

For the JWT verification, I need to use `jwt.verify()`. The token format is Bearer <token>.

Let me think about error handling. The plan says "Raises (via `AppException`, so the filter formats them)". So I should throw the AppException and let the global filter catch it.

Wait, but middleware throwing... In NestJS, if a middleware throws, does the global exception filter catch it? Actually, in Express/NestJS, exceptions thrown in middleware are caught by the error handling. NestJS's `useGlobalFilters` should handle exceptions from middleware as well since they propagate through the Express error handling chain.

Actually, let me think more carefully. In NestJS, `ExceptionFilter` catches exceptions from controllers and guards. For middleware, it depends on how NestJS handles it. Looking at NestJS source, exceptions thrown in middleware are caught by the exception filter if they propagate up through the Express error handler.

Actually, in NestJS, when you use `app.useGlobalFilters()`, the filter is registered as an Express error handler. So any exception thrown in middleware that isn't caught will bubble up to the Express error handler, which is the global filter. So throwing `AppException` in middleware should work.

Let me also consider: the plan says the constructor takes `tenants: TenantRepository` and `jwt: JwtService`. The `JwtService` comes from `@nestjs/jwt`.

For the env variable, I'll read `process.env.TENANT_BASE_DOMAIN` directly in the `use` method (or at construction time? The plan says "Base domain from env" so it's from environment). I'll read it in the `use` method to allow for test overrides, but actually reading at construction is more standard. Let me read it in the `use` method since the plan doesn't specify a constructor parameter for it.

Actually, looking at the plan's signature: `constructor(tenants: TenantRepository, jwt: JwtService)` — no base domain parameter. So it must come from `process.env.TENANT_BASE_DOMAIN`.

Let me also think about the host extraction. In Express, `req.headers.host` gives the Host header which may include a port (e.g., `localhost:3000`). I should strip the port.

Let me write the complete file now:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository';
import { tenantStorage } from './tenant-context';
import type { TenantContext } from './tenant-context';
import { AppException } from '../errors/app-exception';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  const suffix = `.${baseDomain}`;
  if (host.endsWith(suffix)) {
    return host.slice(0, -suffix.length);
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
    const rawHost = req.headers.host ?? '';
    const host = rawHost.split(':')[0]!;

    const baseDomain = process.env.TENANT_BASE_DOMAIN ?? '';
    const slug = hostToTenantSlug(host, baseDomain);

    if (!slug) {
      throw AppException.unknownTenant(host);
    }

    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) {
      throw AppException.unknownTenant(host);
    }

    const authHeader = req.headers.authorization;
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

    if (!payload.org || payload.org !== slug) {
      throw AppException.tenantMismatch(slug, payload.org ?? '');
    }

    const ctx: TenantContext = {
      tenantId: tenant.id,
      slug: tenant.slug,
      domain: tenant.domain,
    };

    await new Promise<void>((resolve, reject) => {
      tenantStorage.run(ctx, () => {
        next();
        // Hmm, this is tricky. next() doesn't return a promise in Express.
      });
    });
  }
}
```

Wait, I need to think about how to handle `next()` inside `tenantStorage.run`. The Express `next` callback is not async. But I need the ALS context to be active when the downstream handlers execute.

Actually, `AsyncLocalStorage.run` works with Express's callback model. The key insight is that `tenantStorage.run(ctx, fn)` sets the store for the duration of `fn` AND all async operations spawned within it (via async hooks). So even though `next()` is a callback, as long as we call it inside the `run` callback, all subsequent async operations (including the controller handlers) will have access to the store.

But the issue is: `next()` in Express triggers the next middleware/route handler. In NestJS, this eventually calls the controller. The `next()` call itself is synchronous in Express, but the actual handler execution may be async.

The correct pattern is:
```typescript
tenantStorage.run(ctx, () => {
  next();
});
```

But `next()` doesn't return a promise. The `use` method signature returns `Promise<void>`. In NestJS, the middleware's `use` can be async, but the `next()` callback is what signals completion.

Actually, looking at how NestJS middleware works: the `use` method can be async, and NestJS will await it. But the `next()` call is what passes control to the next middleware/handler. If I do:

```typescript
async use(req, res, next) {
  // ... resolution logic ...
  await tenantStorage.run(ctx, async () => {
    next();
  });
}
```

Hmm, but `tenantStorage.run` with an async callback... Let me check. `AsyncLocalStorage.run(store, callback)` - if the callback returns a Promise, `run` returns that Promise. So:

```typescript
await tenantStorage.run(ctx, async () => {
  next();
});
```

This would work. The `next()` is called inside the ALS context, and since `next()` triggers the downstream handlers (which are async), the ALS context propagates through them via async hooks.

Wait, but there's a subtlety. In Express, `next()` is fire-and-forget in the sense that it starts the next handler but doesn't wait for it. The actual response is sent by the controller. So calling `next()` inside `tenantStorage.run` should be sufficient because the async context is captured at the point of the `next()` call and propagates.

Actually, I think the simplest and correct approach is:

```typescript
tenantStorage.run(ctx, () => {
  next();
});
```

And make the `use` method synchronous (or just not await anything after). But the plan says `use(req, res, next): Promise<void>`. Let me make it async and just call next inside the run.

Actually, looking at this more carefully: in Express middleware, you call `next()` to pass control forward. The middleware function itself can be async (Express 5) or sync (Express 4). In NestJS, middleware `use` can return a Promise.

The safest pattern that works with both:

```typescript
async use(req: Request, res: Response, next: NextFunction): Promise<void> {
  // ... all the resolution and validation ...
  
  const ctx: TenantContext = { ... };
  
  await tenantStorage.run(ctx, async () => {
    next();
  });
}
```

Wait, but `next()` in Express doesn't return a Promise. So `async () => { next(); }` would resolve immediately after calling `next()`, which means the `await tenantStorage.run(...)` resolves before the actual handler completes. But that's fine because the ALS context has already been established for the async chain started by `next()`.

Actually, I realize there might be an issue. If `tenantStorage.run` resolves before the handler completes, does the ALS context get "cleaned up"? No - `AsyncLocalStorage.run` doesn't clean up. The store remains available for the entire async context that was created when `run` was called. The "cleanup" (returning to the outer context) happens for code that runs AFTER the `run` callback completes in the same synchronous execution context. But async operations spawned within (like those triggered by `next()`) retain the store.

So this pattern is correct:
```typescript
tenantStorage.run(ctx, () => {
  next();
});
```

The `next()` call creates a new async execution context that inherits the store. Even after `run`'s callback returns, the async operations started by `next()` still have the store.

But wait - if I make `use` async and it resolves (because `next()` is synchronous from the middleware's perspective), then NestJS might consider the middleware "done" and proceed. But in Express, calling `next()` IS the mechanism of proceeding. So this should be fine.

Let me just use:
```typescript
await tenantStorage.run(ctx, () => {
  next();
});
```

This is clean and the `await` is harmless (it just awaits a Promise that resolves synchronously).

Hmm, actually one more thought. Let me look at what happens if I throw an AppException in the middleware. In Express, if a middleware throws (synchronously), Express catches it and calls `next(err)`. If a middleware is async and the Promise rejects, Express 4 does NOT catch it (you need `express-async-errors` or manual try/catch), but Express 5 does. NestJS typically uses Express 4.

So to be safe, I should wrap the async logic in a try/catch and call `next(error)`:

```typescript
async use(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // ... logic that may throw ...
    tenantStorage.run(ctx, () => {
      next();
    });
  } catch (err) {
    next(err);
  }
}
```

This way, if any AppException is thrown, it's passed to `next(err)` which Express will route to the error handler (which NestJS sets up to use the global exception filter).

Yes, this is the correct pattern. Let me finalize:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository';
import { tenantStorage } from './tenant-context';
import type { TenantContext } from './tenant-context';
import { AppException } from '../errors/app-exception';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  const suffix = `.${baseDomain}`;
  if (host.endsWith(suffix)) {
    return host.slice(0, -suffix.length);
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
      const rawHost = req.headers.host ?? '';
      const host = rawHost.split(':')[0]!;

      const baseDomain = process.env.TENANT_BASE_DOMAIN ?? '';
      const slug = hostToTenantSlug(host, baseDomain);

      if (!slug) {
        throw AppException.unknownTenant(host);
      }

      const tenant = await this.tenants.findBySlug(slug);
      if (!tenant) {
        throw AppException.unknownTenant(host);
      }

      const authHeader = req.headers.authorization;
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

      if (!payload.org || payload.org !== slug) {
        throw AppException.tenantMismatch(slug, payload.org ?? '');
      }

      const ctx: TenantContext = {
        tenantId: tenant.id,
        slug: tenant.slug,
        domain: tenant.domain,
      };

      tenantStorage.run(ctx, () => {
        next();
      });
    } catch (err) {
      next(err);
    }
  }
}
```

Wait, I need to double-check: does the plan say anything about `res` being used? No, it's just part of the NestMiddleware signature. I'll keep it.

Also, I should check: the plan says "No bearer token or invalid signature → unauthorized (401)". My code handles both: no `Authorization` header or doesn't start with "Bearer " → unauthorized. Invalid JWT (verification fails) → unauthorized. Good.

The plan's ordering: "Host→slug parse → load tenant by slug (unknown_tenant if absent) → verify JWT (unauthorized) → compare org to slug (tenant_mismatch) → set ALS"

My code follows this order:
1. Parse host to slug ✓
2. If no slug → unknown_tenant ✓
3. Load tenant by slug; if absent → unknown_tenant ✓
4. Verify JWT; if invalid → unauthorized ✓
5. Compare org to slug; if mismatch → tenant_mismatch ✓
6. Set ALS and call next ✓

This looks correct. Let me also make sure I'm not adding anything the plan doesn't specify. The plan says:
- `hostToTenantSlug` function ✓
- `TenantResolutionMiddleware` class with constructor and use method ✓
- No extra exports or features

I think this is complete. Let me write the final version.
```

## reply

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { TenantRepository } from './tenant.repository';
import { tenantStorage } from './tenant-context';
import type { TenantContext } from './tenant-context';
import { AppException } from '../errors/app-exception';

export function hostToTenantSlug(host: string, baseDomain: string): string | undefined {
  const suffix = `.${baseDomain}`;
  if (host.endsWith(suffix)) {
    return host.slice(0, -suffix.length);
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
      const rawHost = req.headers.host ?? '';
      const host = rawHost.split(':')[0]!;

      const baseDomain = process.env.TENANT_BASE_DOMAIN ?? '';
      const slug = hostToTenantSlug(host, baseDomain);

      if (!slug) {
        throw AppException.unknownTenant(host);
      }

      const tenant = await this.tenants.findBySlug(slug);
      if (!tenant) {
        throw AppException.unknownTenant(host);
      }

      const authHeader = req.headers.authorization;
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

      if (!payload.org || payload.org !== slug) {
        throw AppException.tenantMismatch(slug, payload.org ?? '');
      }

      const ctx: TenantContext = {
        tenantId: tenant.id,
        slug: tenant.slug,
        domain: tenant.domain,
      };

      tenantStorage.run(ctx, () => {
        next();
      });
    } catch (err) {
      next(err);
    }
  }
}
```
