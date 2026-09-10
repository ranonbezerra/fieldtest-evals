import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amount: Prisma.Decimal;
  currency: string;
  lastEventAt: Date;
}

export interface OperationQuery {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard page: a single indexed read on the projection.
   * Served by (company_id, [status,] last_event_at DESC); id is the
   * deterministic tiebreaker so pagination is stable.
   */
  async findPage(query: OperationQuery): Promise<{ items: Operation[]; total: number }> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.companyId,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            lastEventAt: {
              ...(query.from !== undefined ? { gte: query.from } : {}),
              ...(query.to !== undefined ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const items = await this.prisma.operation.findMany({
      where,
      orderBy: [{ lastEventAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const total = await this.prisma.operation.count({ where });
    return { items, total };
  }

  /** Maintenance hook / re-derivation: upsert the read-model row for an order. */
  async upsertOperation(tx: Prisma.TransactionClient, row: OperationRow): Promise<void> {
    await tx.operation.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        lastEventAt: row.lastEventAt,
      },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        lastEventAt: row.lastEventAt,
      },
    });
  }

  /**
   * Maintenance hook: move the row's recency forward when an event is recorded.
   * Never moves it backwards, so backfilled events stay deterministic.
   */
  async touchLastEvent(tx: Prisma.TransactionClient, orderId: string, occurredAt: Date): Promise<void> {
    const current = await tx.operation.findUnique({ where: { id: orderId }, select: { lastEventAt: true } });
    if (!current) {
      // No projection row yet (e.g. a pre-hook write); the next write or the
      // drift-repair re-derivation will create it from the source of truth.
      return;
    }
    if (occurredAt.getTime() > current.lastEventAt.getTime()) {
      await tx.operation.update({ where: { id: orderId }, data: { lastEventAt: occurredAt } });
    }
  }
}
