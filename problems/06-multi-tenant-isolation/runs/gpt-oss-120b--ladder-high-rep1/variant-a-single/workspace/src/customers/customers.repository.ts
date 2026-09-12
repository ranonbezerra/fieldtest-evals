import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Customer } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: number): Promise<Customer | null> {
    // Use findFirst so the tenant middleware can add the tenant filter
    return this.prisma.customer.findFirst({
      where: { id },
    });
  }

  async create(data: { email: string; name: string }): Promise<Customer> {
    return this.prisma.customer.create({ data });
  }

  async update(id: number, data: { email?: string; name?: string }): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async delete(id: number): Promise<Customer> {
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
