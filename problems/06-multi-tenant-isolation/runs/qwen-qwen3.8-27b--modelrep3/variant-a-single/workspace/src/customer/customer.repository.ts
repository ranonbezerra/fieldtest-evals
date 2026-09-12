import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { TenantPrismaService } from '../tenant/tenant-prisma.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantPrismaService) {}

  findMany(): Promise<Customer[]> {
    return this.prisma.client.customer.findMany({
      orderBy: { createdAt: 'asc' },
    }) as Promise<Customer[]>;
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.client.customer.findFirst({ where: { id } }) as Promise<Customer | null>;
  }

  create(input: CustomerInput): Promise<Customer> {
    return this.prisma.client.customer.create({ data: input }) as Promise<Customer>;
  }

  async update(id: string, input: CustomerUpdateInput): Promise<Customer | null> {
    const result = await this.prisma.client.customer.updateMany({
      where: { id },
      data: input,
    }) as { count: number };

    if (result.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async delete(id: string): Promise<{ id: string } | null> {
    const result = await this.prisma.client.customer.deleteMany({ where: { id } }) as {
      count: number;
    };

    if (result.count === 0) {
      return null;
    }

    return { id };
  }
}
