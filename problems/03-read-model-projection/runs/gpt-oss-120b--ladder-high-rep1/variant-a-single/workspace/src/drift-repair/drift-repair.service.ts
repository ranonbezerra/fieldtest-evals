import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Decimal } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs periodically (every minute) to compare the projection with the source
   * for a recent window and repair any drift.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async repairDrift(): Promise<void> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Fetch source orders in the recent window
    const sourceOrders = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: fiveMinutesAgo,
          lte: now,
        },
      },
    });

    const affectedCompanyIds = new Set<number>();

    for (const order of sourceOrders) {
      // Upsert projection row to match source
      await this.prisma.operationDashboard.upsert({
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

      if (order.status === 'approved') {
        affectedCompanyIds.add(order.companyId);
      }
    }

    // Re‑compute totals for affected companies
    for (const companyId of affectedCompanyIds) {
      const agg = await this.prisma.paymentOrder.aggregate({
        _sum: { amount: true },
        where: {
          companyId,
          status: 'approved',
        },
      });
      const total = agg._sum.amount ?? new Decimal(0);
      await this.prisma.companyFinancialTotal.upsert({
        where: { companyId },
        create: { companyId, totalAmount: total },
        update: { totalAmount: total },
      });
    }

    this.logger.debug(
      `Drift repair completed for ${sourceOrders.length} orders`,
    );
  }
}
