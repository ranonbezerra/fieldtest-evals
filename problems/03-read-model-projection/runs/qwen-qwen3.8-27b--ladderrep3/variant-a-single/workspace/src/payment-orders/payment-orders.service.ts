import { Inject, Injectable } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service.js';
import {
  PaymentOrderRepository,
  type NewPaymentOrder,
  type OrderWithRelations,
} from './payment-orders.repository.js';

export interface OrderDto {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class PaymentOrderService {
  constructor(
    @Inject(PaymentOrderRepository) private readonly orders: PaymentOrderRepository,
    @Inject(ProjectionService) private readonly projection: ProjectionService,
  ) {}

  /**
   * Write path: the source row and the projection are maintained inside ONE
   * transaction. The operator sees the new state on the next request
   * (read-your-own-writes), and a rolled-back write never touched the
   * projection.
   */
  create(input: NewPaymentOrder): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.createInTx(tx, input);
      await this.projection.applyOrderCreated(tx, order); // maintenance hook
      return toDto(order);
    });
  }

  approve(id: string): Promise<OrderDto> {
    return this.transition(id, 'approved');
  }

  reject(id: string): Promise<OrderDto> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.transitionInTx(tx, id, to);
      await this.projection.applyOrderStatusChanged(tx, order, 'pending'); // maintenance hook
      return toDto(order);
    });
  }
}

function toDto(order: OrderWithRelations): OrderDto {
  return {
    id: order.id,
    company_id: order.companyId,
    worker_id: order.workerId,
    event_id: order.eventId,
    status: order.status,
    amount_cents: order.amountCents,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
