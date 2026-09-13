import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
// @ts-ignore
import * as jwt from 'jsonwebtoken';
import { TenantService } from '../tenant/tenant.service.js';
import { setTenantContext } from './tenant-context.js';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // 1. Resolve tenant from host
    const host = req.headers.host || '';
    const domain = host.split(':')[0];

    let tenantFromHost;
    try {
      tenantFromHost = await this.tenantService.findByDomain(domain);
    } catch {
      // Prisma error or similar — will be handled below
      tenantFromHost = null;
    }

    if (!tenantFromHost) {
      throw new UnauthorizedException({
        error: { code: 'tenant_not_found', message: `No tenant found for host: ${domain}`, details: {} },
      });
    }

    // 2. Resolve tenant from JWT org claim
    const authHeader = req.headers.authorization;
    let payload: any;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      } catch {
        throw new UnauthorizedException({
          error: { code: 'unauthorized', message: 'Invalid or expired token', details: {} },
        });
      }
    }

    if (!payload?.org) {
      throw new UnauthorizedException({
        error: { code: 'unauthorized', message: 'Missing org claim in token', details: {} },
      });
    }

    let tenantFromToken;
    try {
      tenantFromToken = await this.tenantService.findByOrgId(payload.org);
    } catch {
      tenantFromToken = null;
    }

    // 3. Both must agree
    if (!tenantFromToken || tenantFromToken.id !== tenantFromHost.id) {
      throw new UnauthorizedException({
        error: { code: 'tenant_mismatch', message: 'Host and token org do not agree', details: {} },
      });
    }

    // 4. Set request-scoped context
    setTenantContext({ tenantId: tenantFromHost.id });
    (req as any).tenantId = tenantFromHost.id;

    next();
  }
}
