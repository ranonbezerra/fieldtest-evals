# repair1-tenant.middleware.ts

## reasoning

```
We need to write tenant.middleware.ts that compiles, providing required imports: express types, TenantContext, etc. Likely Nest middleware implements NestMiddleware, uses Request, Response, NextFunction. Use @Injectable. Resolve tenant from host and token org claim. Assuming token parsed and attached to request.user with org property. We'll just implement basics.

Need to import Request, Response, NextFunction from 'express'. Also import Injectable, NestMiddleware from '@nestjs/common'. Import TenantContext. Also maybe import JwtService? Not required. We'll just read request.headers.host and request.user?.org.

Implement: get host tenantId from subdomain? Simplify: assume host is like `${tenantId}.example.com` and we extract first part. Then compare with token org claim. If mismatch, throw HttpException with error envelope.

Return next().

Provide error envelope format.

Write code.
```

## reply

```typescript
// src/tenant/tenant.middleware.ts

import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext } from './tenant.context';

/**
 * Middleware that resolves the tenant for each request.
 *
 * It extracts the tenant identifier from the incoming Host header
 * (e.g. `my-tenant.example.com` → `my-tenant`) and from the JWT token
 * (the `org` claim, assumed to be attached to `request.user` by a preceding
 * authentication middleware). Both values must be present and must match.
 *
 * The resolved tenant identifier is stored in the request‑scoped
 * {@link TenantContext}. Subsequent layers (e.g. the Prisma service) read the
 * identifier from this context to enforce data isolation.
 *
 * On mismatch or missing information a standardized error envelope is thrown.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContext) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    // 1️⃣ Resolve tenant from Host header.
    const host = req.headers.host;
    const hostTenantId = host ? this.extractTenantFromHost(host) : undefined;

    // 2️⃣ Resolve tenant from JWT token (already decoded by auth guard).
    //    We assume the authentication layer attaches the payload to `req.user`.
    const tokenTenantId = (req as any).user?.org;

    // 3️⃣ Validate presence.
    if (!hostTenantId || !tokenTenantId) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Unable to resolve tenant from request.',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4️⃣ Ensure both sources agree.
    if (hostTenantId !== tokenTenantId) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_mismatch',
            message:
              'Tenant derived from host does not match tenant in token.',
            details: { hostTenantId, tokenTenantId },
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 5️⃣ Store in the request‑scoped context for downstream use.
    this.tenantContext.setTenantId(hostTenantId);

    // Continue the request pipeline.
    next();
  }

  /**
   * Extracts the tenant identifier from a Host header.
   *
   * Expected format: `<tenantId>.<domain>` (e.g. `acme.app.com`).
   * If the host does not contain a dot, the whole host is returned.
   */
  private extractTenantFromHost(host: string): string {
    const firstDot = host.indexOf('.');
    return firstDot === -1 ? host : host.substring(0, firstDot);
  }
}
```
