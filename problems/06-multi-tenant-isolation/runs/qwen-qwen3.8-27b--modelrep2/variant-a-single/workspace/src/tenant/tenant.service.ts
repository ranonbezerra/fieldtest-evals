import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { tenantContext } from '../common/tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  tenant: { id: string; slug: string; name: string; domain: string };
  branding: Prisma.JsonValue;
  featureFlags: Prisma.JsonValue;
}

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Resolves the tenant for a request. The request host and the `org`
   * claim of the token must both resolve to the same tenant; anything
   * else is a rejection, never a guess.
   */
  async resolveFromRequest(domain: string, orgClaim: string): Promise<string> {
    const byDomain = await this.tenants.findByDomain(domain);
    if (!byDomain) {
      throw new AppError(404, 'tenant_not_found', `No tenant is served on host "${domain}".`, {
        host: domain,
      });
    }

    const byOrg = await this.tenants.findBySlug(orgClaim);
    if (!byOrg || byOrg.id !== byDomain.id) {
      throw new AppError(
        403,
        'tenant_mismatch',
        'The token "org" claim does not match the tenant served on this host.',
        { host: domain, org: orgClaim },
      );
    }

    return byDomain.id;
  }

  /** Branding and feature flags for the tenant of the current request. */
  async configForCurrentTenant(): Promise<TenantConfig> {
    const tenantId = tenantContext.require();
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new AppError(404, 'resource_not_found', 'The resolved tenant no longer exists.', {
        id: tenantId,
      });
    }
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, domain: tenant.domain },
      branding: tenant.branding ?? {},
      featureFlags: tenant.featureFlags ?? {},
    };
  }
}
