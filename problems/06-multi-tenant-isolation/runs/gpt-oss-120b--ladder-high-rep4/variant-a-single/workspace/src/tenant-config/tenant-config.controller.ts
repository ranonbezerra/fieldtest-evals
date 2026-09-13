import { Controller, Get } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service.js';
import { TenantConfig } from '@prisma/client';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Get()
  async getConfig(): Promise<TenantConfig> {
    return this.service.getConfig();
  }
}
