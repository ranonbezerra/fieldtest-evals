import { Injectable } from '@nestjs/common';
import type { PaymentOrder } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { OrderRepository, OrderStatus } from './orders.repository.js';

export interface OrderDto {
  id: string;
  companyId: string;
  workerId: string;
  status: OrderStatus;
  amountCents: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OrderService {
  constructor(private readonly orders: OrderRepository) {}

  /** Creates a pending order; the projection rows land in the same transaction. */
  createOrder(input: { companyId: string; workerId: string; amountCents: bigint }): Promise<OrderDto> {
    return this.orders.findCompany(input.companyId).then(async (company) => {
      if (!company) {
        throw new AppError(404, 'resource_not_found', `Company ${input.companyId} was not found.`, {
          companyId: input.companyId,
        });
      }
      const worker = await this.orders.findWorker(input.workerId);
      if (!worker || worker.companyId !== input.companyId) {
        throw new AppError(404, 'resource_not_found', `Worker ${input.workerId} was not found in company ${input.companyId}.`, {
          workerId: input.workerId,
          companyId: input.companyId,
        });
      }
      const order = await this.orders.createOrder(input);
      return this.toDto(order);
    });
  }

  getOrder(id: string): Promise<OrderDto> {
    return this.orders.findOrder(id).then((order) => {
      if (!order) {
        throw new AppError(404, 'resource_not_found', `Order ${id} was not found.`, { orderId: id });
      }
      return this.toDto(order);
    });
  }

  approveOrder(id: string): Promise<OrderDto> {
    return this.transition(id, 'approved');
  }

  rejectOrder(id: string): Promise<OrderDto> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, newStatus: Exclude<OrderStatus, 'pending'>): Promise<OrderDto> {
    return this.orders.findOrder(id).then(async (order) => {
      if (!order) {
        throw new AppError(404, 'resource_not_found', `Order ${id} was not found.`, { orderId: id });
      }
      if (order.status !== 'pending') {
        throw new AppError(409, 'invalid_state', `Order ${id} is ${order.status}; only pending orders can be ${newStatus}.`, {
          orderId: id,
          currentStatus: order.status,
        });
      }
      const updated = await this.orders.transitionOrder(id, 'pending', newStatus);
      if (!updated) {
        throw new AppError(409, 'invalid_state', `Order ${id} changed state while the ${newStatus} was in flight. Retry.`, {
          orderId: id,
        });
      }
      return this.toDto(updated);
    });
  }

  private toDto(order: PaymentOrder): OrderDto {
    return {
      id: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      status: order.status as OrderStatus,
      amountCents: order.amount.toString(),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
