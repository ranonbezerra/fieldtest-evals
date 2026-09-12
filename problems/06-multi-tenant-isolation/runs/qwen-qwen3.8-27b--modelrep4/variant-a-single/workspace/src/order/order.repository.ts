import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { ConflictError } from '../common/api-error.js';
import { isPrismaForeignKeyViolation, isPrismaUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Order[]> {
    return this.prisma.client.order.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.client.order.findUnique({ where: { id } });
  }

  async create(data: {
    reference: string;
    customerId: string;
    planId?: string;
    amountCents: number;
    currency?: string;
  }): Promise<Order> {
    try {
      return await this.prisma.client.order.create({ data });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictError('order_reference_already_exists', `An order with reference "${data.reference}" already exists in this tenant`);
      }
      if (isPrismaForeignKeyViolation(error)) {
        throw new ConflictError('order_reference_invalid', 'Order references a customer or plan that is not visible in this tenant');
      }
      throw error;
    }
  }
}
