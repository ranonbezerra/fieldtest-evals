import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * All calls go through the tenant-scoped Prisma client: the ambient tenant
 * is injected into every where clause and stamped onto every write. This
 * repository (and every caller) never mentions tenantId.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.customer.findFirst({ where: { id } });
  }

  create(data: { email: string; name: string }) {
    return this.prisma.tenant.customer.create({ data });
  }

  update(id: string, data: { email?: string; name?: string }) {
    return this.prisma.tenant.customer.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.tenant.customer.delete({ where: { id } });
  }
}
