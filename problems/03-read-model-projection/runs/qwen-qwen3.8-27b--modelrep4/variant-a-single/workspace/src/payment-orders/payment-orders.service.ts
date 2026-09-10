import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentOrderRepository, type PaymentOrderDto } from './payment-orders.repository.js';
import { ApiError } from '../common/api-error.js';
import { isOrderStatus, type OrderStatus } from '../common/order-status.js';

// ASSUMPTION: the marketplace order lifecycle for the simulated write path is
// pending -> approved -> completed, with rejection/cancellation possible from
// pending (and cancellation from approved); terminal states have no exits.
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

@Injectable()
export class PaymentOrderService {
  constructor(private readonly orders: PaymentOrderRepository) {}

  /**
   * Write path: persists the order and, in the same transaction, fires the
   * read-model maintenance hooks (operation view + company totals).
   */
  create(input: {
    companyId: string;
    workerId: string | null;
    eventId: string | null;
    amountCents: number;
    currency: string;
  }): Promise<PaymentOrderDto> {
    return this.orders.create({ id: randomUUID(), ...input });
  }

  /**
   * Write path: applies a status transition and the read-model maintenance
   * hooks atomically, so the next dashboard request already reflects it.
   */
  async changeStatus(id: string, target: string): Promise<PaymentOrderDto> {
    if (!isOrderStatus(target)) {
      throw new ApiError(400, 'validation_error', `unknown status "${target}"`, { field: 'status' });
    }
    const order = await this.orders.findById(id);
    if (order === null) {
      throw new ApiError(404, 'resource_not_found', `payment order ${id} not found`, { id });
    }
    const current = order.status as OrderStatus;
    const transitions = TRANSITIONS[current] ?? [];
    if (!transitions.includes(target)) {
      throw new ApiError(409, 'invalid_transition', `a payment order cannot move from "${current}" to "${target}"`, {
        id,
        from: current,
        to: target,
      });
    }
    return this.orders.applyStatusChange(id, current, target);
  }
}
