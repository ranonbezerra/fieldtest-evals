import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByDomain(domain: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { domain },
    });
  }

  async resolveByOrg(org: string) {
    return this.prisma.prisma.tenant.findFirst({
      where: { org },
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.prisma.tenant.findFirst({
      where: { id },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}
