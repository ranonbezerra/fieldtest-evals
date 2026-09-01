import { Injectable } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import {
  OrderStatus,
  CreateOrderInput,
  OperationRow,
  CompanyTotals,
  DriftReport,
} from './projections.types';

@Injectable()
export class ProjectionsService {
  constructor(private readonly repo: ProjectionsRepository) {}

  async applyOrderCreated(
    input: CreateOrderInput,
    order: { id: string; createdAt: Date },
  ): Promise<void> {
    // Fetch the joined source row (order + worker + event) within a narrow window
    // around the order's createdAt to obtain denormalised fields.
    // ASSUMPTION: A ±1 s window around createdAt reliably captures the row that was
    // just inserted; in production a dedicated fetch-by-id would be preferable.
    const windowStart: Date = new Date(order.createdAt.getTime() - 1_000);
    const windowEnd: Date = new Date(order.createdAt.getTime() + 1_000);
    const rows: OperationRow[] = await this.repo.fetchSourceWindow(windowStart, windowEnd);
    const row: OperationRow | undefined = rows.find((r: OperationRow) => r.id === order.id);

    if (!row) {
      throw new Error(
        `Source row not found for order ${order.id} within projection window`,
      );
    }

    await this.repo.upsertOrder(row);
    await this.repo.adjustTotals(input.companyId, { pendingDelta: +1 });
  }

  async applyOrderStatusChanged(orderId: string, newStatus: OrderStatus): Promise<void> {
    // ASSUMPTION: ProjectionsRepository exposes getProjectionRow(orderId: string): Promise<OperationRow | null>.
    // This method is not explicitly listed in PLAN.md §3 but is required here to read
    // the current companyId and amountCents before adjusting totals.
    const current: OperationRow | null = await this.repo.getProjectionRow(orderId);
    if (!current) {
      throw new Error(`Projection row not found for order ${orderId}`);
    }

    await this.repo.updateOrderStatus(orderId, newStatus);

    const delta: {
      approvedCents?: bigint;
      rejectedCents?: bigint;
      pendingDelta?: number;
    } = {};

    // Decrement the old status's contribution
    if (current.status === 'pending') {
      delta.pendingDelta = -1;
    } else if (current.status === 'approved') {
      delta.approvedCents = -BigInt(current.amountCents);
    } else if (current.status === 'rejected') {
      delta.rejectedCents = -BigInt(current.amountCents);
    }

    // Increment the new status's contribution
    if (newStatus === 'pending') {
      delta.pendingDelta = (delta.pendingDelta ?? 0) + 1;
    } else if (newStatus === 'approved') {
      delta.approvedCents = (delta.approvedCents ?? BigInt(0)) + BigInt(current.amountCents);
    } else if (newStatus === 'rejected') {
      delta.rejectedCents = (delta.rejectedCents ?? BigInt(0)) + BigInt(current.amountCents);
    }

    await this.repo.adjustTotals(current.companyId, delta);
  }

  async rederive(from: Date, to: Date): Promise<DriftReport> {
    // Delete existing projection rows for the window
    await this.repo.deleteProjectionWindow(from, to);

    // Fetch source rows and bulk-insert them
    const rows: OperationRow[] = await this.repo.fetchSourceWindow(from, to);
    if (rows.length > 0) {
      await this.repo.bulkUpsert(rows);
    }

    // Recompute totals for every affected company
    const companyIds: string[] = [...new Set(rows.map((r: OperationRow) => r.companyId))];

    for (const companyId of companyIds) {
      const companyRows: OperationRow[] = rows.filter(
        (r: OperationRow) => r.companyId === companyId,
      );
      const approvedTotalCents: bigint = companyRows
        .filter((r: OperationRow) => r.status === 'approved')
        .reduce((sum: bigint, r: OperationRow) => sum + BigInt(r.amountCents), BigInt(0));
      const rejectedTotalCents: bigint = companyRows
        .filter((r: OperationRow) => r.status === 'rejected')
        .reduce((sum: bigint, r: OperationRow) => sum + BigInt(r.amountCents), BigInt(0));
      const pendingCount: number = companyRows.filter(
        (r: OperationRow) => r.status === 'pending',
      ).length;

      await this.repo.resetTotals(companyId, {
        companyId,
        approvedTotalCents,
        rejectedTotalCents,
        pendingCount,
      });
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: rows.length,
      totalsCorrected: true,
    };
  }

