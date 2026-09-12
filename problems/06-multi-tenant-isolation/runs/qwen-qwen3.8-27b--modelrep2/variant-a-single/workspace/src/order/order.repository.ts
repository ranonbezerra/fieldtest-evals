import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.order.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.order.findFirst({ where: { id } });
  }

  create(data: { customerId: string; planId: string; totalCents: number }) {
    return this.prisma.tenant.order.create({ data });
  }
}
