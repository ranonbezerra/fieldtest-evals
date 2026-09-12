import {
  Injectable,
  NestMiddleware,
  HttpException,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service.js';
import { TenantContext } from './tenant.context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantService?: TenantService,
    private readonly tenantContext?: TenantContext,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host?.split(':')[0];
    if (!host) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Host header missing',
              details: {},
            },
          },
          400,
        ),
      );
    }

    const user = (req as any).user;
    if (!user?.org) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Authenticated user missing org claim',
              details: {},
            },
          },
          401,
        ),
      );
    }

    if (!this.tenantService || !this.tenantContext) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_resolution_failed',
              message: 'Tenant services not initialized',
              details: {},
            },
          },
          500,
        ),
      );
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantService.findByDomain(host),
      this.tenantService.findByOrg(user.org),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_not_found',
              message: 'Tenant could not be found for given host or org',
              details: {},
            },
          },
          404,
        ),
      );
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      return next(
        new HttpException(
          {
            error: {
              code: 'tenant_mismatch',
              message: 'Host and token org refer to different tenants',
              details: {},
            },
          },
          400,
        ),
      );
    }

    await this.tenantContext.run(tenantByHost.id, async () => {
      next();
    });
  }
}
