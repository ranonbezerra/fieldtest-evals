# 04-operation-read-model.repository.ts-retry

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

import {
  OperationReadModel,
  OperationUpsertInput,
  OperationsQueryInput,
  OperationsPage,
  CompanyTotals,
  DateWindow,
} from './operation-read-model.types';

@Injectable()
export class OperationReadModelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: OperationUpsertInput): Promise<void> {
    await this.prisma.operationReadModel.upsert({
      where: { orderId: input.orderId },
      update: {
        companyId: input.companyId,
        workerId: input.workerId,
        eventId: input.eventId,
        status: input.status,
        amountCents: input.amountCents,
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
      create: {
        orderId: input.orderId,
        companyId: input.companyId,
        workerId: input.workerId,
        eventId: input.eventId,
        status: input.status,
        amountCents: input.amountCents,
        currency: input.currency,
        occurredAt: input.occurredAt,
      },
    });
  }

  async remove(orderId: bigint): Promise<void> {
    await this.prisma.operationReadModel.deleteMany({
      where: { orderId },
    });
  }

  async findPage(query: OperationsQueryInput): Promise<OperationsPage> {
    const where: Prisma.OperationReadModelWhereInput = {
      companyId: query.companyId,
    };

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.fromDate !== undefined || query.toDate !== undefined) {
      where.occurredAt = {};
      if (query.fromDate !== undefined) {
        where.occurredAt.gte = query.fromDate;
      }
      if (query.toDate !== undefined) {
        where.occurredAt.lt = query.toDate;
      }
    }

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [
          { occurredAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / query.pageSize);

    return {
      items: items.map((row) => this.toReadModel(row)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages,
    };
  }

  async totalsForCompany(companyId: bigint): Promise<CompanyTotals> {
    const [aggregate] = await this.prisma.operationReadModel.aggregate({
      where: { companyId },
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    return {
      companyId,
      totalAmountCents: aggregate._sum.amountCents ?? 0n,
      orderCount: aggregate._count._all,
    };
  }

  async rederiveWindow(window: DateWindow): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.operationReadModel.deleteMany({
        where: {
          occurredAt: {
            gte: window.from,
            lt: window.to,
          },
        },
      });

      const sourceOrders = await tx.paymentOrder.findMany({
        where: {
          occurredAt: {
            gte: window.from,
            lt: window.to,
          },
        },
        select: {
          orderId: true,
          companyId: true,
          workerId: true,
          eventId: true,
          status: true,
          amountCents: true,
          currency: true,
          occurredAt: true,
        },
      });

      if (sourceOrders.length === 0) {
        return 0;
      }

      const result = await tx.operationReadModel.createMany({
        data: sourceOrders.map((order) => ({
          orderId: order.orderId,
          companyId: order.companyId,
          workerId: order.workerId,
          eventId: order.eventId,
          status: order.status,
          amountCents: order.amountCents,
          currency: order.currency,
          occurredAt: order.occurredAt,
        })),
      });

      return result.count;
    });
  }

  async deleteInWindow(window: DateWindow): Promise<void> {
    await this.prisma.operationReadModel.deleteMany({
      where: {
        occurredAt: {
          gte: window.from,
          lt: window.to,
        },
      },
    });
  }

  private toReadModel(row: {
    id: bigint;
    orderId: bigint;
    companyId: bigint;
    workerId: bigint | null;
    eventId: bigint | null;
    status: string;
    amountCents: bigint;
    currency: string;
    occurredAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): OperationReadModel {
    return row as OperationReadModel;
  }
}
```
