// src/tenant-config/tenant-config.controller.ts

import { Controller, Get, Req, HttpException, HttpStatus } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

// ASSUMPTION: The tenant middleware stores the resolved tenant identifier on the
// request object under the `tenantId` property. The service exposes a method
// `getConfig(tenantId: string)` that returns the tenant's branding and feature
// flags.

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  async getConfig(@Req() req: any) {
    const tenantId: string | undefined = req?.tenantId;

    if (!tenantId) {
      // No tenant resolved – this should not happen if the middleware is
      // correctly applied, but we guard against it.
      throw new HttpException(
        { error: { code: 'tenant_not_resolved', message: 'Tenant could not be resolved', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const config = await this.tenantConfigService.getConfig(tenantId);
    return { data: config };
  }
}
