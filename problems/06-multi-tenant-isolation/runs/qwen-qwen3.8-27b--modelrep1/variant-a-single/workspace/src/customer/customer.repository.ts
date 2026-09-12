import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../prisma/prisma.module.js';

@Injectable()
export class CustomerRepository {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  // tenantId is never passed here: the tenant-isolation Prisma extension
  // stamps writes and scopes reads from the request context.
  create(data: { email: string; name: string }): Promise<Customer> {
    return this.prisma.customer.create({ data: data as Prisma.CustomerUncheckedCreateInput });
  }

  list(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { id } });
  }

  update(id: string, data: { email?: string; name?: string }): Promise<Prisma.BatchPayload> {
    return this.prisma.customer.updateMany({ where: { id }, data });
  }

  delete(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.customer.deleteMany({ where: { id } });
  }
}
