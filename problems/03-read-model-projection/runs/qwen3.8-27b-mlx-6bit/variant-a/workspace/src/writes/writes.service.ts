import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ProjectionsService } from '../projections/projections.service';
import { CreateOrderInput, OrderStatus } from '../projections/projections.types';

@Injectable()
export class WritesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projections: ProjectionsService,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<{ id: string; status: OrderStatus }> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.create({
        data: {
          companyId: input.companyId,
          workerId: input.workerId,
          eventId: input.eventId,
          amountCents: input.amountCents,
        },
      });

      await this.projections.applyOrderCreated(input, {
        id: order.id,
        createdAt: order.createdAt,
      });

      return { id: order.id, status: order.status };
    });
  }

  async approveOrder(orderId: string): Promise<{ id: string; status: OrderStatus }> {
    return this.changeOrderStatus(orderId, 'approved');
  }

  async rejectOrder(orderId: string): Promise<{ id: string; status: OrderStatus }> {
    return this.changeOrderStatus(orderId, 'rejected');
  }

  private async changeOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<{ id: string; status: OrderStatus }> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }

      if (order.status === newStatus) {
        throw new BadRequestException(`Invalid transition: order is already ${newStatus}`);
      }

      await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
      });

      await this.projections.applyOrderStatusChanged(orderId, newStatus);

      return { id: order.id, status: newStatus };
    });
  }
}
