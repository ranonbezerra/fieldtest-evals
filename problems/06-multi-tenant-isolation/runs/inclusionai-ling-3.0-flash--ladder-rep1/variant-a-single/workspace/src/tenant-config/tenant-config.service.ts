import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class TenantConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig() {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new NotFoundException('No tenant context');
    }

    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      name: tenant.name,
      domain: tenant.domain,
      branding: tenant.branding,
      flags: tenant.flags,
    };
  }
}
