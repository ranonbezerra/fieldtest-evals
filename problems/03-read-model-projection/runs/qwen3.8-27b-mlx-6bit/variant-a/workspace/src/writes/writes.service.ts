import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ProjectionsService } from '../projections/projections.service';
import { CreateOrderInput, OrderStatus } from '../projections/projections.types';

@Injectable()
export class WritesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projections: ProjectionsService,
  ) {}

  async createOrder(
    input: CreateOrderInput,
  ): Promise<{ id: string; status: OrderStatus }> {
    return this.prisma.$transaction(async (tx) => {
      // ASSUMPTION: schema.prisma is not visible here; the Prisma model name for
      // payment_orders (`paymentOrder`) and its relation properties (`worker`, `event`)
      // are inferred from the plan's table/column layout.
      const order = await tx.paymentOrder.create({
        data: {
          companyId: input.companyId,
          workerId: input.workerId,
          eventId: input.eventId,
          status: 'pending',
          amountCents: input.amountCents,
        },
      });

      // Joined source row (order + worker + event), read inside the same transaction.
      await tx.paymentOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { worker: true, event: true },
      });

      await this.projections.applyOrderCreated(input, {
        id: order.id,
        createdAt: order.createdAt,
      });

      return { id: order.id, status: order.status };
    });
  }

  async approveOrder(
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    return this.prisma.$transaction(async (tx) =>
      this.changeOrderStatus(tx, orderId, 'approved'),
    );
  }

  async rejectOrder(
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    return this.prisma.$transaction(async (tx) =>
      this.changeOrderStatus(tx, orderId, 'rejected'),
    );
  }

  private async changeOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    targetStatus: OrderStatus,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await tx.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${orderId} was not found in payment_orders.`,
          details: { orderId },
        },
      });
    }

    if (order.status === targetStatus) {
      throw new ConflictException({
        error: {
          code: 'invalid_transition',
          message: `Order ${orderId} is already '${order.status}'; it cannot be transitioned to '${targetStatus}'.`,
          details: {
            orderId,
            currentStatus: order.status,
            requestedStatus: targetStatus,
          },
        },
      });
    }

    const updated = await tx.paymentOrder.update({
      where: { id: orderId },
      data: { status: targetStatus },
    });

    await this.projections.applyOrderStatusChanged(orderId, targetStatus);

    return { id: updated.id, status: updated.status };
  }
}
