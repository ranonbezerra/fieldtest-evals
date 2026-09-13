import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { TenantConfig } from '@prisma/client';

@Injectable()
export class TenantConfigService {
  constructor(private readonly repository: TenantConfigRepository) {}

  async getConfig(): Promise<TenantConfig> {
    const config = await this.repository.getConfig();
    if (!config) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'Tenant configuration not found',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return config;
  }
}
