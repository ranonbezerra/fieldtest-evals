import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentOrderRepository } from './payment-order.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime';

@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrderRepo: PaymentOrderRepository,
    private readonly operationsRepo: OperationsRepository,
  ) {}

  /**
   * Approve an order. The status update and the projection maintenance are performed
   * inside a single transaction so that the operator sees the change immediately.
   */
  async approveOrder(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Update the source order status
      const order = await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: 'APPROVED' },
        select: {
          id: true,
          companyId: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      });

      // Load related event (if any)
      const event = await tx.event.findFirst({
        where: { orderId: order.id },
        select: { type: true, timestamp: true },
      });

      // Load a worker (if any). In a real schema we would have a foreign key;
      // here we just fetch the first worker as a placeholder.
      const worker = await tx.worker.findFirst({
        select: { id: true },
      });

      // Upsert the projection row
      await this.operationsRepo.upsertProjection(tx, {
        orderId: order.id,
        companyId: order.companyId,
        status: order.status,
        amount: order.amount as Decimal,
        workerId: worker?.id,
        eventType: event?.type,
        eventTimestamp: event?.timestamp,
        createdAt: order.createdAt,
      });

      // Atomically increment the per‑company total
      await this.operationsRepo.incrementCompanyTotal(tx, order.companyId, order.amount as Decimal);
    });
  }
}
