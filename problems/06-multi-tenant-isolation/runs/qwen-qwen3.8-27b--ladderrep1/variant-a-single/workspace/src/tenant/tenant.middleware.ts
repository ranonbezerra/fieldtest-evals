import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { tenantContext } from './tenant-context.js';
import { TenantService } from './tenant.service.js';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    let nextCalled = false;

    const safeNext = (error?: unknown): void => {
      if (nextCalled) {
        return;
      }
      nextCalled = true;
      next(error as Error | undefined);
    };

    this.tenantService
      .resolveTenant(req)
      .then((tenantId) => {
        (req as unknown as Record<string, unknown>).tenantId = tenantId;
        tenantContext.run(tenantId, () => {
          safeNext();
        });
      })
      .catch(safeNext);
  }
}
