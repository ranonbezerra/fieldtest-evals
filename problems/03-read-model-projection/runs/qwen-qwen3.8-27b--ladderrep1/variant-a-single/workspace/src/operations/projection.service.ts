import { Injectable } from '@nestjs/common';
import { Event, OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ProjectionRepository } from './projection.repository.js';

type Tx = Prisma.TransactionClient;

export type OrderChange = Pick<
  PaymentOrder,
  'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type EventChange = Pick<Event, 'id' | 'paymentOrderId' | 'eventType' | 'occurredAt'>;

/**
 * Read-model maintenance hooks.
 *
 * Write services call these inside the writer's own transaction, which gives both
 * hard guarantees at once:
 *  - read-your-own-writes: the projection sees the writer's snapshot, so the very
 *    next read (same or another connection) observes the change, with no delay;
 *  - rollback safety: if the write rolls back, the projection never saw it.
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly projection: ProjectionRepository) {}

  async applyOrderChange(tx: Tx, order: OrderChange): Promise<void> {
    const previous = await this.projection.findOperationRow(tx, order.id);

    await this.projection.upsertOperationRow(tx, {
      paymentOrderId: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      status: order.status,
      amountCents: order.amountCents,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });

    if (previous) {
      if (previous.status !== order.status) {
        await this.projection.applyTotalsDelta(tx, {
          companyId: order.companyId,
          fromStatus: previous.status,
          toStatus: order.status,
          amountCents: order.amountCents,
        });
      }
      // Status unchanged (e.g. worker reassignment): row re-synced, totals untouched.
    } else {
      // New order: add to its current bucket; there is nothing to move from.
      await this.projection.applyTotalsDelta(tx, {
        companyId: order.companyId,
        fromStatus: null,
        toStatus: order.status,
        amountCents: order.amountCents,
      });
    }
  }

  async applyEvent(tx: Tx, event: EventChange): Promise<void> {
    await this.projection.applyLatestEvent(tx, {
      id: event.id,
      paymentOrderId: event.paymentOrderId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    });
  }
}
