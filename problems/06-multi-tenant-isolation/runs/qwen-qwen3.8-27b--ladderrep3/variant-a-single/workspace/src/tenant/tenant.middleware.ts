import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { decideError } from '../errors/error-mapping';

/**
 * Resolves the tenant (host and token org claim must both resolve and agree)
 * and runs the entire request inside that tenant's AsyncLocalStorage context,
 * so the tenant-aware data layer can scope every query without any handler or
 * repository passing a tenant id.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: TenantContextStorage,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    let tenantId: string;
    try {
      const tenant = await this.resolver.resolve(req.headers.host, req.headers.authorization);
      tenantId = tenant.id;
    } catch (err) {
      if (!res.headersSent) {
        const { status, ...body } = decideError(err);
        res.status(status).json({ error: body });
      }
      return;
    }

    await this.context
      .run({ tenantId }, () => new Promise<void>((resolve, reject) => {
        next((err?: unknown) => (err ? reject(err) : resolve()));
      }))
      .catch((err: unknown) => {
        // Anything that escaped the downstream exception filters.
        if (!res.headersSent) {
          const { status, ...body } = decideError(err);
          res.status(status).json({ error: body });
        }
      });
  }
}
