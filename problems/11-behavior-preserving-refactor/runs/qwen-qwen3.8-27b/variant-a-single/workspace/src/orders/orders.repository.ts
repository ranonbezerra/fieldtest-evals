import { Injectable } from '@nestjs/common';
import type { Order, PrismaClient } from '@prisma/client';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<Order[]> {
    return this.prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
