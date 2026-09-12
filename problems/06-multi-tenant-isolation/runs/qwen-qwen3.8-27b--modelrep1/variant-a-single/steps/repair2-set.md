# repair2-set

## reasoning

```
Let me analyze the errors:

1. `src/tenant/tenant-resolution.middleware.ts(77,7): error TS2554: Expected 2 arguments, but got 1.`
2. `src/tenant/tenant-resolution.middleware.ts(78,17): error TS2554: Expected 0-1 arguments, but got 2.`

Looking at the middleware file:

Line 77: `runWithTenant(tenant);` — this is called with 1 argument, but the function expects 2 arguments.
Line 78: `next(req, res);` — wait, no. Let me recount.

Let me count lines in the middleware file:

```
1: import { Injectable, NestMiddleware } from '@nestjs/common';
2: import { JwtService } from '@nestjs/jwt';
3: import type { NextFunction, Request, Response } from 'express';
4: import { AppError } from '../common/app-error.js';
5: import { sendError } from '../common/all-exceptions.filter.js';
6: import { runWithTenant } from '../common/tenant-context.js';
7: import { TenantsRepository } from './tenant.repository.js';
8:
9: interface OrgTokenPayload {
10:   org?: unknown;
11: }
12:
13: function extractBearerToken(header: string | string[] | undefined): string | undefined {
14:   if (typeof header !== 'string') {
15:     return undefined;
16:   }
17:   const match = /^Bearer\s+(.+)$/i.exec(header);
18:   return match ? match[1].trim() : undefined;
19: }
20:
21: // ASSUMPTION: an operator's public domain is "app.<tenant-slug>.<zone>"
22: // (e.g. app.operator-x.com); the tenant slug is the second label of the Host header.
23: function slugFromHost(host: string | undefined): string {
24:   if (!host) {
25:     throw new AppError(400, 'invalid_host', 'Request is missing a Host header');
26:   }
27:   const labels = host.toLowerCase().split(':')[0].split('.');
28:   if (labels.length < 3 || labels[0] !== 'app' || labels[1].length === 0) {
29:     throw new AppError(400, 'invalid_host', `Host "${host}" does not match the expected "app.<tenant-slug>.<zone>" pattern`);
30:   }
31:   return labels[1];
32: }
33:
34: @Injectable()
35: export class TenantResolutionMiddleware implements NestMiddleware {
36:   constructor(
37:     private readonly jwt: JwtService,
38:     private readonly tenants: TenantsRepository,
39:   ) {}
40:
41:   use(req: Request, res: Response, next: NextFunction): void {
42:     const resolve = async (): Promise<void> => {
43:       const hostSlug = slugFromHost(req.headers.host);
44:
45:       const token = extractBearerToken(req.headers.authorization);
46:       if (!token) {
47:         throw new AppError(401, 'unauthorized', 'Missing Bearer token in the Authorization header');
48:       }
49:
50:       let payload: OrgTokenPayload;
51:       try {
52:         payload = this.jwt.verify(token) as OrgTokenPayload;
53:       } catch {
54:         throw new AppError(401, 'invalid_token', 'The presented token is missing, expired or fails verification');
55:       }
56:
57:       const org = typeof payload.org === 'string' ? payload.org : undefined;
58:       if (!org) {
59:         throw new AppError(401, 'invalid_token', 'The token is missing the "org" claim');
60:       }
61:
62:       if (org !== hostSlug) {
63:         throw new AppError(403, 'tenant_mismatch', 'The token "org" claim does not match the tenant resolved from the request host', {
64:           hostTenant: hostSlug,
65:           tokenTenant: org,
66:         });
67:       }
68:
69:       const tenant = await this.tenants.findBySlug(hostSlug);
70:       if (!tenant) {
71:         throw new AppError(404, 'tenant_not_found', `No tenant is registered for slug "${hostSlug}"`);
72:       }
73:
74:       // Bind the resolved tenant to the request-scoped context for the rest
75:       // of the request: controllers, services and the Prisma extension all
76:       // read it from here and never receive it as an argument.
77:       runWithTenant(tenant);
78:       next(req, res);
79:     };
80:
81:     resolve().catch((error: unknown) => {
82:       if (res.headersSent) {
83:         return;
84:       }
85:       if (error instanceof AppError) {
86:         sendError(res, error);
87:         return;
88:       }
89:       console.error(error);
90:       sendError(res, new AppError(500, 'internal_error', 'Unexpected server error'));
91:     });
92:   }
93: }
```

So:
- Line 77: `runWithTenant(tenant)` — called with 1 argument, but expects 2.
- Line 78: `next(req, res)` — called with 2 arguments, but expects 0-1.

`NextFunction` in Express has the signature: `(err?: any) => void`. It takes 0 or 1 argument (the error). So `next(req, res)` is wrong — it should just be `next()`.

For `runWithTenant`, it expects 2 arguments. I need to look at the `tenant-context` module to understand what it expects. I don't have that file, but based on the error, `runWithTenant` expects 2 arguments. 

Looking at the context — the tenant object likely has an `id` and the function probably needs both the tenant and something else, or it's a `runWithTenant(tenantId, fn)` pattern where you pass the tenant ID and the function to run within that context.

Wait, let me reconsider. The pattern `runWithTenant` with 2 arguments is likely:
- `runWithTenant(tenantId, callback)` — runs the callback within the tenant context.

So line 77 should be `runWithTenant(tenant.id, () => { next(req); })` or similar.

But wait — `next` is a `NextFunction` which takes 0-1 args. So `next(req, res)` should be `next()`.

And `runWithTenant` takes 2 args. The most common pattern for async local storage is:
```ts
function runWithTenant(tenantId: string, fn: () => void | Promise<void>)
```

So the fix would be:
- Line 77: `runWithTenant(tenant.id, () => next());`
- Line 78: remove (it's now inside the callback)

Actually wait, let me reconsider. If `runWithTenant` takes `(tenantId, fn)`, then:
```ts
runWithTenant(tenant.id, () => {
  next();
});
```

But actually, looking more carefully at the structure, the `resolve` function is async and the whole point is that after `runWithTenant`, the rest of the request pipeline (controllers, services) will read the tenant from context. So `next()` should be called within the `runWithTenant` scope.

The two distinct mistakes are:
1. `runWithTenant` is called with 1 arg but needs 2 — it needs the tenant ID and a callback.
2. `next` is called with `(req, res)` but `NextFunction` takes 0-1 args (just an optional error).

Both are in the same file, same lines (77-78). The fix:

```ts
runWithTenant(tenant.id, () => {
  next();
});
```

Wait, but I need to think about whether `runWithTenant` is synchronous or async. If it's async (returns a Promise), then we'd need `await`. But the error just says "Expected 2 arguments, but got 1" — it's about the number of arguments, not about await.

Let me just fix the two errors:
1. `runWithTenant(tenant)` → needs 2 args → `runWithTenant(tenant.id, () => next())`
2. `next(req, res)` → needs 0-1 args → `next()`

These are on consecutive lines, so the fix consolidates them.

The complete file with the fix applied:
```

