import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OperationRow, OrderStatus, CompanyTotals } from './projections.types';

@Injectable()
export class ProjectionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOrder(order: OperationRow): Promise<void> {
    await this.prisma.operationReadModel.upsert({
      where: { id: order.id },
      update: {
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
      create: {
        id: order.id,
        companyId: order.companyId,
        workerId: order.workerId,
        workerName: order.workerName,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        eventLocation: order.eventLocation,
        status: order.status,
        amountCents: order.amountCents,
        createdAt: order.createdAt,
      },
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    await this.prisma.operationReadModel.update({
      where: { id: orderId },
      data: { status },
    });
  }

  async adjustTotals(
    companyId: string,
    delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number },
  ): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: { increment: delta.approvedCents ?? 0n },
        rejectedTotalCents: { increment: delta.rejectedCents ?? 0n },
        pendingCount: { increment: delta.pendingDelta ?? 0 },
      },
      create: {
        companyId,
        approvedTotalCents: delta.approvedCents ?? 0n,
        rejectedTotalCents: delta.rejectedCents ?? 0n,
        pendingCount: delta.pendingDelta ?? 0,
      },
    });
  }

  async resetTotals(companyId: string, totals: CompanyTotals): Promise<void> {
    await this.prisma.companyFinancialTotal.upsert({
      where: { companyId },
      update: {
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
      create: {
        companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      companyId: string;
      workerId: string;
      workerName: string;
      eventId: string;
      eventTitle: string;
      eventLocation: string;
      status: string;
      amountCents: number;
      createdAt: Date;
    }>>`
      SELECT
        po.id AS "id",
        po.company_id AS "companyId",
        po.worker_id AS "workerId",
        w.name AS "workerName",
        po.event_id AS "eventId",
        e.title AS "eventTitle",
        e.location AS "eventLocation",
        po.status AS "status",
        po.amount_cents AS "amountCents",
        po.created_at AS "createdAt"
      FROM payment_orders po
      JOIN workers w ON w.id = po.worker_id
      JOIN events e ON e.id = po.event_id
      WHERE po.created_at >= ${from} AND po.created_at < ${to}
    `;

    return rows.map((row) => ({
      ...row,
      status: row.status as OrderStatus,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      workerId: row.workerId,
      workerName: row.workerName,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      eventLocation: row.eventLocation,
      status: row.status,
      amountCents: row.amountCents,
      createdAt: row.createdAt,
    }));
  }

  async deleteProjectionWindow(from: Date, to: Date): Promise<number> {
    const result = await this.prisma.operationReadModel.deleteMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });
    return result.count;
  }

  async bulkUpsert(rows: OperationRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.operationReadModel.upsert({
          where: { id: row.id },
          update: {
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
          create: {
            id: row.id,
            companyId: row.companyId,
            workerId: row.workerId,
            workerName: row.workerName,
            eventId: row.eventId,
            eventTitle: row.eventTitle,
            eventLocation: row.eventLocation,
            status: row.status,
            amountCents: row.amountCents,
            createdAt: row.createdAt,
          },
        });
      }
    });
  }

  async getTotals(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({
      where: { companyId },
    });

    if (!row) return null;

    return {
      companyId: row.companyId,
      approvedTotalCents: row.approvedTotalCents,
      rejectedTotalCents: row.rejectedTotalCents,
      pendingCount: row.pendingCount,
    };
  }
}
