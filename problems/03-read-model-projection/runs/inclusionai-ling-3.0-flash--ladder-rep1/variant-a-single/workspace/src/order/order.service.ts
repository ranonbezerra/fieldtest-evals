import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../types/app.errors';
import { OrderRepository } from './order.repository';
import { ProjectionService } from '../projection/projection.service';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderRepo: OrderRepository,
    private readonly projection: ProjectionService,
  ) {}

  /**
   * Create an order. The projection sync runs inside this transaction so
   * subsequent reads see the new order immediately.
   */
  async createOrder(input: { companyId: string; workerId: string; amount: bigint | number | string }) {
    return this.prisma.$transaction(async (tx) => {
      // Look up denormalised fields within the same tx.
      const [company, worker] = await Promise.all([
        tx.company.findUnique({ where: { id: input.companyId } }),
        tx.worker.findUnique({ where: { id: input.workerId } }),
      ]);
      if (!company) throw new AppError('resource_not_found', `Company ${input.companyId} not found`, 404);
      if (!worker) throw new AppError('resource_not_found', `Worker ${input.workerId} not found`, 404);

      const order = await this.orderRepo.create(tx, input);

      // ── Sync hook 1: write order row into the projection ──
      await this.projection.syncOrderDashboard(tx, {
        orderId: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: worker.name,
        companyName: company.name,
        amount: order.amount,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        eventCount: 0,
      });

      // ── Sync hook 2: update company financial totals (atomic) ──
      await this.projection.updateCompanyTotals(tx, order.companyId, order.amount, 'total');

      return order;
    });
  }

  /**
   * Approve an order. Both source update and projection sync happen in one
   * transaction, guaranteeing read-your-own-writes.
   */
  async approveOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.orderRepo.updateStatus(tx, orderId, 'approved');
      if (!order) {
        const existing = await this.orderRepo.findById(undefined, orderId);
        if (!existing) {
          throw new AppError('resource_not_found', `Order ${orderId} not found`, 404);
        }
        // Already approved or rejected – projection is already in sync, no-op.
        return existing;
      }

      // ── Sync hook 1: flip status in projection ──
      await this.projection.syncOrderDashboardStatus(tx, orderId, 'approved');

      // ── Sync hook 2: increment approved totals atomically ──
      await this.projection.updateCompanyTotals(tx, order.companyId, order.amount, 'approved');

      return order;
    });
  }

  /**
   * Reject an order (pending → rejected). Projection is synced inside the tx.
   */
  async rejectOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.orderRepo.updateStatus(tx, orderId, 'rejected');
      if (!order) {
        throw new AppError('resource_not_found', `Order ${orderId} not found`, 404);
      }

      await this.projection.syncOrderDashboardStatus(tx, orderId, 'rejected');
      return order;
    });
  }
}
