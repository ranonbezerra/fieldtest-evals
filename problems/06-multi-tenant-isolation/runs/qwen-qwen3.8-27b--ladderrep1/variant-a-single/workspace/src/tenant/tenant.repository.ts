import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByHost(host: string): Promise<Tenant | null> {
    return this.prisma.client.tenant.findFirst({ where: { host } });
  }

  findById(id: string): Promise<Tenant | null> {
    return this.prisma.client.tenant.findFirst({ where: { id } });
  }
}
