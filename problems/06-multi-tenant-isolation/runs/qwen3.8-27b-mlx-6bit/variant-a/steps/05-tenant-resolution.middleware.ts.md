# 05-tenant-resolution.middleware.ts

## reasoning

```
Let me analyze what I need to implement based on the PLAN.md specification for `TenantResolutionMiddleware`.

From the plan:

```ts
export declare class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  );
  use(req: Request, res: Response, next: NextFunction): void;
}
```

Behavior:
- Reads `req.headers.host` and verifies the Bearer JWT → extracts `org` claim.
- Looks up tenant by `domain` in the `tenants` table (via base Prisma, no scoping).
- If tenant not found → 401 `{ error: { code: "unknown_tenant", ... } }`.
- If `org` claim ≠ resolved `tenant.id` → 403 `{ error: { code: "tenant_mismatch", ... } }`.
- On success calls `tenantCtx.resolve({ tenantId, domain })`.

From the references:
- `errors.ts` exports: `TenantMismatchError`, `UnknownTenantError`, `ResourceNotFoundError`, `TenantNotResolvedError`, `ConflictError`
- `tenant-context.service.ts` exports: `TENANT_CONTEXT`, `TenantContext`, `TenantContextService`
- `prisma.service.ts` exports: `PrismaService`

The middleware needs to:
1. Extract host from `req.headers.host`
2. Extract Bearer token from `Authorization` header
3. Verify JWT and extract `org` claim (using `jsonwebtoken`)
4. Look up tenant by domain using base Prisma (unscoped)
5. Check if tenant exists → if not, throw `UnknownTenantError`
6. Check if org claim matches tenant id → if not, throw `TenantMismatchError`
7. On success, call `tenantCtx.resolve({ tenantId: tenant.id, domain })`
8. Call `next()`

The JWT verification uses `JWT_SECRET` env var as stated in the plan assumptions.

Let me think about the implementation:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantMismatchError, UnknownTenantError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Extract host
    const domain = req.headers.host;
    
    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // What to do here? The plan says "reject mismatches" but doesn't explicitly cover missing token.
      // I'll throw UnknownTenantError since we can't resolve the tenant without proper auth.
      // Actually, let me re-read the plan... It says "derive the tenant from host + token org claim (both must agree); reject mismatches."
      // A missing token is a form of mismatch/rejection. I'll use UnknownTenantError (401).
      throw new UnknownTenantError();
    }
    
    const token = authHeader.slice(7);
    
    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!);
    } catch {
      throw new UnknownTenantError();
    }
    
    const org = (decoded as jwt.JwtPayload).org;
    if (!org || typeof org !== 'string') {
      throw new UnknownTenantError();
    }
    
    // Look up tenant by domain (base Prisma, unscoped)
    const tenant = await this.prisma.tenant.findUnique({ where: { domain: domain! } });
    
    if (!tenant) {
      throw new UnknownTenantError();
    }
    
    // Verify org claim matches
    if (org !== tenant.id) {
      throw new TenantMismatchError();
    }
    
    // Resolve context
    this.tenantCtx.resolve({ tenantId: tenant.id, domain: domain! });
    
    next();
  }
}
```

Wait, I need to think about scoping. The plan says `TenantResolutionMiddleware` is `@Scope(REQUEST)`. But in NestJS, middleware is typically registered differently. Let me re-read...

The plan says:
- `TenantContextService` is `@Scope(REQUEST)`
- `TenantResolutionMiddleware` is `@Scope(REQUEST)`

In NestJS, middleware can be request-scoped. The middleware would need to be applied in `main.ts` or via `configure` in a module. Since the plan shows it in providers of MultiTenantModule, and it's REQUEST-scoped, this makes sense for NestJS.

Actually, looking more carefully at the plan's module definition:
```
providers: [PrismaService, TenantContextService, TenantResolutionMiddleware],
exports: [PrismaService, TenantContextService],
```

