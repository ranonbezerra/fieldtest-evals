import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../common/app-exception.js';
import { tenantContext } from './tenant-context.js';
import { verifyAuthToken } from './token.js';
import { TenantRepository } from './tenant.repository.js';

export interface TenantConfig {
  id: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
}

function normalizeHost(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }

  const value = host.split(':')[0].toLowerCase().trim();
  return value.length > 0 ? value : undefined;
}

@Injectable()
export class TenantService {
  constructor(private readonly tenantRepository: TenantRepository) {}

  async resolveTenant(req: Request): Promise<string> {
    const host = normalizeHost(req.headers.host);
    if (!host) {
      throw new AppException(400, 'invalid_host', 'Host header is required', {});
    }

    const token = verifyAuthToken(req.headers.authorization as string | undefined);

    const tenantByHost = await this.tenantRepository.findByHost(host);
    const tenantByOrg = await this.tenantRepository.findById(token.org);

    if (!tenantByHost || !tenantByOrg) {
      throw new AppException(401, 'tenant_not_found', 'Tenant not found for host or token org claim', {});
    }

    if (tenantByHost.id !== tenantByOrg.id) {
      throw new AppException(
        403,
        'tenant_mismatch',
        'Host and token org claim must resolve to the same tenant',
        {},
      );
    }

    return tenantByHost.id;
  }

  async getTenantConfig(): Promise<TenantConfig> {
    const tenantId = tenantContext.getTenantId();
    if (!tenantId) {
      throw new AppException(
        500,
        'tenant_context_missing',
        'Tenant context is required to read tenant config',
        {},
      );
    }

    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new AppException(404, 'tenant_not_found', 'Tenant not found', { id: tenantId });
    }

    return {
      id: tenant.id,
      name: tenant.name,
      branding: tenant.branding as Record<string, unknown>,
      featureFlags: tenant.featureFlags as Record<string, unknown>,
    };
  }
}
