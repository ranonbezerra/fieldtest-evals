import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';
import { TenantConfigService } from './tenant-config.service.js';

@Controller()
export class TenantConfigController {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly service: TenantConfigService,
  ) {}

  @Get('tenant-config')
  async getTenantConfig(): Promise<TenantConfigDto> {
    const tenantId = this.tenantContext.getTenantId();
    return this.service.getConfig(tenantId);
  }
}
