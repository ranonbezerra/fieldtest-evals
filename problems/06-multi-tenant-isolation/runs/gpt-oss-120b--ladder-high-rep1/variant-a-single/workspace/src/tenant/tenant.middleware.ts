import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from './tenant.service.js';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const host = req.headers.host;
    const org = (req as any).user?.org;

    if (!host) {
      throw new BadRequestException('Host header missing');
    }
    if (!org) {
      throw new UnauthorizedException('Auth token missing org claim');
    }

    const [tenantByHost, tenantByOrg] = await Promise.all([
      this.tenantService.findByHost(host),
      this.tenantService.findByOrg(org),
    ]);

    if (!tenantByHost || !tenantByOrg) {
      throw new UnauthorizedException('Tenant not found');
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      throw new UnauthorizedException('Tenant host and org mismatch');
    }

    (req as any).tenant = { id: tenantByHost.id };
    next();
  }
}
