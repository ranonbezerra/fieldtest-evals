import { Injectable, NestMiddleware } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { AppError, errorEnvelope } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantService } from './tenant.service.js';

/**
 * Resolves the tenant for every request: the Bearer token must be valid,
 * carry an `org` claim, and both the `org` claim and the request host must
 * point at the same tenant. On success the tenant id is installed in the
 * request-scoped context for the remainder of the request.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgClaim = this.readOrgClaim(req);
      const domain = normalizeHost(req.headers.host);
      const tenantId = await this.tenants.resolveFromRequest(domain, orgClaim);
      await tenantContext.run(tenantId, () => next());
    } catch (err) {
      this.reject(res, err);
    }
  }

  /** Verifies the Bearer token and returns its `org` claim. */
  private readOrgClaim(req: Request): string {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : undefined;
    if (!token) {
      throw new AppError(401, 'unauthorized', 'A Bearer token in the Authorization header is required.');
    }

    // ASSUMPTION: tokens are verified as HS256 with the shared secret in JWT_SECRET.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new AppError(500, 'internal_error', 'JWT_SECRET is not configured.');
    }

    let payload: unknown;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw new AppError(401, 'unauthorized', 'The access token is invalid or expired.');
    }

    const org =
      typeof payload === 'object' && payload !== null ? (payload as { org?: unknown }).org : undefined;
    if (typeof org !== 'string' || org.trim().length === 0) {
      throw new AppError(401, 'unauthorized', 'The access token is missing a usable "org" claim.');
    }
    return org;
  }

  private reject(res: Response, err: unknown): void {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json(errorEnvelope(err.code, err.message, err.details));
      return;
    }
    console.error('Tenant resolution failed:', err);
    res.status(500).json(errorEnvelope('internal_error', 'An unexpected error occurred.'));
  }
}

/** Lowercases the Host header and strips the port, if present. */
function normalizeHost(raw: string | string[] | undefined): string {
  const host = Array.isArray(raw) ? raw[0] : raw;
  const normalized = (host ?? '').trim().toLowerCase();
  const portIndex = normalized.lastIndexOf(':');
  return portIndex === -1 ? normalized : normalized.slice(0, portIndex);
}
