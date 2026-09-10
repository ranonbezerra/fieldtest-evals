import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, toApiError } from '../common/api-error';
import { tenantStorage } from './tenant-context';
import { TenantService } from './tenant.service';

/**
 * Resolves the tenant for every request: the host and the token org claim are
 * resolved independently and must agree. The resolved tenant is stored in the
 * async-local context for the lifetime of the request; everything downstream
 * (controller -> service -> repository -> tenant-aware Prisma) runs inside it.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new ApiError(401, 'unauthenticated', 'A bearer token is required in the Authorization header.');
      }
      const claims = await this.tenants.verifyAccessToken(token);
      if (typeof claims.org !== 'string' || claims.org.length === 0) {
        throw new ApiError(401, 'invalid_token', 'The access token does not carry a usable org claim.');
      }
      const host = normalizeHost(req.headers.host);
      const tenant = await this.tenants.resolve({ host, org: claims.org });

      await tenantStorage.run({ id: tenant.id, slug: tenant.slug }, () => next());
    } catch (error) {
      // Errors raised in middleware bypass Nest's exception filters, so the
      // single error envelope is written here.
      const { status, code, message, details } = toApiError(error);
      res.status(status).json({ error: { code, message, details } });
    }
  }
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function normalizeHost(header: string | string[] | undefined): string {
  if (!header || typeof header !== 'string') return '';
  return header.split(':')[0].trim().toLowerCase();
}
