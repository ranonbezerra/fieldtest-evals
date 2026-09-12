import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get()
  async getConfig() {
    return this.service.getConfig();
  }
}
