import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../common/domain-exception.js';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

export type OrderWithRelations = Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>;

export interface NewPaymentOrder {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Runs `work` in one interactive transaction (default READ COMMITTED). */
  withTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  createInTx(tx: DbClient, data: NewPaymentOrder): Promise<OrderWithRelations> {
    return tx.paymentOrder.create({ data, include: { worker: true, event: true } });
  }

  /**
   * pending -> `to`, guarded in the UPDATE itself (WHERE status = 'pending')
   * so two concurrent transitions of the same order cannot both win: the
   * second one re-evaluates the predicate after the first commits and finds
   * nothing to update.
   */
  async transitionInTx(tx: DbClient, id: string, to: 'approved' | 'rejected'): Promise<OrderWithRelations> {
    const updated = await tx.paymentOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: to, updatedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await tx.paymentOrder.findUnique({ where: { id } });
      if (!current) {
        throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
      }
      throw new DomainException(
        409,
        'invalid_state_transition',
        `payment order ${id} is ${current.status}; only pending orders can be ${to}`,
        { id, from: current.status, requested: to },
      );
    }
    const order = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
    if (!order) {
      throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
    }
    return order;
  }
}
