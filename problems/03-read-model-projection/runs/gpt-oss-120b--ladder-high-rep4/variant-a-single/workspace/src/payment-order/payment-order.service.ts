import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma, OrderStatus } from '@prisma/client';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import type { Decimal } from '@prisma/client';

@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderRepo: PaymentOrderRepository,
    private readonly opsRepo: OperationsRepository,
    private readonly totalsRepo: CompanyTotalsRepository,
  ) {}

  async createOrder(data: {
    companyId: number;
    workerId?: number;
    amount: Decimal;
  }) {
    return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.paymentOrder.create({
        data: {
          companyId: data.companyId,
          workerId: data.workerId,
          amount: data.amount,
          status: OrderStatus.PENDING,
        },
      });

      await tx.operationProjection.create({
        data: {
          orderId: order.id,
          companyId: order.companyId,
          workerId: order.workerId,
          status: order.status,
          amount: order.amount,
          eventTimestamp: order.createdAt,
        },
      });

      return order;
    });
  }

  async approveOrder(orderId: number) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: OrderStatus.APPROVED },
      });

      const event = await tx.event.create({
        data: {
          orderId,
          type: 'APPROVED',
        },
      });

      await tx.operationProjection.update({
        where: { orderId },
        data: {
          status: order.status,
          eventTimestamp: event.timestamp,
        },
      });

      await tx.companyFinancialTotal.upsert({
        where: { companyId: order.companyId },
        create: {
          companyId: order.companyId,
          totalAmount: order.amount,
          approvedAmount: order.amount,
        },
        update: {
          totalAmount: {
            increment: order.amount,
          },
          approvedAmount: {
            increment: order.amount,
          },
        },
      });
    });
  }
}
