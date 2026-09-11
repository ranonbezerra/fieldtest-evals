import { Controller, Get } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  current() {
    return this.tenants.forCurrentRequest();
  }
}
