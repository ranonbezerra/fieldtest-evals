import { Injectable, BadRequestException } from '@nestjs/common';
import { NestMiddleware, Request, Response } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { setTenantContext } from '../common/tenant-context.js';

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, _res: Response, next: Function) {
    const host = (req.headers.get('host') || '').split(':')[0];
    const authHeader = (req.headers.get('authorization') || '') as string;
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const tokenPayload = decodeJwt(token);
    const orgClaim = tokenPayload?.org;

    const hostTenant = await this.tenantService.resolveByDomain(host);
    const tokenTenant = orgClaim
      ? await this.tenantService.resolveByOrg(orgClaim)
      : null;

    if (!hostTenant || !tokenTenant || hostTenant.id !== tokenTenant.id) {
      throw new BadRequestException('Tenant resolution failed: host and token do not agree');
    }

    setTenantContext(hostTenant.id);
    (req as any).tenant = hostTenant;

    next();
  }
}
