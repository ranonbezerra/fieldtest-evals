import { Tenant } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { getTenantContext } from './tenant-context.util.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  slug: string;
  name: string;
  domain: string;
  branding: {
    brandName: string;
    primaryColor: string;
    logoUrl: string | null;
  };
  featureFlags: string[];
}

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  async config(): Promise<TenantConfig> {
    // The tenant is already resolved (and agreed on) by the middleware;
    // this only loads its configuration.
    const { tenantId } = getTenantContext();
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('The resolved tenant no longer exists');
    return this.toConfig(tenant);
  }

  private toConfig(tenant: Tenant): TenantConfig {
    const flags = Array.isArray(tenant.featureFlags)
      ? (tenant.featureFlags as unknown[]).filter((flag): flag is string => typeof flag === 'string')
      : [];
    return {
      slug: tenant.slug,
      name: tenant.name,
      domain: tenant.domain,
      branding: {
        brandName: tenant.brandName,
        primaryColor: tenant.primaryColor,
        logoUrl: tenant.logoUrl,
      },
      featureFlags: flags,
    };
  }
}
