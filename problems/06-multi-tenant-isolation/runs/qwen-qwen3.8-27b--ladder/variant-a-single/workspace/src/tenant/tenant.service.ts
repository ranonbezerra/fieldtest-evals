import { Inject, Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { jwtVerify } from 'jose';
import { ApiError } from '../common/api-error';
import { requireTenantContext } from './tenant-context';
import { TenantRepository } from './tenant.repository';

export interface ResolveInput {
  host: string;
  org: string;
}

@Injectable()
export class TenantService {
  constructor(@Inject(TenantRepository) private readonly tenants: TenantRepository) {}

  /**
   * Verifies the HS256 access token signed with AUTH_SECRET and returns its claims.
   */
  async verifyAccessToken(token: string): Promise<Record<string, unknown>> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new ApiError(500, 'misconfigured', 'AUTH_SECRET is not set; access tokens cannot be verified.');
    }
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      return payload;
    } catch {
      throw new ApiError(401, 'invalid_token', 'The access token is malformed, expired, or failed signature verification.');
    }
  }

  /**
   * Resolves the tenant from two independent sources: the request host and the
   * token org claim. Both must resolve to the same active tenant; anything
   * else is rejected rather than resolved in favour of one side.
   */
  async resolve({ host, org }: ResolveInput): Promise<Tenant> {
    const [byHost, byOrg] = await Promise.all([
      this.tenants.findActiveByDomain(host),
      this.tenants.findActiveBySlug(org),
    ]);
    if (!byHost || !byOrg) {
      throw new ApiError(
        400,
        'unknown_tenant',
        'The request host and the token org claim must both resolve to a known active tenant.',
        { host, org },
      );
    }
    if (byHost.id !== byOrg.id) {
      throw new ApiError(
        403,
        'tenant_mismatch',
        'The request host and the token org claim point at different tenants.',
        { host, org },
      );
    }
    return byHost;
  }

  /**
   * Branding and feature flags for the tenant in the request context.
   */
  async getConfig(): Promise<{
    slug: string;
    name: string;
    branding: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
  }> {
    const ctx = requireTenantContext();
    const tenant = await this.tenants.findScopedById(ctx.id);
    if (!tenant) {
      throw new ApiError(404, 'resource_not_found', 'The resolved tenant is no longer available.');
    }
    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: (tenant.branding ?? {}) as Record<string, unknown>,
      featureFlags: (tenant.featureFlags ?? {}) as Record<string, unknown>,
    };
  }
}
