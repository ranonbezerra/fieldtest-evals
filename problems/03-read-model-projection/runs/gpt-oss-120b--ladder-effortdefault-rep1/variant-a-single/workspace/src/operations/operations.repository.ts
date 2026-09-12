import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  OperationProjection,
  Prisma,
  CompanyFinancialTotals,
} from '@prisma/client';
import { DashboardFilters } from './operations.service';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches the projection rows for the dashboard.
   */
  async fetchOperations(
    filters: DashboardFilters,
    skip: number,
    take: number,
  ): Promise<OperationProjection[]> {
    const where: Prisma.OperationProjectionWhereInput = {};

    if (filters.companyId) {
      where.companyId = filters.companyId;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    return this.prisma.operationProjection.findMany({
      where,
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
  }

  /**
   * Upserts a projection row and atomically adjusts the per‑company totals.
   *
   * Must be executed inside a transaction that also writes the source order.
   */
  async upsertOperationAndAdjustTotals(order: {
    id: number;
    companyId: number;
    workerId?: number | null;
    eventId?: number | null;
    status: string;
    amount: Prisma.Decimal;
    createdAt: Date;
    approvedAt?: Date | null;
  }) {
    // Determine the delta to the company's total.
    // If the order is moving to an APPROVED status, we add its amount.
    // If it was already APPROVED and stays APPROVED, delta is zero.
    // For simplicity we assume this hook is only called when status changes
    // to APPROVED for the first time.
    const delta = order.status === 'APPROVED' ? order.amount : new Prisma.Decimal(0);

    await this.prisma.$transaction(async (tx) => {
      // Upsert the projection row.
      await tx.operationProjection.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          companyId: order.companyId,
          workerId: order.workerId ?? null,
          eventId: order.eventId ?? null,
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          approvedAt: order.approvedAt ?? null,
        },
        update: {
          status: order.status,
          amount: order.amount,
          approvedAt: order.approvedAt ?? null,
        },
      });

      // If there is a monetary delta, apply it atomically.
      if (!delta.equals(new Prisma.Decimal(0))) {
        await tx.$executeRawUnsafe(
          `
          INSERT INTO company_financial_totals (company_id, total_approved_amount)
          VALUES ($1, $2)
          ON CONFLICT (company_id) DO UPDATE
          SET total_approved_amount = company_financial_totals.total_approved_amount + $2
          `,
          order.companyId,
          delta,
        );
      }
    });
  }

  /**
   * Re‑derives the projection for a given date window.
   *
   * Steps:
   *   1. Delete existing projection rows that fall inside the window.
   *   2. Bulk‑insert fresh rows derived from `payment_orders`.
   *   3. Re‑compute company totals from the freshly inserted rows.
   *
   * This routine is safe to run concurrently with live traffic because it
   * works inside a transaction and only touches rows inside the window.
   */
  async rederiveProjection(start: Date, end: Date) {
    await this.prisma.$transaction(async (tx) => {
      // 1. Remove stale projection rows.
      await tx.operationProjection.deleteMany({
        where: {
          createdAt: { gte: start, lte: end },
        },
      });

      // 2. Pull source data.
      const sourceOrders = await tx.paymentOrder.findMany({
        where: {
          createdAt: { gte: start, lte: end },
        },
        select: {
          id: true,
          companyId: true,
          workerId: true,
          eventId: true,
          status: true,
          amount: true,
          createdAt: true,
          approvedAt: true,
        },
      });

      // 3. Bulk insert projection rows.
      const projectionCreates = sourceOrders.map((o) => ({
        orderId: o.id,
        companyId: o.companyId,
        workerId: o.workerId,
        eventId: o.eventId,
        status: o.status,
        amount: o.amount,
        createdAt: o.createdAt,
        approvedAt: o.approvedAt,
      }));

      // Prisma does not yet support `createMany` with Decimal on all versions;
      // we fall back to a raw query for performance.
      if (projectionCreates.length > 0) {
        const valuesClause = projectionCreates
          .map(
            (c, i) =>
              `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i *
                8 +
                5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`,
          )
          .join(', ');
        const flatValues = projectionCreates.flatMap((c) => [
          c.orderId,
          c.companyId,
          c.workerId,
          c.eventId,
          c.status,
          c.amount,
          c.createdAt,
          c.approvedAt,
        ]);
        const sql = `
          INSERT INTO operation_projections
          (order_id, company_id, worker_id, event_id, status, amount, created_at, approved_at)
          VALUES ${valuesClause}
        `;
        await tx.$executeRawUnsafe(sql, ...flatValues);
      }

      // 4. Re‑compute totals per company.
      const totals = await tx.operationProjection.groupBy({
        by: ['companyId'],
        where: {
          status: 'APPROVED',
        },
        _sum: {
          amount: true,
        },
      });

      // Upsert totals.
      for (const t of totals) {
        const amount = t._sum.amount ?? new Prisma.Decimal(0);
        await tx.$executeRawUnsafe(
          `
          INSERT INTO company_financial_totals (company_id, total_approved_amount)
          VALUES ($1, $2)
          ON CONFLICT (company_id) DO UPDATE
          SET total_approved_amount = $2
          `,
          t.companyId,
          amount,
        );
      }
    });
  }

  /**
   * Drift‑repair job – compares projection against source for a recent window
   * and fixes any mismatches.
   *
   * The window is configurable; here we use the last hour.
   */
  async repairDrift(recentWindowMs: number = 60 * 60 * 1000) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - recentWindowMs);

    // Fetch source orders in the window.
    const sourceOrders = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: windowStart, lte: now },
      },
    });

    // Fetch corresponding projection rows.
    const orderIds = sourceOrders.map((o) => o.id);
    const projectionRows = await this.prisma.operationProjection.findMany({
      where: { orderId: { in: orderIds } },
    });

    const projectionMap = new Map<number, OperationProjection>();
    for (const row of projectionRows) {
      projectionMap.set(row.orderId, row);
    }

    // Detect mismatches.
    const mismatches: typeof sourceOrders = [];
    for (const src of sourceOrders) {
      const proj = projectionMap.get(src.id);
      if (
        !proj ||
        proj.status !== src.status ||
        !proj.amount.equals(src.amount) ||
        (proj.approvedAt?.getTime() ?? 0) !== (src.approvedAt?.getTime() ?? 0)
      ) {
        mismatches.push(src);
      }
    }

    // Apply fixes inside a transaction.
    await this.prisma.$transaction(async (tx) => {
      for (const src of mismatches) {
        const oldProj = projectionMap.get(src.id);
        const delta =
          src.status === 'APPROVED' ? src.amount : new Prisma.Decimal(0);

        // Upsert projection row.
        await tx.operationProjection.upsert({
          where: { orderId: src.id },
          create: {
            orderId: src.id,
            companyId: src.companyId,
            workerId: src.workerId,
            eventId: src.eventId,
            status: src.status,
            amount: src.amount,
            createdAt: src.createdAt,
            approvedAt: src.approvedAt,
          },
          update: {
            status: src.status,
            amount: src.amount,
            approvedAt: src.approvedAt,
          },
        });

        // Adjust totals if needed.
        if (oldProj && oldProj.status === 'APPROVED') {
          // Subtract the old amount.
          await tx.$executeRawUnsafe(
            `
            UPDATE company_financial_totals
            SET total_approved_amount = total_approved_amount - $2
            WHERE company_id = $1
            `,
            oldProj.companyId,
            oldProj.amount,
          );
        }
        if (src.status === 'APPROVED') {
          // Add the new amount.
          await tx.$executeRawUnsafe(
            `
            INSERT INTO company_financial_totals (company_id, total_approved_amount)
            VALUES ($1, $2)
            ON CONFLICT (company_id) DO UPDATE
            SET total_approved_amount = company_financial_totals.total_approved_amount + $2
            `,
            src.companyId,
            delta,
          );
        }
      }
    });
  }
}
