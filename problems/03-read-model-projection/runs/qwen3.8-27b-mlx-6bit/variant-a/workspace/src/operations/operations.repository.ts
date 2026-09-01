import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPage(params: OperationQueryParams): Promise<OperationPage> {
    const { companyId, status, from, to, page, pageSize } = params;

    const where: Prisma.OperationReadModelWhereInput = {
      companyId,
      ...(status !== undefined && { status }),
      ...((from !== undefined || to !== undefined) && {
        createdAt: {
          ...(from !== undefined && { gte: from }),
          ...(to !== undefined && { lt: to }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
