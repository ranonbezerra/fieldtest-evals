import { Injectable } from '@nestjs/common';
import type { PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface RederiveCursor {
  createdAt: Date;
  id: string;
}

/**
 * Source-table reads used only by the re-derivation. Repositories are the
 * only layer that touches the database, so the projection's source reads
 * live here rather than in the source features' repositories.
 */
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orders created in [from, to), keyset-paginated so an arbitrarily large
   * window can be walked without OFFSET over millions of rows.
   */
  findOrdersInWindow(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
    cursor: RederiveCursor | null,
    limit: number,
  ): Promise<PaymentOrder[]> {
    return tx.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  findWorkerNames(tx: Prisma.TransactionClient, workerIds: string[]): Promise<Map<string, string>> {
    return tx.worker
      .findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } })
      .then((rows) => new Map(rows.map((w): [string, string] => [w.id, w.name])));
  }

  findWorkerName(tx: Prisma.TransactionClient, workerId: string): Promise<string | null> {
    return tx.worker
      .findUnique({ where: { id: workerId }, select: { name: true } })
      .then((w) => (w === null ? null : w.name));
  }

  /** Latest event per order; ascending order means the last write wins. */
  findLatestEventPerOrder(
    tx: Prisma.TransactionClient,
    orderIds: string[],
  ): Promise<Map<string, { type: string; occurredAt: Date }>> {
    return tx.event
      .findMany({
        where: { orderId: { in: orderIds } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { orderId: true, type: true, occurredAt: true },
      })
      .then((rows) => {
        const latest = new Map<string, { type: string; occurredAt: Date }>();
        for (const row of rows) latest.set(row.orderId, row);
        return latest;
      });
  }
}
