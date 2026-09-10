import { Injectable } from '@nestjs/common';
import type { Order, Prisma, Worker } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  workerInTransaction(tx: Prisma.TransactionClient, workerId: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id: workerId } });
  }

  insertOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string; amountCents: number },
  ): Promise<Order> {
    return tx.order.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        status: 'pending',
        amount: data.amountCents / 100,
      },
    });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: string, type: string): Promise<void> {
    return tx.event.create({ data: { orderId, type } }).then(() => undefined);
  }

  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  transitionInTransaction(
    orderId: string,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status },
        );
      }
      await work(tx);
      return orderId;
    });
  }
}
