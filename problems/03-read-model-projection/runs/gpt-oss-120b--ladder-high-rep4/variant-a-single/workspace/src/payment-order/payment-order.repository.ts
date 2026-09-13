import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { PaymentOrder } from '@prisma/client';

@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id } });
  }
}
