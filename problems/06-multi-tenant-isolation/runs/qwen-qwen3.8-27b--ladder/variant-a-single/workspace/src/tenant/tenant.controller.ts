import { Controller, Get, Inject } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller()
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get('tenant-config')
  getConfig() {
    return this.tenants.getConfig();
  }
}
