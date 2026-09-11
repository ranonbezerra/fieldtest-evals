import { Controller, Get } from '@nestjs/common';
import { TenantService } from './tenant.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getConfig() {
    return this.tenantService.config();
  }
}