## reply

### src/tenant/tenant-resolution.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { sendError } from '../common/all-exceptions.filter.js';
import { runWithTenant } from '../common/tenant-context.js';
import { TenantsRepository } from './tenant.repository.js';

interface OrgTokenPayload {
  org?: unknown;
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : undefined;
}

// ASSUMPTION: an operator's public domain is "app.<tenant-slug>.<zone>"
// (e.g. app.operator-x.com); the tenant slug is the second label of the Host header.
function slugFromHost(host: string | undefined): string {
  if (!host) {
    throw new AppError(400, 'invalid_host', 'Request is missing a Host header');
  }
  const labels = host.toLowerCase().split(':')[0].split('.');
  if (labels.length < 3 || labels[0] !== 'app' || labels[1].length === 0) {
    throw new AppError(400, 'invalid_host', `Host "${host}" does not match the expected "app.<tenant-slug>.<zone>" pattern`);
  }
  return labels[1];
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenants: TenantsRepository,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const resolve = async (): Promise<void> => {
      const hostSlug = slugFromHost(req.headers.host);

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new AppError(401, 'unauthorized', 'Missing Bearer token in the Authorization header');
      }

      let payload: OrgTokenPayload;
      try {
        payload = this.jwt.verify(token) as OrgTokenPayload;
      } catch {
        throw new AppError(401, 'invalid_token', 'The presented token is missing, expired or fails verification');
      }

      const org = typeof payload.org === 'string' ? payload.org : undefined;
      if (!org) {
        throw new AppError(401, 'invalid_token', 'The token is missing the "org" claim');
      }

      if (org !== hostSlug) {
        throw new AppError(403, 'tenant_mismatch', 'The token "org" claim does not match the tenant resolved from the request host', {
          hostTenant: hostSlug,
          tokenTenant: org,
        });
      }

      const tenant = await this.tenants.findBySlug(hostSlug);
      if (!tenant) {
        throw new AppError(404, 'tenant_not_found', `No tenant is registered for slug "${hostSlug}"`);
      }

      // Bind the resolved tenant to the request-scoped context for the rest
      // of the request: controllers, services and the Prisma extension all
      // read it from here and never receive it as an argument.
      runWithTenant(tenant.id, () => next());
    };

    resolve().catch((error: unknown) => {
      if (res.headersSent) {
        return;
      }
      if (error instanceof AppError) {
        sendError(res, error);
        return;
      }
      console.error(error);
      sendError(res, new AppError(500, 'internal_error', 'Unexpected server error'));
    });
  }
}
```
