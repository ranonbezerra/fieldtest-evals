import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from '../tenant/tenant.repository.js';
import { TenantContext } from './tenant-context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantRepo: TenantRepository,
    private readonly tenantContext: TenantContext,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing host header',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const host = hostHeader.split(':')[0]; // strip port if present

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing or malformed Authorization header',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = authHeader.slice(7);
    const orgClaim = this.extractOrgClaim(token);
    if (!orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Token missing org claim',
            details: {},
          },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tenant = await this.tenantRepo.findByDomain(host);
    if (!tenant) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_found',
            message: `Tenant not found for domain ${host}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (tenant.orgClaim !== orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_mismatch',
            message: 'Host and token org claim do not match',
            details: {},
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Run remaining request handling inside the tenant‑scoped AsyncLocalStorage context
    this.tenantContext.run(tenant.id, () => next());
  }

  private extractOrgClaim(token: string): string | null {
    try {
      const payloadPart = token.split('.')[1];
      if (!payloadPart) return null;
      const decoded = Buffer.from(payloadPart, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded);
      return payload.org ?? null;
    } catch {
      return null;
    }
  }
}
