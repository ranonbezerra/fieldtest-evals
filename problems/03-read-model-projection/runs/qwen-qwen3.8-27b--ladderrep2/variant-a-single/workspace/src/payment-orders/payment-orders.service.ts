import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

// ASSUMPTION: the simulated write path is create plus these transitions;
// refund is only valid from approved.
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;

export interface CreatePaymentOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<Order> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, {
          workerId: input.workerId,
        });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous projection maintenance hook: runs inside this very
      // transaction, so the read model is updated at the same instant as the
      // source row, and a rolled-back create leaves no projection trace.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: string): Promise<string> {
    return this.transition('approve', orderId);
  }

  reject(orderId: string): Promise<string> {
    return this.transition('reject', orderId);
  }

  refund(orderId: string): Promise<string> {
    return this.transition('refund', orderId);
  }

  private transition(action: OrderAction, orderId: string): Promise<string> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from },
        );
      }
      // transitionInTransaction re-checks the status under the row lock, so a
      // concurrent transition on the same order wins or loses atomically.
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // Synchronous projection maintenance hook, in the same transaction as
        // the source write: order row, event, projection row and totals all
        // commit together.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
}
