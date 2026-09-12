import { Inject, Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../prisma/prisma.module.js';

@Injectable()
export class TenantsRepository {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { slug } });
  }
}
