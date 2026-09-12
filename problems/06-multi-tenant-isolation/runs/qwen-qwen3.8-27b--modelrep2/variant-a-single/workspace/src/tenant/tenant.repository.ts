import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Access to the tenant registry. The only repository that talks to the
 * unscoped Prisma client, because tenant resolution runs before any
 * request-scoped tenant context exists.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDomain(domain: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { domain } });
  }

  findBySlug(slug: string) {
    return this.prisma.unscoped.tenant.findUnique({ where: { slug } });
  }

  findById(id: string) {
    return this.prisma.unscoped.tenant.findFirst({ where: { id } });
  }
}
