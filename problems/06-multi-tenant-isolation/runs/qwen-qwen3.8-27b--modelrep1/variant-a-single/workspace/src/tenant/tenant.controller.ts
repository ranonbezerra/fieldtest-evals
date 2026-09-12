import { Controller, Get } from '@nestjs/common';
import { TenantService, type TenantConfig } from './tenant.service.js';

@Controller('tenant-config')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  getConfig(): TenantConfig {
    return this.tenants.getConfig();
  }
}
