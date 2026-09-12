import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { TenantRepository } from './tenant.repository.js';
import { ResolvedTenant, TenantConfigDto } from './tenant.types.js';
import { ApiError } from '../common/api-error.js';

@Injectable()
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}

  async findTenantByHost(host: string): Promise<ResolvedTenant | null> {
    const tenant = await this.repository.findByHost(host);
    return tenant ? this.toResolved(tenant) : null;
  }

  async getConfig(tenantId: string): Promise<TenantConfigDto> {
    const tenant = await this.repository.findById(tenantId);
    if (!tenant) {
      throw new ApiError(404, 'resource_not_found', 'Tenant not found.', { tenantId });
    }

    return {
      id: tenant.id,
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      featureFlags: toFeatureFlags(tenant.featureFlags),
    };
  }

  private toResolved(tenant: Tenant): ResolvedTenant {
    return {
      id: tenant.id,
      slug: tenant.slug,
      host: tenant.host,
      name: tenant.name,
      primaryColor: tenant.primaryColor,
      logoUrl: tenant.logoUrl,
      featureFlags: toFeatureFlags(tenant.featureFlags),
    };
  }
}

function toFeatureFlags(value: unknown): Record<string, boolean> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, boolean>;
  }
  return {};
}
