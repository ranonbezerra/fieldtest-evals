import { Injectable } from '@nestjs/common';
import type { OperationsReadModel, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import type { OrderStatus } from '../orders/orders.repository.js';

export interface OperationsListFilter {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The dashboard query: reads the projection only — never joins back to the
   * source tables, so the hot path is a single index-only scan on
   * (company_id, created_at DESC, id DESC).
   *
   * ASSUMPTION: the date range is half-open [from, to); the original query's
   * range semantics were not specified.
   */
  list(filter: OperationsListFilter): Promise<OperationsReadModel[]> {
    const where: Prisma.OperationsReadModelWhereInput = {
      companyId: filter.companyId,
      ...(filter.status ? { status: filter.status } : {}),
    };
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lt: filter.to } : {}),
      };
    }
    return this.prisma.operationsReadModel.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.skip,
      take: filter.take,
    });
  }
}
