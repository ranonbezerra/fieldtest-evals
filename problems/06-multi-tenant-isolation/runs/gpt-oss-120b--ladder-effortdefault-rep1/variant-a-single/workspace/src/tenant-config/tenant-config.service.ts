import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly repo: TenantConfigRepository) {}

  async getConfig() {
    const config = await this.repo.getConfig();
    if (!config) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Tenant configuration not found',
          details: {},
        },
      });
    }
    return {
      branding: config.branding,
      featureFlags: config.featureFlags,
    };
  }
}
