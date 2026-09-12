import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OperationProjection } from '@prisma/client';

interface FindFilters {
  companyId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperations(filters: FindFilters): Promise<OperationProjection[]> {
    const where: any = {};

    if (filters.companyId !== undefined) {
      where.company_id = filters.companyId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.startDate !== undefined) {
      where.created_at = { gte: filters.startDate };
    }
    if (filters.endDate !== undefined) {
      where.created_at = where.created_at ?? {};
      where.created_at.lte = filters.endDate;
    }

    return this.prisma.operationProjection.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: filters.skip,
      take: filters.take,
    });
  }

  async countOperations(filters: FindFilters): Promise<number> {
    const where: any = {};

    if (filters.companyId !== undefined) {
      where.company_id = filters.companyId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }
    if (filters.startDate !== undefined) {
      where.created_at = { gte: filters.startDate };
    }
    if (filters.endDate !== undefined) {
      where.created_at = where.created_at ?? {};
      where.created_at.lte = filters.endDate;
    }

    return this.prisma.operationProjection.count({ where });
  }
}
