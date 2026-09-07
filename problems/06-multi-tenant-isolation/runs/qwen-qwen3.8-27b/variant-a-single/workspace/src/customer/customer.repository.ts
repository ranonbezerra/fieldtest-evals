import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tenantClient.customer.findMany();
  }

  async findById(id: string) {
    return this.prisma.tenantClient.customer.findUnique({ where: { id } });
  }

  async create(data: {
    email: string;
    name: string;
    planId?: string | null;
  }) {
    return this.prisma.tenantClient.customer.create({ data });
  }

  async update(id: string, data: { email?: string; name?: string; planId?: string | null }) {
    return this.prisma.tenantClient.customer.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.tenantClient.customer.delete({ where: { id } });
  }
}
