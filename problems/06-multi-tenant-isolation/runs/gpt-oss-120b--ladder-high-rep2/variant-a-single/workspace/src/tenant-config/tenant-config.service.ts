import { Injectable } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantConfigService {
  constructor(private readonly repo: TenantConfigRepository) {}

  async getConfig(): Promise<Pick<Tenant, 'id' | 'domain' | 'branding' | 'featureFlags'>> {
    return this.repo.getConfig();
  }
}
