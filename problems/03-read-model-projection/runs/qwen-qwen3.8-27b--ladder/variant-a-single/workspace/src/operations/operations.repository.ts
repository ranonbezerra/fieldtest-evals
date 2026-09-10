import { Inject, Injectable } from '@nestjs/common';
import { CompanyTotal, OrderStatus, OpsRow, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OperationsFilter {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
}

/**
 * Read side of the operations dashboard. Every query here touches the
 * projection tables only (ops_rows, company_totals) - never the source.
 */
@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  private filterOf(f: OperationsFilter): Prisma.OpsRowWhereInput {
    const where: Prisma.OpsRowWhereInput = { companyId: f.companyId };
    if (f.status) where.status = f.status;
    if (f.from || f.to) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (f.from) occurredAt.gte = f.from;
      if (f.to) occurredAt.lt = f.to;
      where.occurredAt = occurredAt;
    }
    return where;
  }

  listRows(f: OperationsFilter, page: number, pageSize: number): Promise<OpsRow[]> {
    return this.db.opsRow.findMany({
      where: this.filterOf(f),
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  countRows(f: OperationsFilter): Promise<number> {
    return this.db.opsRow.count({ where: this.filterOf(f) });
  }

  getCompanyTotal(companyId: string): Promise<CompanyTotal | null> {
    return this.db.companyTotal.findUnique({ where: { companyId } });
  }
}
