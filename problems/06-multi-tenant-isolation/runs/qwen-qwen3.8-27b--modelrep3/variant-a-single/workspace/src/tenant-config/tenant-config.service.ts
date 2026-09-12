import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service.js';
import { TenantConfigDto } from '../tenant/tenant.types.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly tenantService: TenantService) {}

  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    return this.tenantService.getConfig(tenantId);
  }
}