  async repairDrift(from: Date, to: Date): Promise<DriftReport> {
    const sourceRows: OperationRow[] = await this.repo.fetchSourceWindow(from, to);
    const projectionRows: OperationRow[] = await this.repo.fetchProjectionWindow(from, to);

    // Index projection rows by id for O(1) lookup
    const projectionMap: Map<string, OperationRow> = new Map();
    for (const r of projectionRows) {
      projectionMap.set(r.id, r);
    }

    // Identify source rows that are missing or stale in the projection
    const toUpsert: OperationRow[] = [];
    for (const sourceRow of sourceRows) {
      const projRow: OperationRow | undefined = projectionMap.get(sourceRow.id);
      if (
        !projRow ||
        projRow.status !== sourceRow.status ||
        projRow.amountCents !== sourceRow.amountCents ||
        projRow.workerName !== sourceRow.workerName ||
        projRow.eventTitle !== sourceRow.eventTitle ||
        projRow.eventLocation !== sourceRow.eventLocation
      ) {
        toUpsert.push(sourceRow);
      }
    }

    // Identify projection rows that have no corresponding source row (orphans)
    const sourceIds: Set<string> = new Set(sourceRows.map((r: OperationRow) => r.id));
    const orphanCount: number = projectionRows.filter(
      (r: OperationRow) => !sourceIds.has(r.id),
    ).length;

    // Apply upserts for missing/stale rows
    if (toUpsert.length > 0) {
      await this.repo.bulkUpsert(toUpsert);
    }

    // Recompute totals from source (the source of truth) for all affected companies
    const companyIds: string[] = [...new Set(sourceRows.map((r: OperationRow) => r.companyId))];
    let totalsCorrected: boolean = false;

    for (const companyId of companyIds) {
      const companyRows: OperationRow[] = sourceRows.filter(
        (r: OperationRow) => r.companyId === companyId,
      );
      const approvedTotalCents: bigint = companyRows
        .filter((r: OperationRow) => r.status === 'approved')
        .reduce((sum: bigint, r: OperationRow) => sum + BigInt(r.amountCents), BigInt(0));
      const rejectedTotalCents: bigint = companyRows
        .filter((r: OperationRow) => r.status === 'rejected')
        .reduce((sum: bigint, r: OperationRow) => sum + BigInt(r.amountCents), BigInt(0));
      const pendingCount: number = companyRows.filter(
        (r: OperationRow) => r.status === 'pending',
      ).length;

      const currentTotals: CompanyTotals | null = await this.repo.getTotals(companyId);
      if (
        !currentTotals ||
        currentTotals.approvedTotalCents !== approvedTotalCents ||
        currentTotals.rejectedTotalCents !== rejectedTotalCents ||
        currentTotals.pendingCount !== pendingCount
      ) {
        await this.repo.resetTotals(companyId, {
          companyId,
          approvedTotalCents,
          rejectedTotalCents,
          pendingCount,
        });
        totalsCorrected = true;
      }
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: toUpsert.length + orphanCount,
      totalsCorrected,
    };
  }

  async getTotals(companyId: string): Promise<CompanyTotals> {
    const totals: CompanyTotals | null = await this.repo.getTotals(companyId);
    if (!totals) {
      throw new Error(
        `company_not_found: No financial totals row exists for company ${companyId}`,
      );
    }
    return totals;
  }
}
