import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Order } from '@prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../prisma/prisma.module.js';

@Injectable()
export class OrderRepository {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  create(data: {
    customerId: string;
    planId: string;
    status: string;
    totalCents: number;
  }): Promise<Order> {
    return this.prisma.order.create({ data: data as unknown as Prisma.OrderUncheckedCreateInput });
  }

  list(): Promise<Order[]> {
    return this.prisma.order.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findFirst({ where: { id } });
  }

  update(id: string, data: { status?: string }): Promise<Prisma.BatchPayload> {
    return this.prisma.order.updateMany({ where: { id }, data });
  }

  delete(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.order.deleteMany({ where: { id } });
  }
}
