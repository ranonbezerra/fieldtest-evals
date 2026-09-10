import { Injectable } from '@nestjs/common';
import { Company, CompanyFinancialTotals, OperationRow, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OperationQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async company(id: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  async getTotals(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }

  /**
   * The dashboard read path: touches operation_rows only — no join back to the
   * source tables. Filter on (company, status), ordered by (updated_at DESC, id DESC)
   * to match the covering index, offset-paginated.
   */
  listOperations(query: OperationQuery): Promise<OperationRow[]> {
    return this.prisma.operationRow.findMany({
      where: this.whereFor(query),
      orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
  }

  countOperations(query: OperationQuery): Promise<number> {
    return this.prisma.operationRow.count({ where: this.whereFor(query) });
  }

  private whereFor(query: OperationQuery): Prisma.OperationRowWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = query.from;
    if (query.to) createdAt.lt = query.to;
    return {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };
  }
}
