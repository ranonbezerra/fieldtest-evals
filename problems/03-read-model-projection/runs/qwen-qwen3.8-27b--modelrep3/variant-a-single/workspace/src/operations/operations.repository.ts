import { Injectable } from '@nestjs/common';
import type { Company, CompanyOperationTotal, OperationReadModel, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface ListOperationsParams {
  companyId: number;
  status?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCompany(id: number): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  findCompanyTotal(companyId: number): Promise<CompanyOperationTotal | null> {
    return this.prisma.companyOperationTotal.findUnique({ where: { companyId } });
  }

  // Served entirely by the operation_read_models projection: one indexed scan
  // (company_id[, status], created_at DESC, order_id DESC) plus one index-range
  // count. No joins, no sort step, no aggregation.
  async listOperations(params: ListOperationsParams): Promise<{ items: OperationReadModel[]; total: number }> {
    const where: Prisma.OperationReadModelWhereInput = { companyId: params.companyId };
    if (params.status) {
      where.status = params.status;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (params.from) createdAt.gte = params.from;
    if (params.to) createdAt.lt = params.to;
    if (createdAt.gte !== undefined || createdAt.lt !== undefined) {
      where.createdAt = createdAt;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { orderId: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total };
  }
}
