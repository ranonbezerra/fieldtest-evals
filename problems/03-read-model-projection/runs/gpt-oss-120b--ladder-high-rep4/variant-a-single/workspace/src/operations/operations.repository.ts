import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma, OperationProjection } from '@prisma/client';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: {
    where?: Prisma.OperationProjectionWhereInput;
    orderBy?: Prisma.OperationProjectionOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<OperationProjection[]> {
    return this.prisma.operationProjection.findMany(params);
  }

  async count(params: {
    where?: Prisma.OperationProjectionWhereInput;
  }): Promise<number> {
    return this.prisma.operationProjection.count(params);
  }

  async upsertProjection(data: Prisma.OperationProjectionCreateInput) {
    return this.prisma.operationProjection.upsert({
      where: { orderId: data.orderId },
      create: data,
      update: data,
    });
  }

  async deleteManyByEventTimestampRange(start: Date, end: Date) {
    return this.prisma.operationProjection.deleteMany({
      where: {
        eventTimestamp: {
          gte: start,
          lte: end,
        },
      },
    });
  }
}
