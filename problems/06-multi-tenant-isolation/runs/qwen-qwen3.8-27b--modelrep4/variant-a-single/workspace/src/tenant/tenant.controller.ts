import { Controller, Get } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import type { TenantConfig } from './tenant.service.js';

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get('tenant-config')
  getConfig(): TenantConfig {
    return this.tenants.currentConfig();
  }
}
