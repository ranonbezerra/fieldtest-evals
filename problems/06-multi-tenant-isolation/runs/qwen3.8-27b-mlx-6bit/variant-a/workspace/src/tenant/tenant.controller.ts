import { Controller, Get } from '@nestjs/common';
import { TenantService, TenantConfigDto } from './tenant.service.js';

@Controller()
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('tenant-config')
  getConfig(): Promise<TenantConfigDto> {
    return this.service.getConfig();
  }
}
