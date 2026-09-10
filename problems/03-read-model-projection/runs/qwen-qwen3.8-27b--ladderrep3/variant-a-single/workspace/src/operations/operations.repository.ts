import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationReadModel[];
  total: number;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The dashboard hot path: one table, one covering index
   * (company_id, status, created_at DESC, payment_order_id DESC) with
   * INCLUDE columns, so a page is an index-only scan. No join back to the
   * source tables.
   */
  async findPage(params: OperationListParams): Promise<OperationPage> {
    const where = {
      companyId: params.companyId,
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.from !== undefined || params.to !== undefined
        ? {
            createdAt: {
              ...(params.from !== undefined ? { gte: params.from } : {}),
              ...(params.to !== undefined ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { paymentOrderId: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total };
  }
}
