import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findByHost(host: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { host } });
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { org } });
  }

  async getConfig(tenantId: number) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { branding: true, feature_flags: true },
    });
  }
}
