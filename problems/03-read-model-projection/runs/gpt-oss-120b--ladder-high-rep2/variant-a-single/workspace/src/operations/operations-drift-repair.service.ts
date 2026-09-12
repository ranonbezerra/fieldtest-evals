import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { Prisma, PaymentOrder, OperationProjection } from '@prisma/client';

@Injectable()
export class OperationsDriftRepairService {
  private readonly logger = new Logger(OperationsDriftRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionRepo: OperationsProjectionRepository,
  ) {}

  /**
   * Compares the projection against the source tables for the given window,
   * and repairs any mismatches.
   */
  async repairWindow(startDate: Date, endDate: Date): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Load source orders
      const sourceOrders: PaymentOrder[] = await tx.paymentOrder.findMany({
        where: {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Load current projection rows for the same orders
      const projectionRows: OperationProjection[] = await tx.operationProjection.findMany({
        where: {
          order_id: { in: sourceOrders.map((o) => o.id) },
        },
      });
      const projectionMap = new Map<number, OperationProjection>();
      for (const row of projectionRows) {
        projectionMap.set(row.order_id, row);
      }

      const rowsToUpsert: Parameters<OperationsProjectionRepository['upsertOperationProjection']>[1][] = [];

      for (const order of sourceOrders) {
        const proj = projectionMap.get(order.id);
        const needsUpdate =
          !proj ||
          proj.status !== order.status ||
          proj.amount.toString() !== order.amount.toString() ||
          proj.company_id !== order.company_id ||
          proj.worker_id !== (order.worker_id ?? null);
        if (needsUpdate) {
          rowsToUpsert.push({
            order_id: order.id,
            company_id: order.company_id,
            worker_id: order.worker_id ?? null,
            status: order.status,
            amount: order.amount,
            created_at: order.created_at,
            updated_at: order.updated_at,
          });
        }
      }

      // Apply upserts
      for (const row of rowsToUpsert) {
        await this.projectionRepo.upsertOperationProjection(tx, row);
      }

      // Recompute totals for affected companies
      const affectedCompanyIds = Array.from(
        new Set(rowsToUpsert.map((r) => r.company_id)),
      );
      if (affectedCompanyIds.length > 0) {
        await this.projectionRepo.recomputeCompanyTotals(tx, affectedCompanyIds);
      }
    });

    this.logger.log(`Drift repair completed for window ${startDate.toISOString()} - ${endDate.toISOString()}`);
  }
}