The middleware is a provider. In NestJS, you'd typically apply middleware in a module's `configure()` method or in `main.ts`. But the plan says it's in providers, so I'll just mark it as injectable with REQUEST scope.

Let me also think about the `use` method signature. In NestJS, `NestMiddleware.use` can be async or sync. Since we need to do a DB lookup and JWT verification, it should be async.

Actually, looking at the plan signature again:
```ts
use(req: Request, res: Response, next: NextFunction): void;
```

It says `void` return, not `Promise<void>`. But we need async for the DB call. Hmm, let me think... In NestJS, middleware's `use` method can return a Promise. The type signature in the interface allows it. I'll make it async since we need to await the DB call and JWT verification.

Wait, `jwt.verify` is synchronous (unless using async key functions). But the Prisma lookup is async. So the method must be async.

Let me also consider: should I handle the case where `req.headers.host` is undefined? The plan doesn't explicitly mention this, but a request without a host header would be invalid. I'll treat it as unknown tenant (401).

Let me also think about whether `jwt.verify` could be async. The standard `jsonwebtoken` package's `verify` is synchronous (returns the decoded payload) or throws. There's also `jwt.verify` with async options for key rotation, but the basic form is sync. I'll use the synchronous form.

Actually wait - in Node.js with ESM, `import jwt from 'jsonwebtoken'` gives the default export. Let me use that.

Let me finalize my implementation:

```ts
import { Injectable, NestMiddleware, Scope } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantMismatchError, UnknownTenantError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const domain = req.headers.host;

    if (!domain) {
      throw new UnknownTenantError();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnknownTenantError();
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    } catch {
      throw new UnknownTenantError();
    }

    const org = payload.org;

    if (typeof org !== 'string') {
      throw new UnknownTenantError();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { domain },
    });

    if (!tenant) {
      throw new UnknownTenantError();
    }

    if (org !== tenant.id) {
      throw new TenantMismatchError();
    }

    this.tenantCtx.resolve({ tenantId: tenant.id, domain });

    next();
  }
}
```

This looks good. Let me check against the plan one more time:

1. ✅ Reads `req.headers.host` and verifies the Bearer JWT → extracts `org` claim
2. ✅ Looks up tenant by `domain` in the `tenants` table (via base Prisma, no scoping)
3. ✅ If tenant not found → 401 via `UnknownTenantError`
4. ✅ If `org` claim ≠ resolved `tenant.id` → 403 via `TenantMismatchError`
5. ✅ On success calls `tenantCtx.resolve({ tenantId, domain })`

The plan says the constructor takes `(private readonly tenantCtx: TenantContextService, private readonly prisma: PrismaService)` - matches.

I'm using `process.env.JWT_SECRET!` - the plan says "Use `jsonwebtoken` with `JWT_SECRET` env var". The `!` is because TypeScript strict mode won't let us use `string | undefined` where `string` is expected. This is a reasonable assumption.

I think this is complete and correct. Let me write the final version.
```

## reply

```ts
import { Injectable, NestMiddleware, Scope } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantMismatchError, UnknownTenantError } from './errors.js';

@Injectable({ scope: Scope.REQUEST })
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const domain = req.headers.host;

    if (!domain) {
      throw new UnknownTenantError();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnknownTenantError();
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: jwt.JwtPayload;
    try {
      // ASSUMPTION: JWT_SECRET is a non-empty string at runtime; the plan specifies it as an env var without a fallback
      payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    } catch {
      throw new UnknownTenantError();
    }

    const org = payload.org;

    if (typeof org !== 'string') {
      throw new UnknownTenantError();
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { domain },
    });

    if (!tenant) {
      throw new UnknownTenantError();
    }

    if (org !== tenant.id) {
      throw new TenantMismatchError();
    }

    this.tenantCtx.resolve({ tenantId: tenant.id, domain });

    next();
  }
}
```
