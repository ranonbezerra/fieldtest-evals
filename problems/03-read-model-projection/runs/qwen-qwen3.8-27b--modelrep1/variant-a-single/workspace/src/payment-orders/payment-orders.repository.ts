import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<PaymentOrder | null> {
    return (tx ?? this.prisma).paymentOrder.findUnique({ where: { id } });
  }

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { companyId: string; workerId: string; amountCents: number },
  ): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.create({ data });
  }

  updateStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.update({ where: { id }, data: { status } });
  }
}
