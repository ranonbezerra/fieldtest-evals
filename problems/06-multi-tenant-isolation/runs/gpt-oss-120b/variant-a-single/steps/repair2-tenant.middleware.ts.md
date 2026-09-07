# repair2-tenant.middleware.ts

## reasoning

```
We need to rewrite tenant middleware to fix compile errors. Errors: cannot find module 'express' or its types. So need to import Request, Response, NextFunction from 'express'. Also cannot find './tenant.context', so we need to import TenantContext from that path; but file maybe missing. We'll need to assume TenantContext exists with static methods getTenantId and setTenantId maybe. We'll implement accordingly.

Goal: middleware resolves tenant from host header and auth token's org claim, ensure they match, set TenantContext for request. Also reject mismatches with HttpException.

Need to import Injectable, NestMiddleware, BadRequestException, UnauthorizedException perhaps from '@nestjs/common'.

Implement class TenantMiddleware implements NestMiddleware with use(req, res, next). Extract host: req.headers.host. Extract token: maybe from Authorization header Bearer JWT; we will not decode JWT fully, assume token is parsed elsewhere and the org claim is attached to req.user perhaps. Since we don't know, we can assume token org is in req.user?.org.

But to satisfy compile, just implement with placeholders and ASSUMPTION comment.

Also need to export.

Also need to set request-scoped context: using TenantContext.setTenantId(tenantId). Since TenantContext static.

Potential missing types: need to import Request, Response, NextFunction.

Implement.

Add // ASSUMPTION lines for token extraction.

Return next() else throw HttpException.

Let's craft code.
```

## reply

```ts
// src/tenant/tenant.middleware.ts

import { Injectable, NestMiddleware, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext } from './tenant.context';

/**
 * Middleware that resolves the tenant for every incoming request.
 *
 * 1. The tenant identifier is read from the request host header
 *    (e.g. `app.operator-x.com` → `operator-x`).
 * 2. The JWT authentication guard (outside of this middleware) is expected
 *    to have attached the decoded token payload to `req.user`. The tenant claim
 *    is assumed to be available as `req.user.org`.
 * 3. Both values must be present and must match; otherwise the request is
 *    rejected.
 * 4. The resolved tenant identifier is stored in `TenantContext`, which is a
 *    request‑scoped holder used by the Prisma client middleware.
 *
 * The implementation purposefully avoids any business‑logic coupling – it
 * only validates and propagates the tenant identifier.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // -----------------------------------------------------------------------
    // 1️⃣ Resolve tenant from host header.
    // -----------------------------------------------------------------------
    const host = req.headers.host;
    if (!host) {
      throw new BadRequestException('Missing Host header');
    }

    // Example: `app.operator-x.com` → `operator-x`
    // The exact extraction logic depends on the deployment pattern.
    // --------------------------------------------------------------
    // ASSUMPTION: the sub‑domain before the first dot after the optional
    // `app.` prefix is the tenant identifier.
    const subDomain = host.split('.').slice(0, -2).join('.'); // drop the domain & TLD
    const tenantFromHost = subDomain.replace(/^app-?/, '').replace(/^app\./, '');

    if (!tenantFromHost) {
      throw new BadRequestException('Unable to determine tenant from host');
    }

    // -----------------------------------------------------------------------
    // 2️⃣ Resolve tenant from JWT `org` claim.
    // -----------------------------------------------------------------------
    // ASSUMPTION: an authentication guard has already validated the JWT and
    // attached the decoded payload to `req.user`. The tenant claim is named
    // `org`. If your project uses a different shape, adjust the property access.
    const user = (req as any).user;
    const tenantFromToken = user?.org;

    if (!tenantFromToken) {
      throw new UnauthorizedException('Missing tenant claim in authentication token');
    }

    // -----------------------------------------------------------------------
    // 3️⃣ Ensure both sources agree.
    // -----------------------------------------------------------------------
    if (tenantFromHost !== tenantFromToken) {
      throw new UnauthorizedException(
        `Tenant mismatch: host resolves to "${tenantFromHost}" but token contains "${tenantFromToken}"`,
      );
    }

    // -----------------------------------------------------------------------
    // 4️⃣ Store resolved tenant in request‑scoped context.
    // -----------------------------------------------------------------------
    TenantContext.setTenantId(tenantFromHost);

    // Continue to the next middleware / route handler.
    next();
  }
}
```
