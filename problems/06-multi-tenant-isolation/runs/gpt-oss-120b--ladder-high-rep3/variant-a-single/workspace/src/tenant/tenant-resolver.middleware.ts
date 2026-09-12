// @ts-ignore: express types are not available in this environment
import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
// @ts-ignore: express types are not available in this environment
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from './tenant.repository.js';
import { TenantContext } from '../tenant-context/tenant-context.js';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const hostHeader = req.headers.host;
    const host = typeof hostHeader === 'string' ? hostHeader.split(':')[0] : undefined;

    const authHeader = req.headers['authorization'];
    const orgClaim =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!host || !orgClaim) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_resolution_failed',
            message: 'Missing host or org claim',
            details: {}
          }
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantRepo.findByDomain(host),
      this.tenantRepo.findByOrg(orgClaim),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_not_found',
            message: 'Tenant not found',
            details: {}
          }
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      throw new HttpException(
        {
          error: {
            code: 'tenant_mismatch',
            message: 'Host and token org claim refer to different tenants',
            details: {}
          }
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const tenant = tenantByHost;

    await TenantContext.run(tenant.id, async () => {
      (req as any).tenant = tenant;
      await next();
    });
  }
}
