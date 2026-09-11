import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../errors/exceptions.js';
import { TenantContext } from '../tenant/tenant-context.js';
import { HostTenantExtractor } from './host-tenant.extractor.js';
import { TenantResolver } from './tenant.resolver.js';
import type { TokenVerifier } from './token-verifier.contract.js';

/**
 * Resolves the tenant for every request from two independent sources —
 * the request host and the verified `org` claim of the bearer token —
 * and rejects unless both agree. The resolved tenant is placed in
 * request-scoped context (AsyncLocalStorage) for the rest of the call.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenVerifier: TokenVerifier,
    private readonly hostTenantExtractor: HostTenantExtractor,
    private readonly tenantResolver: TenantResolver,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (url === '/' || url === '/health') {
      next();
      return;
    }

    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      next(new UnauthenticatedError('Missing or malformed Authorization header; expected "Bearer <token>".'));
      return;
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (token.length === 0) {
      next(new UnauthenticatedError('Missing bearer token.'));
      return;
    }

    const hostTenant = this.hostTenantExtractor.fromRequest(req);
    void (async () => {
      const { org } = await this.tokenVerifier.verify(token);
      const tenantId = this.tenantResolver.resolve({ hostTenant, org });
      const context = new TenantContext();
      await context.runWithTenant(tenantId, () => this.tenantResolver.assertExists(tenantId));
      next();
    })().catch(next);
  }
}
