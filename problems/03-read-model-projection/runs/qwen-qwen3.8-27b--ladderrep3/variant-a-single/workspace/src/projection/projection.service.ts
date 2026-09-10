import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';
import type { OrderWithRelations } from '../payment-orders/payment-orders.repository.js';
import { ProjectionRepository, type OperationRowData } from './projection.repository.js';

/**
 * Maintenance hooks for the read model. Every hook is called by a write
 * service INSIDE the writer's transaction: the source row and the projection
 * commit or roll back together, so there is no window in which an operator's
 * own write is missing from the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repository: ProjectionRepository) {}

  async applyOrderCreated(tx: DbClient, order: OrderWithRelations): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    await this.repository.applyTotalsDelta(tx, order.companyId, {
      pending: order.amountCents,
      approved: 0,
      rejected: 0,
      ordersCount: 1,
    });
  }

  async applyOrderStatusChanged(tx: DbClient, order: OrderWithRelations, from: OrderStatus): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    if (from === order.status) return;
    const delta = { pending: 0, approved: 0, rejected: 0, ordersCount: 0 };
    delta[from] -= order.amountCents;
    delta[order.status] += order.amountCents;
    await this.repository.applyTotalsDelta(tx, order.companyId, delta);
  }
}

function toRow(order: OrderWithRelations): OperationRowData {
  return {
    paymentOrderId: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    workerName: order.worker.fullName,
    eventId: order.eventId,
    eventName: order.event.name,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
