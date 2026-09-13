import { Controller, Get, UseInterceptors, Req } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { AppException } from '../common/app-exception.js';
import { getTenantId } from '../common/tenant-context.js';

@Controller('tenant-config')
export class TenantController {
  constructor(private tenantService: TenantService) {}

  @Get()
  async getConfig(@Req() req: any) {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new AppException('unauthorized', 'No tenant context', 401);
    }
    const tenant = await this.tenantService.findById(tenantId);
    if (!tenant) {
      throw new AppException('tenant_not_found', 'Tenant not found', 404);
    }
    return {
      name: tenant.name,
      domain: tenant.domain,
      brandColor: tenant.brandColor,
      logoUrl: tenant.logoUrl,
      featureFlags: tenant.featureFlags,
    };
  }
}
