import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { OrdersRepository } from './orders.repository.js';
import { Decimal } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  /**
   * Approves an order and updates the projection and financial totals
   * within the same transaction (read‑your‑own‑writes guarantee).
   */
  async approveOrder(orderId: number, approvingWorkerId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // Update the source order
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          workerId: approvingWorkerId,
        },
      });

      // Upsert the projection row
      await tx.operationDashboard.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          companyId: order.companyId,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
        update: {
          status: order.status,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
      });

      // Increment company financial total atomically
      await tx.companyFinancialTotal.upsert({
        where: { companyId: order.companyId },
        create: {
          companyId: order.companyId,
          totalAmount: order.amount,
        },
        update: {
          totalAmount: {
            increment: order.amount,
          },
        },
      });
    });
  }

  // Helper used by the re‑derivation routine
  async getOrdersCreatedBetween(start: Date, end: Date) {
    return this.ordersRepository.findManyCreatedBetween(start, end);
  }
}
