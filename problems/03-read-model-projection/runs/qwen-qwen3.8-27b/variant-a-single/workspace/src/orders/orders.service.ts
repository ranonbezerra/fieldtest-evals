import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type { CreateOrderInput, CreatePaymentOrderDto, TransitionOrderDto } from './orders.dto.js';
import { canTransition } from './order-transitions.js';
import { OrdersRepository, type OrderWithRelations } from './orders.repository.js';

/**
 * Simulated write path: operators create payment orders and transition their
 * status. Every call maintains the read model synchronously (see
 * OrdersRepository), so operators see their own writes on the next request.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  createOrder(input: CreatePaymentOrderDto): Promise<OrderWithRelations> {
    const orderInput: CreateOrderInput = {
      companyId: input.companyId,
      workerId: input.workerId,
      eventId: input.eventId,
      status: input.status ?? 'pending',
      amount: input.amount ?? 0,
      currency: input.currency ?? 'USD',
      createdAt: input.createdAt !== undefined ? new Date(input.createdAt) : undefined,
    };
    return this.ordersRepository.createOrder(orderInput);
  }

  async transitionOrder(id: string, input: TransitionOrderDto): Promise<OrderWithRelations> {
    const order = await this.ordersRepository.findOrder(id);
    if (!order) {
      throw ApiError.notFound(`Payment order "${id}" does not exist.`, { orderId: id });
    }
    if (!canTransition(order.status, input.status)) {
      throw ApiError.conflict(
        `Order "${id}" cannot move from "${order.status}" to "${input.status}".`,
        { orderId: id, currentStatus: order.status, requestedStatus: input.status },
      );
    }
    if (input.workerId !== undefined) await this.ordersRepository.assertWorkerExists(input.workerId);
    if (input.eventId !== undefined) await this.ordersRepository.assertEventExists(input.eventId);

    return this.ordersRepository.transitionOrder({
      id,
      status: input.status,
      workerId: input.workerId,
      eventId: input.eventId,
      expectedFrom: order.status,
    });
  }
}
