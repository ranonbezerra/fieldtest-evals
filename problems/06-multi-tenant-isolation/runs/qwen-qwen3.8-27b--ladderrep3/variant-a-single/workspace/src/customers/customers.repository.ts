import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TENANT_DB } from '../prisma/prisma.module';

/**
 * The only layer that touches the database for customers — and it never
 * mentions a tenant id. Scoping and write-stamping happen entirely inside
 * the tenant-aware client (TENANT_DB).
 */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(TENANT_DB) private readonly db: PrismaClient) {}

  list() {
    return this.db.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string) {
    return this.db.customer.findUnique({ where: { tenantId_id: { tenantId: '', id } } });
  }

  create(data: { email: string; name: string }) {
    return this.db.customer.create({ data: { ...data, tenantId: '' } });
  }

  update(id: string, data: { name: string }) {
    return this.db.customer.update({ where: { tenantId_id: { tenantId: '', id } }, data });
  }

  remove(id: string) {
    return this.db.customer.delete({ where: { tenantId_id: { tenantId: '', id } } });
  }
}
