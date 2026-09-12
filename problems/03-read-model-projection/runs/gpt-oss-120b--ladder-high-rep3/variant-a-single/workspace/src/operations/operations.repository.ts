import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts a row in the projection table. Called from the write path inside a
   * transaction, ensuring read‑your‑own‑writes.
   */
  async upsertProjection(
    tx: PrismaClient,
    data: {
      orderId: string;
      companyId: string;
      status: string;
      amount: Decimal;
      workerId?: string | null;
      eventType?: string | null;
      eventTimestamp?: Date | null;
      createdAt: Date;
    },
  ) {
    await tx.operationProjection.upsert({
      where: { orderId: data.orderId },
      create: {
        orderId: data.orderId,
        companyId: data.companyId,
        status: data.status,
        amount: data.amount,
        workerId: data.workerId ?? null,
        eventType: data.eventType ?? null,
        eventTimestamp: data.eventTimestamp ?? null,
        createdAt: data.createdAt,
      },
      update: {
        status: data.status,
        amount: data.amount,
        workerId: data.workerId ?? null,
        eventType: data.eventType ?? null,
        eventTimestamp: data.eventTimestamp ?? null,
      },
    });
  }

  /** Increment per‑company total atomically */
  async incrementCompanyTotal(
    tx: PrismaClient,
    companyId: string,
    amount: Decimal,
  ) {
    await tx.operationCompanyTotal.upsert({
      where: { companyId },
      create: { companyId, totalAmount: amount },
      update: {
        totalAmount: {
          increment: amount,
        },
      },
    });
  }

  /** Retrieve dashboard items with pagination and filters */
  async getDashboard(params: {
    companyId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const {
      companyId,
      status,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
    } = params;

    const where: Prisma.OperationProjectionWhereInput = {
      ...(companyId && { companyId }),
      ...(status && { status }),
      ...(startDate && { createdAt: { gte: startDate } }),
      ...(endDate && { createdAt: { lte: endDate } }),
    };

    const [total, items] = await Promise.all([
      this.prisma.operationProjection.count({ where }),
      this.prisma.operationProjection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, items };
  }

  /** Re‑derive projection rows for a given date window */
  async rederiveWindow(startDate: Date, endDate: Date) {
    // Delete stale projection rows in window
    await this.prisma.operationProjection.deleteMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // Re‑insert from source tables
    const orders = await this.prisma.paymentOrder.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
    });

    for (const order of orders) {
      const event = await this.prisma.event.findFirst({
        where: { orderId: order.id },
      });
      const worker = await this.prisma.worker.findFirst();

      await this.upsertProjection(this.prisma, {
        orderId: order.id,
        companyId: order.companyId,
        status: order.status,
        amount: order.amount as Decimal,
        workerId: worker?.id,
        eventType: event?.type,
        eventTimestamp: event?.timestamp,
        createdAt: order.createdAt,
      });
    }
  }

  /** Repair drift for a specific interval */
  async repairDrift(start: Date, end: Date) {
    // Re‑derive the window – this will bring projection back in sync
    await this.rederiveWindow(start, end);
  }

  /** Get total amount for a company */
  async getCompanyTotal(companyId: string): Promise<Decimal> {
    const record = await this.prisma.operationCompanyTotal.findUnique({
      where: { companyId },
    });
    return record?.totalAmount ?? new Decimal(0);
  }
}
