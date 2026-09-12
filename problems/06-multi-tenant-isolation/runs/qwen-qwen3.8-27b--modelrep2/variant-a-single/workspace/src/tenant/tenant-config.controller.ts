import { Controller, Get } from '@nestjs/common';
import { TenantConfig, TenantService } from './tenant.service.js';

// Path fixed by the task (singular on purpose, despite the plural convention).
@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  getConfig(): Promise<TenantConfig> {
    return this.tenants.configForCurrentTenant();
  }
}
