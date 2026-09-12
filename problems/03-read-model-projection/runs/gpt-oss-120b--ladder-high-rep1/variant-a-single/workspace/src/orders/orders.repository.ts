import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(orderId: number) {
    return this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
  }

  async updateStatusAndApproval(orderId: number, status: string, approvedAt: Date, workerId: number) {
    return this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        approvedAt,
        workerId,
      },
    });
  }

  async findManyCreatedBetween(start: Date, end: Date) {
    return this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });
  }
}
