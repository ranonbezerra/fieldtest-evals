import { HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { verifyJwt } from '../auth/jwt.util.js';
import { runWithTenant, TenantContext } from './tenant-context.util.js';
import { TenantRepository } from './tenant.repository.js';

// ASSUMPTION: a tenant's registered `domain` is the only host-to-tenant
// mapping (no host can resolve a tenant without a row in `tenants`), and the
// token verification secret is read from JWT_SECRET.

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantRepository) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.resolveTenant(req);
      // The whole downstream pipeline runs inside this tenant's context.
      runWithTenant(context, () => next());
    } catch (error) {
      next(error);
    }
  }

  private async resolveTenant(req: Request): Promise<TenantContext> {
    const host = this.hostOf(req);
    const token = this.bearerToken(req);

    if (!token) {
      throw this.rejection(401, 'unauthorized', 'A bearer token is required', {});
    }

    const payload = verifyJwt(token, process.env.JWT_SECRET ?? '');
    if (!payload) {
      throw this.rejection(401, 'unauthorized', 'The bearer token is invalid or expired', {});
    }

    const hostTenant = await this.tenants.findByDomain(host);
    if (!hostTenant) {
      throw this.rejection(404, 'tenant_not_found', `No tenant is registered for host "${host}"`, { host });
    }

    // Both sources must resolve to the same tenant; a mismatch is rejected,
    // never resolved in favour of one side.
    const org = typeof payload.org === 'string' ? payload.org : undefined;
    if (org !== hostTenant.slug) {
      throw this.rejection(
        403,
        'tenant_mismatch',
        'The host and the token org claim do not resolve to the same tenant',
        { host, hostTenant: hostTenant.slug, org: org ?? null },
      );
    }

    return { tenantId: hostTenant.id, slug: hostTenant.slug, domain: hostTenant.domain };
  }

  private hostOf(req: Request): string {
    return (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
  }

  private bearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const [scheme, ...rest] = header.split(' ');
    if (scheme.toLowerCase() !== 'bearer' || rest.length !== 1 || !rest[0]) return null;
    return rest[0];
  }

  private rejection(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): HttpException {
    return new HttpException({ error: { code, message, details } }, status);
  }
}
