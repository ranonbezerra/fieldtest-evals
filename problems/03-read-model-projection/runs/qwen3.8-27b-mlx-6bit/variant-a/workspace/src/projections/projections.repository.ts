import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CompanyTotals, OperationRow, OrderStatus } from './projections.types';

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
    const approved = delta.approvedCents ?? 0n;
    const rejected = delta.rejectedCents ?? 0n;
    const pending = delta.pendingDelta ?? 0;

    await this.prisma.$executeRaw`
      INSERT INTO company_financial_totals (company_id, approved_total_cents, rejected_total_cents, pending_count)
      VALUES (${companyId}, ${approved}, ${rejected}, ${pending})
      ON CONFLICT (company_id) DO UPDATE SET
        approved_total_cents = company_financial_totals.approved_total_cents + ${approved},
        rejected_total_cents = company_financial_totals.rejected_total_cents + ${rejected},
        pending_count = company_financial_totals.pending_count + ${pending}
    `;
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
        companyId: totals.companyId,
        approvedTotalCents: totals.approvedTotalCents,
        rejectedTotalCents: totals.rejectedTotalCents,
        pendingCount: totals.pendingCount,
      },
    });
  }

  // ASSUMPTION: The Prisma schema defines relation fields (worker, event) on PaymentOrder
  // so that `include` can be used for the source-window join.

  async fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
      include: {
        worker: true,
        event: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.worker.name,
      eventId: r.eventId,
      eventTitle: r.event.title,
      eventLocation: r.event.location,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
    }));
  }

  async fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operationReadModel.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      workerId: r.workerId,
      workerName: r.workerName,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventLocation: r.eventLocation,
      status: r.status as OrderStatus,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
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

    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.operationReadModel.upsert({
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
        }),
      ),
    );
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
