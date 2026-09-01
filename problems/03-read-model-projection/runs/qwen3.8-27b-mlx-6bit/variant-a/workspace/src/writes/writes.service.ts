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
    const order = await this.prisma.paymentOrder.create({
      data: {
        companyId: input.companyId,
        workerId: input.workerId,
        eventId: input.eventId,
        amountCents: input.amountCents,
        status: 'pending',
      },
    });

    await this.projections.applyOrderCreated(input, { id: order.id, createdAt: order.createdAt });

    return { id: order.id, status: 'pending' };
  }

  async approveOrder(orderId: string): Promise<{ id: string; status: OrderStatus }> {
    return this.transitionOrder(orderId, 'approved');
  }

  async rejectOrder(orderId: string): Promise<{ id: string; status: OrderStatus }> {
    return this.transitionOrder(orderId, 'rejected');
  }

  private async transitionOrder(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });

    if (!order) {
      throw new NotFoundException({
        error: { code: 'order_not_found', message: `Order ${orderId} not found`, details: {} },
      });
    }

    if (order.status === newStatus) {
      throw new BadRequestException({
        error: { code: 'invalid_transition', message: `Order is already ${newStatus}`, details: {} },
      });
    }

    await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: { status: newStatus },
    });

    await this.projections.applyOrderStatusChanged(orderId, newStatus);

    return { id: orderId, status: newStatus };
  }
}
