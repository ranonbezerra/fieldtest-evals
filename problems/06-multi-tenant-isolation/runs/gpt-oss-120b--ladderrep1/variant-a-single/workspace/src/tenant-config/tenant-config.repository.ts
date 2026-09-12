import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<Pick<Tenant, 'branding' | 'featureFlags'> | null> {
    const tenantId = (this.prisma as any).tenantContext?.getTenantId?.();
    if (!tenantId) {
      return null;
    }
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        branding: true,
        featureFlags: true,
      },
    });
  }
}
