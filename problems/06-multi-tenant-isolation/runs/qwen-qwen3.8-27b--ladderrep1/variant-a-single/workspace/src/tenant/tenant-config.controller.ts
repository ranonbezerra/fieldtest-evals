import { Controller, Get } from '@nestjs/common';
import { TenantService, type TenantConfig } from './tenant.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getTenantConfig(): Promise<TenantConfig> {
    return this.tenantService.getTenantConfig();
  }
}
