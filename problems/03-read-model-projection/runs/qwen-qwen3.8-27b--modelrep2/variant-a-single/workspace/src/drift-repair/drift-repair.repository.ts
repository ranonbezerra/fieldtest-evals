import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SourceTotalRow {
  companyId: string;
  status: OrderStatus;
  orderCount: number;
  totalAmount: Prisma.Decimal;
}

@Injectable()
export class DriftRepairRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 120_000, maxWait: 10_000 });
  }

  /**
   * Source of truth for a window: every order created in [from, to), or with an
   * event occurring in [from, to), with its worker name and all event times.
   */
  async sourceOrdersInWindow(tx: Prisma.TransactionClient, from: Date, to: Date) {
    return tx.paymentOrder.findMany({
      where: {
        OR: [
          { createdAt: { gte: from, lt: to } },
          { events: { some: { occurredAt: { gte: from, lt: to } } } },
        ],
      },
      include: {
        worker: { select: { name: true } },
        events: { select: { occurredAt: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Exact per (company, status) aggregates straight from the source orders. */
  async sourceTotalsByCompany(tx: Prisma.TransactionClient, companyIds: string[]): Promise<SourceTotalRow[]> {
    if (companyIds.length === 0) return [];
    const groups = await tx.paymentOrder.groupBy({
      by: ['companyId', 'status'],
      where: { companyId: { in: companyIds } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    return groups.map(group => ({
      companyId: group.companyId,
      status: group.status,
      orderCount: group._count._all,
      totalAmount: group._sum.amount ?? new Prisma.Decimal(0),
    }));
  }

  async projectionOperations(tx: Prisma.TransactionClient, orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return tx.operation.findMany({ where: { id: { in: orderIds } } });
  }

  async projectionTotals(tx: Prisma.TransactionClient, companyIds: string[]) {
    if (companyIds.length === 0) return [];
    return tx.companyFinancialTotal.findMany({ where: { companyId: { in: companyIds } } });
  }
}
