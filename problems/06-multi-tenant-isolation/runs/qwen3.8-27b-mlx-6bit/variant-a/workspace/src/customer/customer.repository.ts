import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../db/prisma.service.js';

export interface NewCustomerRow {
  email: string;
  name: string | null;
}

export interface UpdateCustomerRow {
  email?: string;
  name?: string | null;
}

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.scoped.customer.findMany();
  }

  create(data: NewCustomerRow) {
    return this.prisma.scoped.customer.create({ data });
  }

  async findById(id: string) {
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async update(id: string, data: UpdateCustomerRow) {
    const result = await this.prisma.scoped.customer.updateMany({ where: { id }, data });
    if (result.count === 0) return undefined;
    return this.prisma.scoped.customer.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<number> {
    const result = await this.prisma.scoped.customer.deleteMany({ where: { id } });
    return result.count;
  }
}
