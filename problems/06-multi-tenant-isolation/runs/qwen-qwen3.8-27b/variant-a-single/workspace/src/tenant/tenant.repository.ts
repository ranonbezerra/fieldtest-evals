import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { domain } });
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async update(id: string, data: Partial<Omit<Tenant, 'id' | 'createdAt'>>): Promise<Tenant> {
    return this.prisma.tenant.update({ where: { id }, data });
  }
}
