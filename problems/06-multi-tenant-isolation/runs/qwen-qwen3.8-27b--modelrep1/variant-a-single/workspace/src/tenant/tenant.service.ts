import { Injectable } from '@nestjs/common';
import { currentTenant } from '../common/tenant-context.js';

export interface TenantConfig {
  tenant: { id: string; slug: string; name: string };
  branding: { brandName: string; primaryColor: string; logoUrl: string | null };
  featureFlags: Record<string, unknown>;
}

@Injectable()
export class TenantService {
  /**
   * Branding + feature flags for the tenant resolved on the current request.
   * The tenant record is provided by the request-scoped context set by the
   * resolution middleware, so this performs no additional database access.
   */
  getConfig(): TenantConfig {
    const tenant = currentTenant();
    const flags = tenant.featureFlags;
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      branding: {
        brandName: tenant.brandName,
        primaryColor: tenant.primaryColor,
        logoUrl: tenant.logoUrl,
      },
      featureFlags: flags !== null && typeof flags === 'object' && !Array.isArray(flags) ? flags : {},
    };
  }
}
