import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationsQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationReadInput {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  lastEventType: string | null;
  lastEventAt: Date | null;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The new dashboard query: a single range scan on operation_reads. The
   * index (company_id, status, created_at DESC, id DESC) matches the filters
   * and the sort order exactly, so there is no join, no aggregation and no
   * sort step.
   */
  list(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<OperationRead[]> {
    const client = tx ?? this.prisma;
    return client.operationRead.findMany({
      where: this.where(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  count(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<number> {
    return (tx ?? this.prisma).operationRead.count({ where: this.where(query) });
  }

  /**
   * Idempotent row write shared by the sync hooks and the re-derivation:
   * both write the source's value, so whichever runs last converges.
   */
  upsert(tx: Prisma.TransactionClient | undefined, read: OperationReadInput): Promise<OperationRead> {
    const data = {
      companyId: read.companyId,
      workerId: read.workerId,
      workerName: read.workerName,
      status: read.status,
      amountCents: read.amountCents,
      createdAt: read.createdAt,
      lastEventType: read.lastEventType,
      lastEventAt: read.lastEventAt,
    };
    return (tx ?? this.prisma).operationRead.upsert({
      where: { id: read.id },
      create: { id: read.id, ...data },
      update: data,
    });
  }

  setStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<OperationRead> {
    return (tx ?? this.prisma).operationRead.update({ where: { id }, data: { status } });
  }

  /**
   * Sets the latest event only if it is newer than the current one, so
   * out-of-order event recording cannot move the pointer backwards.
   */
  setLatestEventIfNewer(
    tx: Prisma.TransactionClient | undefined,
    id: string,
    type: string,
    occurredAt: Date,
  ): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { id, OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurredAt } }] },
      data: { lastEventType: type, lastEventAt: occurredAt },
    });
  }

  renameWorker(tx: Prisma.TransactionClient | undefined, workerId: string, workerName: string): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { workerId },
      data: { workerName },
    });
  }

  /** Exact per-status aggregate over the projection, used to recompute totals. */
  sumByStatus(tx: Prisma.TransactionClient | undefined, companyId: string) {
    return (tx ?? this.prisma).operationRead.groupBy({
      by: ['status'],
      where: { companyId },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  }

  private where(query: OperationsQuery): Prisma.OperationReadWhereInput {
    return {
      ...(query.companyId !== undefined && { companyId: query.companyId }),
      ...(query.status !== undefined && { status: query.status }),
      ...((query.from !== undefined || query.to !== undefined) && {
        createdAt: {
          ...(query.from !== undefined && { gte: query.from }),
          ...(query.to !== undefined && { lt: query.to }),
        },
      }),
    };
  }
}
