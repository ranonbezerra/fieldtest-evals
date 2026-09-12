import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext, TenantInfo } from './tenant-context';

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Resolve host (domain)
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      throw new UnauthorizedException('Missing Host header');
    }
    const host = hostHeader.split(':')[0];

    // Resolve org claim from request.user set by AuthMiddleware
    const user = (req as any).user;
    const orgClaim = user?.org;
    if (!orgClaim) {
      throw new UnauthorizedException('Missing org claim in token');
    }

    // Find tenant by domain (host)
    const tenant = await this.prisma.tenant.findUnique({
      where: { domain: host },
    });

    if (!tenant) {
      throw new ForbiddenException(`Tenant not found for host ${host}`);
    }

    if (tenant.id !== orgClaim) {
      throw new ForbiddenException('Tenant mismatch between host and token');
    }

    const tenantInfo: TenantInfo = { id: tenant.id };
    // Run the rest of the request inside async local storage context
    TenantContext.run(tenantInfo, () => {
      // Attach tenant to request for convenience
      (req as any).tenant = tenant;
      next();
    });
  }
}
