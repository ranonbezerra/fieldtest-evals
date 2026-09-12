import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(orderId: string) {
    return this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
  }

  async updateStatus(orderId: string, status: string) {
    return this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: { status },
    });
  }
}
