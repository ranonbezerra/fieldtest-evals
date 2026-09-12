import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client';
import { OrdersService } from '../orders/orders.service.js';
import { DriftRepairService } from '../drift-repair/drift-repair.service.js';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly driftRepairService: DriftRepairService,
  ) {}

  async listOperations(params: {
    companyId?: number;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const {
      companyId,
      status,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = params;

    const where: Prisma.OperationDashboardWhereInput = {};

    if (companyId !== undefined) {
      where.companyId = companyId;
    }

    if (status !== undefined) {
      where.status = status;
    }

    if (startDate !== undefined || endDate !== undefined) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as any).gte = startDate;
      }
      if (endDate) {
        (where.createdAt as any).lte = endDate;
      }
    }

    return this.prisma.operationDashboard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });
  }

  /**
   * Re‑derives the projection for a given date window.
   * Safe to run while the system is live.
   */
  async rederiveProjection(start: Date, end: Date): Promise<void> {
    // Fetch source orders in the window
    const orders = await this.ordersService.getOrdersCreatedBetween(start, end);
    const orderIds = orders.map((o) => o.id);

    // Delete existing projection rows for those orders
    await this.prisma.operationDashboard.deleteMany({
      where: {
        orderId: { in: orderIds },
      },
    });

    // Insert fresh projection rows
    for (const order of orders) {
      await this.prisma.operationDashboard.create({
        data: {
          orderId: order.id,
          companyId: order.companyId,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt,
          workerId: order.workerId,
        },
      });
    }

    // Re‑compute financial totals for affected companies
    const companyIds = [...new Set(orders.map((o) => o.companyId))];
    for (const companyId of companyIds) {
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
  }

  // Expose drift‑repair for tests or manual runs
  async runDriftRepair(): Promise<void> {
    await this.driftRepairService.repairDrift();
  }
}
