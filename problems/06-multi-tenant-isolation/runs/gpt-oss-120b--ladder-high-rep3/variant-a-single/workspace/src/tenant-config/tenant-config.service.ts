import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenant-context/tenant-context.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = TenantContext.getTenantId();
    if (!tenantId) {
      throw new NotFoundException({
        error: {
          code: 'tenant_not_resolved',
          message: 'Tenant not resolved',
          details: {}
        }
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        branding: true,
        featureFlags: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Tenant not found',
          details: {}
        }
      });
    }

    return tenant;
  }
}
