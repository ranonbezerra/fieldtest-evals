import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  findByDomain(domain: string) {
    return this.prisma.tenant.findFirst({ where: { domain } });
  }

  findByOrgId(orgId: string) {
    return this.prisma.tenant.findFirst({ where: { orgId } });
  }

  findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }
}
