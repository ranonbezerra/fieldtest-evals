import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import {
  OrderWritesRepository,
  type CreateOrderData,
} from './order-writes.repository.js';
import { ProjectionMaintenanceService } from './projection-maintenance.service.js';
import { canTransition, type OrderStatus } from './order-status.js';

export interface CreateOrderInput {
  companyId: number;
  eventId: number;
  workerId: number;
  amount: string;
  status?: OrderStatus;
}

@Injectable()
export class OrderWritesService {
  constructor(
    private readonly writes: OrderWritesRepository,
    private readonly maintenance: ProjectionMaintenanceService,
  ) {}

  // Simulated marketplace write path.
  //
  // Invariant: the source write and the projection-maintenance hook run in the
  // SAME database transaction (opened by the repository via withTransaction).
  // That is what makes read-your-own-writes hold: the dashboard row and the
  // company total become visible in the same instant as the order change.
  // The service never touches the Prisma client itself; the transaction client
  // only appears here as a type.

  createOrder(input: CreateOrderInput) {
    return this.writes.withTransaction(async (tx) => {
      await this.ensureReferences(tx, input);
      const data: CreateOrderData = {
        companyId: input.companyId,
        eventId: input.eventId,
        workerId: input.workerId,
        amount: input.amount,
        status: input.status ?? 'pending',
      };
      const order = await this.writes.createOrder(tx, data);
      await this.maintenance.onOrderCreated(tx, order);
      return order;
    });
  }

  transitionStatus(orderId: number, to: OrderStatus) {
    return this.writes.withTransaction(async (tx) => {
      const existing = await this.writes.findOrderWithRefs(tx, orderId);
      if (!existing) {
        throw new ApiError('resource_not_found', `order ${orderId} was not found`, { orderId }, 404);
      }
      const from = existing.status as OrderStatus;
      if (!canTransition(from, to)) {
        throw new ApiError(
          'invalid_status_transition',
          `order ${orderId} cannot move from "${from}" to "${to}"`,
          { orderId, from, to },
          409,
        );
      }
      const updated = await this.writes.updateOrderStatus(tx, orderId, to);
      await this.maintenance.onOrderStatusChanged(tx, updated, from, to);
      return updated;
    });
  }

  renameEvent(eventId: number, name: string) {
    return this.writes.withTransaction(async (tx) => {
      const event = await this.writes.findEvent(tx, eventId);
      if (!event) {
        throw new ApiError('resource_not_found', `event ${eventId} was not found`, { eventId }, 404);
      }
      const updated = await this.writes.updateEventName(tx, eventId, name);
      await this.maintenance.onEventRenamed(tx, eventId, name);
      return updated;
    });
  }

  renameWorker(workerId: number, name: string) {
    return this.writes.withTransaction(async (tx) => {
      const worker = await this.writes.findWorker(tx, workerId);
      if (!worker) {
        throw new ApiError('resource_not_found', `worker ${workerId} was not found`, { workerId }, 404);
      }
      const updated = await this.writes.updateWorkerName(tx, workerId, name);
      await this.maintenance.onWorkerRenamed(tx, workerId, name);
      return updated;
    });
  }

  private async ensureReferences(tx: Prisma.TransactionClient, input: CreateOrderInput): Promise<void> {
    const company = await this.writes.findCompany(tx, input.companyId);
    if (!company) {
      throw new ApiError('resource_not_found', `company ${input.companyId} was not found`, { field: 'companyId' }, 404);
    }
    const event = await this.writes.findEvent(tx, input.eventId);
    if (!event) {
      throw new ApiError('resource_not_found', `event ${input.eventId} was not found`, { field: 'eventId' }, 404);
    }
    const worker = await this.writes.findWorker(tx, input.workerId);
    if (!worker) {
      throw new ApiError('resource_not_found', `worker ${input.workerId} was not found`, { field: 'workerId' }, 404);
    }
  }
}
