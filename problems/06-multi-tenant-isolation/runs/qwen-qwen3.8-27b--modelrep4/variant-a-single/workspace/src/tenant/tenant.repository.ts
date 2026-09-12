import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByHost(host: string): Promise<Tenant | null> {
    // The tenant table is shared infrastructure, not tenant-scoped data.
    return this.prisma.client.tenant.findUnique({ where: { host } });
  }
}
