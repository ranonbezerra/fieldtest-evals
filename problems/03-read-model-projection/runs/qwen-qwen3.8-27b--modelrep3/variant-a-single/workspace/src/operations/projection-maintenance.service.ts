import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderWithRefs } from './order-writes.repository.js';
import type { OrderStatus } from './order-status.js';
import {
  ProjectionMaintenanceRepository,
  type OperationRowData,
} from './projection-maintenance.repository.js';

const ZERO = new Prisma.Decimal(0);

/**
 * Synchronous maintenance hooks for the operations read model.
 *
 * The write services invoke these inside the very transaction that performs the
 * source write, which is the read-your-own-writes guarantee: the projection row
 * and the company total commit in the same instant as the order change.
 *
 * Only Prisma.Decimal (the decimal.js wrapper) is used here for amount math —
 * no Prisma client instance ever touches this service.
 */
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: ProjectionMaintenanceRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, order: OrderWithRefs): Promise<void> {
    await this.repo.upsertOperationRow(tx, this.rowFrom(order));
    await this.repo.adjustCompanyTotal(tx, {
      companyId: order.companyId,
      operationCount: 1,
      totalAmount: order.amount,
      approvedAmount: order.status === 'approved' ? order.amount : ZERO,
    });
  }

  async onOrderStatusChanged(
    tx: Prisma.TransactionClient,
    order: OrderWithRefs,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<void> {
    await this.repo.upsertOperationRow(tx, this.rowFrom(order));
    await this.repo.adjustCompanyTotal(tx, {
      companyId: order.companyId,
      operationCount: 0,
      totalAmount: ZERO,
      approvedAmount: this.approvedDelta(from, to, order.amount),
    });
  }

  async onEventRenamed(tx: Prisma.TransactionClient, eventId: number, name: string): Promise<void> {
    await this.repo.renameEventOnReadModels(tx, eventId, name);
  }

  async onWorkerRenamed(tx: Prisma.TransactionClient, workerId: number, name: string): Promise<void> {
    await this.repo.renameWorkerOnReadModels(tx, workerId, name);
  }

  private approvedDelta(from: OrderStatus, to: OrderStatus, amount: Prisma.Decimal): Prisma.Decimal {
    if (to === 'approved' && from !== 'approved') return amount;
    if (from === 'approved' && to !== 'approved') return new Prisma.Decimal(amount).neg();
    return ZERO;
  }

  private rowFrom(order: OrderWithRefs): OperationRowData {
    return {
      orderId: order.id,
      companyId: order.companyId,
      status: order.status,
      amount: order.amount,
      eventId: order.eventId,
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
      workerId: order.workerId,
      workerName: order.worker.name,
      createdAt: order.createdAt,
    };
  }
}
