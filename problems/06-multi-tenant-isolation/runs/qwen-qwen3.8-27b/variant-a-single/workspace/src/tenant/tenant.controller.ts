import { Controller, Get } from '@nestjs/common';
import { TenantService } from './tenant.service.js';

@Controller('tenant-config')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getTenantConfig() {
    return this.tenantService.getConfig();
  }
}
