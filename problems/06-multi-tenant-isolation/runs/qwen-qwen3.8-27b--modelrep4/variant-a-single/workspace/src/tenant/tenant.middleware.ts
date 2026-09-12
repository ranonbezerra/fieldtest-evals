import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError, ValidationError } from '../common/api-error.js';
import { TenantContext } from './tenant-context.js';
import { TenantService } from './tenant.service.js';

/**
 * Resolves the tenant for every request: the `Host` header selects a tenant
 * and the bearer token's `org` claim must agree with it. The resolved tenant
 * is then bound to the request-scoped context for the rest of the request.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const host = resolveHost(req);
      if (!host) {
        throw new ValidationError('Request has no usable "Host" header');
      }
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new ApiError(401, 'unauthorized', 'A bearer token is required for tenant-scoped requests');
      }
      const org = verifyOrgClaim(token);
      const tenant = await this.tenants.resolve(host, org);
      TenantContext.run({ tenantId: tenant.id, tenant }, () => next());
    } catch (error) {
      next(error);
    }
  }
}

function resolveHost(req: Request): string {
  const raw: unknown = req.headers.host;
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (typeof single !== 'string' || single.length === 0) {
    return '';
  }
  const first = single.split(',')[0].trim().toLowerCase();
  const withoutPort = first.split(':')[0]?.trim() ?? '';
  return withoutPort;
}

function extractBearerToken(authorization: unknown): string | null {
  const single = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof single !== 'string' || single.trim().length === 0) {
    return null;
  }
  const parts = single.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

function verifyOrgClaim(token: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ApiError(500, 'auth_not_configured', 'JWT_SECRET is not set; bearer tokens cannot be verified');
  }
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (error) {
    const code = error instanceof jwt.TokenExpiredError ? 'token_expired' : 'invalid_token';
    throw new ApiError(401, code, `The bearer token could not be verified (${code})`);
  }
  if (typeof payload === 'string' || typeof payload.org !== 'string' || payload.org.length === 0) {
    throw new ApiError(401, 'missing_org_claim', 'The bearer token does not carry a string "org" claim');
  }
  return payload.org;
}
