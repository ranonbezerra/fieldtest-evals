import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import type { TenantRepository } from '../src/tenant/tenant.repository.js';
import { TenantConfigService } from '../src/tenant-config/tenant-config.service.js';

const tenantRow = {
  id: 'tenant-a',
  slug: 'operator-a',
  host: 'app.operator-a.com',
  name: 'Operator A',
  primaryColor: '#0f766e',
  logoUrl: 'https://cdn.example.com/logo.png',
  featureFlags: { billing: true, beta: false },
};

function makeTenantService() {
  const repository = {
    findById: async (id: string) => (id === tenantRow.id ? tenantRow : null),
    findByHost: async (host: string) => (host === tenantRow.host ? tenantRow : null),
  };

  return new TenantService(repository as unknown as TenantRepository);
}

describe('tenant config', () => {
  it('returns branding and feature flags for the resolved tenant', async () => {
    const service = new TenantConfigService(makeTenantService());

    const config = await service.getConfig(tenantRow.id);

    expect(config).toEqual({
      id: tenantRow.id,
      name: tenantRow.name,
      primaryColor: tenantRow.primaryColor,
      logoUrl: tenantRow.logoUrl,
      featureFlags: tenantRow.featureFlags,
    });
  });

  it('throws resource_not_found for an unknown tenant', async () => {
    const service = new TenantConfigService(makeTenantService());
    let caught: unknown;

    try {
      await service.getConfig('missing');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(404);
    expect((caught as ApiError).code).toBe('resource_not_found');
  });

  it('resolves a tenant by host', async () => {
    const tenantService = makeTenantService();

    const tenant = await tenantService.findTenantByHost(tenantRow.host);

    expect(tenant?.id).toBe(tenantRow.id);
    expect(tenant?.slug).toBe(tenantRow.slug);
  });
});
