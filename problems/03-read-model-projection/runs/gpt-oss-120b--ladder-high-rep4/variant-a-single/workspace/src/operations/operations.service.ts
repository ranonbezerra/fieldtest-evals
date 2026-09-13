import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';
import { PrismaService } from '../prisma.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { Prisma, OrderStatus } from '@prisma/client';

export interface OperationFilters {
  companyId?: number;
  status?: OrderStatus;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly opsRepo: OperationsRepository,
    private readonly totalsRepo: CompanyTotalsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getOperations(filters: OperationFilters) {
    const { page, pageSize } = filters;
    const skip = (page - 1) * pageSize;
    const where: Prisma.OperationProjectionWhereInput = {
      ...(filters.companyId !== undefined && { companyId: filters.companyId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.startDate && filters.endDate && {
        eventTimestamp: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.opsRepo.findMany({
        where,
        orderBy: { eventTimestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.opsRepo.count({ where }),
    ]);

    return {
      total,
      page,
      pageSize,
      items,
    };
  }

  async rederiveWindow(startDate: Date, endDate: Date) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.operationProjection.deleteMany({
        where: {
          eventTimestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      const orders = await tx.paymentOrder.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          events: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          worker: true,
        },
      });

      for (const order of orders) {
        const latestEvent = order.events[0];
        await tx.operationProjection.create({
          data: {
            orderId: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            status: order.status,
            amount: order.amount,
            eventTimestamp: latestEvent ? latestEvent.timestamp : order.createdAt,
          },
        });
      }
    });
  }

  async repairDrift(windowHours = 1) {
    const now = new Date();
    const start = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

    const sourceRows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: start,
        },
      },
      include: {
        events: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        worker: true,
      },
    });

    for (const order of sourceRows) {
      const latestEvent = order.events[0];
      const projected = await this.prisma.operationProjection.findUnique({
        where: { orderId: order.id },
      });

      const desired = {
        orderId: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        status: order.status,
        amount: order.amount,
        eventTimestamp: latestEvent ? latestEvent.timestamp : order.createdAt,
      };

      if (!projected) {
        await this.prisma.operationProjection.create({ data: desired });
        continue;
      }

      const dirty =
        projected.companyId !== desired.companyId ||
        projected.workerId !== desired.workerId ||
        projected.status !== desired.status ||
        projected.amount !== desired.amount ||
        projected.eventTimestamp.getTime() !== desired.eventTimestamp.getTime();

      if (dirty) {
        await this.prisma.operationProjection.update({
          where: { orderId: order.id },
          data: desired,
        });
      }
    }
  }
}
