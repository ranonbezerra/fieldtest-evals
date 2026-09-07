import { Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception.js';
import { getCurrentTenant, type TenantContext } from './tenant-context.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  org: string;
  host: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}

@Injectable()
export class TenantService {
  constructor(private readonly repository: TenantRepository) {}

  async resolve(input: { host: string; org: string }): Promise<TenantContext> {
    const hostTenant = await this.repository.findByHost(input.host);
    if (!hostTenant) {
      throw new AppException(
        401,
        'unknown_tenant',
        'The request host does not belong to a tenant.',
        { host: input.host },
      );
    }

    const orgTenant = await this.repository.findByOrg(input.org);
    if (!orgTenant) {
      throw new AppException(
        401,
        'unknown_org',
        'The token org claim does not belong to a tenant.',
        { org: input.org },
      );
    }

    if (hostTenant.id !== orgTenant.id) {
      throw new AppException(
        403,
        'tenant_mismatch',
        'The request host and token org claim do not agree.',
        { host: input.host, org: input.org },
      );
    }

    return {
      tenantId: hostTenant.id,
      org: hostTenant.org,
      host: hostTenant.host,
    };
  }

  async getConfig(): Promise<TenantConfig> {
    const context = getCurrentTenant();
    if (!context) {
      throw new AppException(
        500,
        'missing_tenant_context',
        'A tenant context is required to read tenant configuration.',
      );
    }

    const tenant = await this.repository.findById(context.tenantId);
    if (!tenant) {
      throw new AppException(
        500,
        'tenant_context_invalid',
        'The tenant for the current context no longer exists.',
      );
    }

    return {
      org: tenant.org,
      host: tenant.host,
      name: tenant.name,
      branding: (tenant.branding ?? {}) as Record<string, unknown>,
      featureFlags: (tenant.featureFlags ?? {}) as Record<string, unknown>,
    };
  }
}
