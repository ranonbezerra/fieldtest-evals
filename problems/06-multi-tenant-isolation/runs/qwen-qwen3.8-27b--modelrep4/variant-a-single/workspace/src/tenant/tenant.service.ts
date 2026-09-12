import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { TenantContext } from './tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  name: string;
  slug: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}

@Injectable()
export class TenantService {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Resolves the tenant for a request: the host must belong to a known
   * tenant and the token's `org` claim must agree with it.
   */
  async resolve(host: string, org: string): Promise<Tenant> {
    const tenant = await this.tenants.findByHost(host);
    if (!tenant) {
      throw new ApiError(404, 'tenant_not_found', `No operator is served on host "${host}"`);
    }
    if (tenant.id !== org) {
      throw new ApiError(403, 'tenant_mismatch', `The token "org" claim does not match the operator served on host "${host}"`);
    }
    return tenant;
  }

  /** Branding and feature flags for the tenant bound to the current request. */
  currentConfig(): TenantConfig {
    const tenant = TenantContext.requireTenant();
    return {
      name: tenant.name,
      slug: tenant.slug,
      branding: asRecord(tenant.branding),
      featureFlags: asRecord(tenant.featureFlags),
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
