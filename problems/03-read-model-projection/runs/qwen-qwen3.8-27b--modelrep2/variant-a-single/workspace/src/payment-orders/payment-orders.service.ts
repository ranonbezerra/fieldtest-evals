import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isForeignKeyError } from '../common/prisma-errors.js';
import { FinancialTotalsRepository } from '../financial-totals/financial-totals.repository.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { OrderEventsRepository } from '../order-events/order-events.repository.js';
import {
  CreatePaymentOrderInput,
  PaymentOrderWithWorker,
  PaymentOrdersRepository,
} from './payment-orders.repository.js';

export interface PaymentOrderDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

/**
 * Simulated write path for payment orders. The order write and the read-model
 * maintenance hooks commit in ONE transaction, so operators see their own
 * writes on the very next request.
 */
@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly orders: PaymentOrdersRepository,
    private readonly events: OrderEventsRepository,
    private readonly operations: OperationsRepository,
    private readonly totals: FinancialTotalsRepository,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrderDto> {
    return this.orders.withTransaction(async (tx) => {
      let order: PaymentOrderWithWorker;
      try {
        order = await this.orders.createInTx(tx, input);
      } catch (error) {
        if (isForeignKeyError(error)) {
          throw new ApiError('resource_not_found', `Worker ${input.workerId} was not found.`, 404, {
            worker_id: input.workerId,
          });
        }
        throw error;
      }
      if (order.workerCompanyId !== input.companyId) {
        throw new ApiError('validation_failed', 'Worker belongs to a different company than the order.', 400, {
          company_id: input.companyId,
          worker_id: input.workerId,
        });
      }
      // Maintenance hooks: projection row + exact totals, same transaction as the write.
      await this.operations.upsertOperation(tx, {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        lastEventAt: order.createdAt,
      });
      await this.totals.applyStatusTransition(tx, {
        companyId: order.companyId,
        fromStatus: null,
        toStatus: order.status,
        amount: order.amount,
      });
      return toDto(order);
    });
  }

  changeStatus(id: string, toStatus: OrderStatus): Promise<PaymentOrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const { order, previousStatus } = await this.orders.changeStatusInTx(tx, id, toStatus);
      if (previousStatus === null) return toDto(order); // idempotent no-op, hooks skipped
      const now = new Date();
      // Record the transition as an event: it is the order's new activity and
      // makes the re-derivation window able to reach this order later.
      await this.events.createInTx(tx, { orderId: id, type: `status:${toStatus}`, occurredAt: now });
      // Maintenance hooks: projection row + exact totals, same transaction as the write.
      await this.operations.upsertOperation(tx, {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        lastEventAt: now,
      });
      await this.totals.applyStatusTransition(tx, {
        companyId: order.companyId,
        fromStatus: previousStatus,
        toStatus,
        amount: order.amount,
      });
      return toDto(order);
    });
  }
}

function toDto(order: PaymentOrderWithWorker): PaymentOrderDto {
  return {
    id: order.id,
    company_id: order.companyId,
    worker_id: order.workerId,
    worker_name: order.workerName,
    status: order.status,
    amount: order.amount.toFixed(4),
    currency: order.currency,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
