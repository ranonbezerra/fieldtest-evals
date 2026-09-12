import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OperationsRebuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionRepo: OperationsProjectionRepository,
  ) {}

  /**
   * Re-derives the projection for orders created between startDate and endDate.
   * Safe to run concurrently with live traffic.
   */
  async rederive(startDate: Date, endDate: Date): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Remove existing projection rows for the window
      await this.projectionRepo.deleteOperationsByDateRange(tx, startDate, endDate);

      // Load source orders
      const orders = await tx.paymentOrder.findMany({
        where: {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Transform to projection rows
      const projectionRows = orders.map((order: Prisma.PaymentOrder) => ({
        order_id: order.id,
        company_id: order.company_id,
        worker_id: order.worker_id ?? null,
        status: order.status,
        amount: order.amount,
        created_at: order.created_at,
        updated_at: order.updated_at,
      }));

      // Insert projection rows
      await this.projectionRepo.insertManyOperations(tx, projectionRows);

      // Recompute totals for affected companies
      const companyIds = await this.projectionRepo.findAllCompanyIdsInWindow(
        tx,
        startDate,
        endDate,
      );
      if (companyIds.length > 0) {
        await this.projectionRepo.recomputeCompanyTotals(tx, companyIds);
      }
    });
  }
}
