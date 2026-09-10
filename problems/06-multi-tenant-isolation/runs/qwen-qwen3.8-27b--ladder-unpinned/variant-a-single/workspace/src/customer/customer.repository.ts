import { Injectable, Scope } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface CustomerCreateInput {
  email: string;
  name: string | null;
}

export interface CustomerUpdateInput {
  email: string;
  name: string | null;
}

@Injectable({ scope: Scope.REQUEST })
export class CustomerRepository {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(data: CustomerCreateInput) {
    return this.tenantPrisma.customer.create({ data });
  }

  async findMany() {
    return this.tenantPrisma.customer.findMany();
  }

  async findById(id: string) {
    return this.tenantPrisma.customer.findUnique({ where: { id } });
  }

  async update(id: string, data: CustomerUpdateInput) {
    return this.tenantPrisma.customer.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.tenantPrisma.customer.delete({ where: { id } });
  }
}
