import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { domain },
    });
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { org },
    });
  }
}
