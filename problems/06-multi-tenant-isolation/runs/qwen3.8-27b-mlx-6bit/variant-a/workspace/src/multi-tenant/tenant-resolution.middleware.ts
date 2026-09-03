import { Injectable, NestMiddleware, Scope, ScopeEnum } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantContextService } from './tenant-context.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantMismatchError, UnknownTenantError } from './errors.js';

@Scope(ScopeEnum.REQUEST)
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const host = req.headers.host;

    if (!host) {
      throw new UnknownTenantError();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnknownTenantError();
    }

    const token = authHeader.slice('Bearer '.length);
    let orgClaim: string;
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;
      orgClaim = payload.org as string;
    } catch {
      throw new UnknownTenantError();
    }

    if (!orgClaim) {
      throw new UnknownTenantError();
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { domain: host } });

    if (!tenant) {
      throw new UnknownTenantError();
    }

    if (tenant.id !== orgClaim) {
      throw new TenantMismatchError();
    }

    this.tenantCtx.resolve({ tenantId: tenant.id, domain: host });
    next();
  }
}
