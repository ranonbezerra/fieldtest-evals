import { Injectable, NestMiddleware } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantService } from './tenant.service.js';
import { ResolvedTenant } from './tenant.types.js';

export interface TenantRequest extends Request {
  tenant?: ResolvedTenant;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantService: TenantService,
  ) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const host = normalizeHost(req.headers.host);
      if (!host) {
        throw new ApiError(400, 'invalid_host', 'Host header is required.', {});
      }

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        throw new ApiError(401, 'invalid_token', 'Authorization bearer token is required.', {});
      }

      const org = verifyOrgToken(token);
      const tenant = await this.tenantService.findTenantByHost(host);
      if (!tenant) {
        throw new ApiError(400, 'unknown_host', 'Host does not map to a known tenant.', {
          host,
        });
      }

      // ASSUMPTION: The token org claim is the tenant slug, or the tenant id.
      if (org !== tenant.slug && org !== tenant.id) {
        throw new ApiError(403, 'tenant_mismatch', 'Token org claim does not match the tenant host.', {
          org,
          host,
          tenant: tenant.slug,
        });
      }

      req.tenant = tenant;
      await this.tenantContext.run(tenant, async () => {
        await next();
      });
    } catch (error) {
      next(error);
    }
  }
}

function normalizeHost(value: string | string[] | undefined): string {
  if (!value) return '';

  const raw = Array.isArray(value) ? value[0] : value;
  const host = raw.trim().toLowerCase();
  const portIndex = host.indexOf(':');
  return portIndex === -1 ? host : host.slice(0, portIndex);
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) return null;

  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function verifyOrgToken(token: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret) {
    throw new ApiError(500, 'internal_error', 'AUTH_TOKEN_SECRET is not configured.', {});
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'invalid_token', 'Bearer token is invalid.', {});
  }

  if (typeof payload === 'string' || typeof payload.org !== 'string') {
    throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  }

  const org = payload.org.trim();
  if (org.length === 0) {
    throw new ApiError(401, 'invalid_token', 'Token org claim is invalid.', {});
  }

  return org;
}
