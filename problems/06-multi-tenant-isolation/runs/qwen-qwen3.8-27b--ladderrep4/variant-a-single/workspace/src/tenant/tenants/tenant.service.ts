import { Injectable } from '@nestjs/common';
import { ResourceNotFoundError } from '../../errors/exceptions.js';
import { TenantContext } from '../tenant-context.js';
import type { TenantAwarePrisma } from '../tenant-prisma.provider.js';

@Injectable()
export class TenantService {
  private readonly context = new TenantContext();

  constructor(private readonly prisma: TenantAwarePrisma) {}

  /** Branding + feature flags for the resolved (request-scoped) tenant. */
  config(): Promise<{ tenantId: string; name: string; domain: string; branding: unknown; featureFlags: unknown }> {
    const tenantId = this.context.current();
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const tenant = await scoped.tenant.findFirst({ where: { id: tenantId } });
      if (!tenant) {
        throw new ResourceNotFoundError('Tenant was not found.');
      }
      return {
        tenantId: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        branding: tenant.branding,
        featureFlags: tenant.featureFlags,
      };
    });
  }
}
