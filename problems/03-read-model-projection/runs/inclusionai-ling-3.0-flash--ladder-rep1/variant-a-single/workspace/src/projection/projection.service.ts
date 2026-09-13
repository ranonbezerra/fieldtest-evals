import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Projection maintenance hooks.
 *
 * Every method accepts an optional PrismaClient parameter `tx`.
 * When `tx` is provided the caller (write service) is inside a transaction
 * and the hook executes inside that transaction — so a rollback also rolls
 * back the projection change.  When `tx` is omitted the method runs with
 * the service's own PrismaClient (used by redervative / drift repair).
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Sync hooks called by write services ─────────────────────

  /**
   * Insert a single order row into the OrderDashboard projection.
   * Runs inside the write transaction.
   */
  async syncOrderDashboard(
    tx: PrismaClient,
    row: {
      orderId: string;
      companyId: string;
      workerId: string;
      workerName: string;
      companyName: string;
      amount: bigint | number | string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      eventCount?: number;
    },
  ) {
    await tx.orderDashboard.create({
      data: {
        orderId: row.orderId,
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        companyName: row.companyName,
        amount: BigInt(row.amount).toString(),
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        eventCount: row.eventCount ?? 0,
      },
    });
  }

  /**
   * Update an existing order row's status and timestamp in the projection.
   * Runs inside the write transaction.
   */
  async syncOrderDashboardStatus(tx: PrismaClient, orderId: string, status: string) {
    await tx.orderDashboard.update({
      where: { orderId },
      data: { status, updatedAt: new Date() },
    });
  }

  /**
   * Atomically update per-company financial totals.
   * Uses INSERT … ON CONFLICT … DO UPDATE with server-side increment,
   * which is atomic at the row level in PostgreSQL.  Two concurrent
   * approvals for the same company are serialised by the PK / unique
   * index, so neither increment is lost.
   *
   * `kind`  = 'total'    → bumps totalOrders + totalAmount
   * `kind`  = 'approved' → bumps approvedCount + approvedAmount
   */
  async updateCompanyTotals(
    tx: PrismaClient,
    companyId: string,
    amount: bigint | number | string,
    kind: 'total' | 'approved',
  ) {
    const amt = BigInt(amount).toString();
    if (kind === 'total') {
      await tx.companyFinancialTotals.upsert({
        where: { companyId },
        create: {
          companyId,
          totalOrders: 1,
          totalAmount: amt,
          approvedCount: 0,
          approvedAmount: '0',
        },
        update: {
          totalOrders: { increment: 1 },
          totalAmount: { increment: amt },
          updatedAt: new Date(),
        },
      });
    } else {
      await tx.companyFinancialTotals.upsert({
        where: { companyId },
        create: {
          companyId,
          totalOrders: 0,
          totalAmount: '0',
          approvedCount: 1,
          approvedAmount: amt,
        },
        update: {
          approvedCount: { increment: 1 },
          approvedAmount: { increment: amt },
          updatedAt: new Date(),
        },
      });
    }
  }

  // ── Maintenance routines (outside write tx) ─────────────────

  /**
   * Re-derive the OrderDashboard projection for a date window.
   * Safe to run while live; idempotent (running twice yields identical state).
   */
  async rederiveWindow(startDate: Date, endDate: Date) {
    await this.prisma.$transaction(async (tx) => {
      // Remove existing projection rows whose orders fall inside the window.
      const rows = await tx.orderDashboard.findMany({
        where: { createdAt: { gte: startDate, lte: endDate } },
        select: { orderId: true },
      });
      const orderIds = rows.map((r) => r.orderId);

      if (orderIds.length) {
        await tx.orderDashboard.deleteMany({ where: { orderId: { in: orderIds } } });
      }

      // Rebuild from source tables.
      const orders = await tx.paymentOrder.findMany({
        where: { createdAt: { gte: startDate, lte: endDate } },
        include: { company: true, worker: true, events: true },
      });

      const dashboardRows = orders.map((o) => ({
        orderId: o.id,
        companyId: o.companyId,
        workerId: o.workerId,
        workerName: o.worker.name,
        companyName: o.company.name,
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        eventCount: o.events.length,
      }));

      if (dashboardRows.length) {
        await tx.orderDashboard.createMany({ data: dashboardRows, skipDuplicates: true });
      }

      // Recalculate financial totals for affected companies from source.
      const companyIds = [...new Set(orders.map((o) => o.companyId))];
      for (const cid of companyIds) {
        const companyOrders = orders.filter((o) => o.companyId === cid);
        const totalOrders = companyOrders.length;
        const totalAmount = companyOrders.reduce((s, o) => s + BigInt(o.amount.toString()), BigInt(0)).toString();
        const approved = companyOrders.filter((o) => o.status === 'approved');
        const approvedCount = approved.length;
        const approvedAmount = approved.reduce((s, o) => s + BigInt(o.amount.toString()), BigInt(0)).toString();

        await tx.companyFinancialTotals.upsert({
          where: { companyId: cid },
          create: {
            companyId: cid,
            totalOrders,
            totalAmount,
            approvedCount,
            approvedAmount,
          },
          update: {
            totalOrders,
            totalAmount,
            approvedCount,
            approvedAmount,
            updatedAt: new Date(),
          },
        });
      }
    });
  }

  /**
   * Scan the projection for rows that disagree with the source within a
   * recent window and repair them in-place.  Returns a summary.
   */
  async repairDrift(windowDays: number = 7): Promise<{ repaired: number; checked: number }> {
    const cutoff = new Date(Date.now() - windowDays * 86400000);

    return this.prisma.$transaction(async (tx) => {
      const sourceOrders = await tx.paymentOrder.findMany({
        where: { createdAt: { gte: cutoff }, OR: [{ status: 'approved' }, { status: 'pending' }, { status: 'rejected' }] },
        select: { id: true, status: true, updatedAt: true },
      });

      const projectionRows = await tx.orderDashboard.findMany({
        where: { createdAt: { gte: cutoff } },
        select: { orderId: true, status: true, updatedAt: true },
      });

      const projMap = new Map(projectionRows.map((r) => [r.orderId, r]));
      let repaired = 0;

      for (const src of sourceOrders) {
        const proj = projMap.get(src.id);
        if (!proj) {
          // Projection row missing – re-insert it.
          const full = await tx.paymentOrder.findUnique({
            where: { id: src.id },
            include: { company: true, worker: true, events: true },
          });
          if (!full) continue;
          await tx.orderDashboard.create({
            data: {
              orderId: full.id,
              companyId: full.companyId,
              workerId: full.workerId,
              workerName: full.worker.name,
              companyName: full.company.name,
              amount: full.amount,
              status: full.status,
              createdAt: full.createdAt,
              updatedAt: full.updatedAt,
              eventCount: full.events.length,
            },
          });
          repaired++;
          continue;
        }
        if (proj.status !== src.status) {
          await tx.orderDashboard.update({
            where: { orderId: src.id },
            data: { status: src.status, updatedAt: new Date() },
          });
          repaired++;
        }
      }

      return { checked: sourceOrders.length, repaired };
    });
  }
}
