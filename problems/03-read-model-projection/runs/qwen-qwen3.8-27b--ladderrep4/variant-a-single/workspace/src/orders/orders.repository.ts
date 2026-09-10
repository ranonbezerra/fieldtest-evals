import { Injectable } from '@nestjs/common';
import type { PaymentOrder } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { ProjectionRepository } from '../projection/projection.repository.js';

/** The order lifecycle used by the write path. */
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface CreateOrderInput {
  companyId: string;
  workerId: string;
  amountCents: bigint;
}

@Injectable()
export class OrderRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {}

  findOrder(id: string): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id } });
  }

  findCompany(id: string): Promise<{ id: string } | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  findWorker(id: string): Promise<{ id: string; companyId: string } | null> {
    return this.prisma.worker.findUnique({ where: { id } });
  }

  /**
   * Writes the source order and maintains the projection inside one
   * transaction: if the insert rolls back, the projection never sees it.
   */
  createOrder(input: CreateOrderInput): Promise<PaymentOrder> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.create({
        data: {
          companyId: input.companyId,
          workerId: input.workerId,
          status: 'pending',
          amount: Number(input.amountCents) / 100,
        },
      });
      await this.projection.onOrderCreated(tx, {
        id: order.id,
        companyId: order.companyId,
        amountCents: input.amountCents,
      });
      return order;
    });
  }

  /**
   * Moves the order `expectedStatus` -> `newStatus` only if it is still in
   * `expectedStatus`, and applies the projection hook in the same
   * transaction. Returns null when a concurrent write changed the state first.
   */
  transitionOrder(id: string, expectedStatus: OrderStatus, newStatus: OrderStatus): Promise<PaymentOrder | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentOrder.updateMany({
        where: { id, status: expectedStatus },
        data: { status: newStatus, updatedAt: new Date() },
      });
      if (updated.count === 0) {
        return null;
      }
      const order = await tx.paymentOrder.findUnique({ where: { id } });
      if (!order) {
        return null;
      }
      await this.projection.onOrderStatusChanged(tx, {
        id: order.id,
        companyId: order.companyId,
        amountCents: BigInt(Math.round(Number(order.amount) * 100)),
        from: expectedStatus,
        to: newStatus,
      });
      return order;
    });
  }
}
