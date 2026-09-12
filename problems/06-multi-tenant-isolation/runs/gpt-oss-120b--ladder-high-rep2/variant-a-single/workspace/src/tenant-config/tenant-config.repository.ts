import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Tenant } from '@prisma/client';
import { TenantContext } from './tenant-context';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Pick<Tenant, 'id' | 'domain' | 'branding' | 'featureFlags'>> {
    const tenantInfo = TenantContext.getTenant();
    if (!tenantInfo) {
      throw new Error('Tenant not set');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantInfo.id },
      select: {
        id: true,
        domain: true,
        branding: true,
        featureFlags: true,
      },
    });
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    return tenant;
  }
}
