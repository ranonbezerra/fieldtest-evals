import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.tenantConfigService.getConfig();
  }
}
