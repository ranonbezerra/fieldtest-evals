import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperations(
    where: Prisma.OperationDashboardWhereInput,
    orderBy: Prisma.OperationDashboardOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.operationDashboard.findMany({
      where,
      orderBy,
      skip,
      take,
    });
  }
}
