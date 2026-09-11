import { Injectable } from '@nestjs/common';
import {
  ResourceNotFoundError,
  TenantMismatchError,
  UnauthenticatedError,
} from '../errors/exceptions.js';
import { assertTenantId } from '../tenant/tenant-id.js';
import type { TenantAwarePrisma } from '../tenant/tenant-prisma.provider.js';

@Injectable()
export class TenantResolver {
  constructor(private readonly prisma: TenantAwarePrisma) {}

  /**
   * Both the host-derived tenant and the token `org` claim must be valid
   * and must point at the same tenant; a mismatch is rejected.
   */
  resolve(input: { hostTenant: string; org: unknown }): string {
    if (typeof input.org !== 'string' || input.org.length === 0) {
      throw new UnauthenticatedError('Token has no usable org claim.');
    }
    const tokenTenant = assertTenantId(input.org);
    if (input.hostTenant !== tokenTenant) {
      throw new TenantMismatchError(
        `Host tenant "${input.hostTenant}" and token org "${tokenTenant}" do not agree; refusing to resolve.`,
      );
    }
    return tokenTenant;
  }

  /**
   * Called with the tenant already in request-scoped context.
   */
  assertExists(tenantId: string): Promise<unknown> {
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const tenant = await scoped.tenant.findFirst({ where: { id: tenantId } });
      if (!tenant) {
        throw new ResourceNotFoundError(`Tenant "${tenantId}" was not found.`);
      }
      return tenant;
    });
  }
}
