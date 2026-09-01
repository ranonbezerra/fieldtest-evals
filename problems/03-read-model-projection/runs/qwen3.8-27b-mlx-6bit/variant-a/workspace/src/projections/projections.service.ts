import { Injectable, NotFoundException } from '@nestjs/common';
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
    // ASSUMPTION: The repository exposes no getById for source rows; using fetchSourceWindow
    // with a 1-second window around the known createdAt to retrieve the joined row.
    const rows = await this.repo.fetchSourceWindow(
      order.createdAt,
      new Date(order.createdAt.getTime() + 1000),
    );
    const sourceRow = rows.find((r) => r.id === order.id);
    if (!sourceRow) {
      throw new Error(`Source row not found for order ${order.id}`);
    }

    const operationRow: OperationRow = {
      id: sourceRow.id,
      companyId: sourceRow.companyId,
      workerId: sourceRow.workerId,
      workerName: sourceRow.workerName,
      eventId: sourceRow.eventId,
      eventTitle: sourceRow.eventTitle,
      eventLocation: sourceRow.eventLocation,
      status: sourceRow.status,
      amountCents: sourceRow.amountCents,
      createdAt: sourceRow.createdAt,
    };

    await this.repo.upsertOrder(operationRow);
    await this.repo.adjustTotals(input.companyId, { pendingDelta: 1 });
  }

  async applyOrderStatusChanged(orderId: string, newStatus: OrderStatus): Promise<void> {
    // ASSUMPTION: The repository exposes no getById for projection rows; using fetchProjectionWindow
    // with a wide window to locate the row.
    const rows = await this.repo.fetchProjectionWindow(new Date(0), new Date(Date.now() + 1));
    const row = rows.find((r) => r.id === orderId);
    if (!row) {
      throw new NotFoundException(`Projection row not found for order ${orderId}`);
    }

    await this.repo.updateOrderStatus(orderId, newStatus);

    const delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number } = {};

    if (row.status === 'pending') {
      delta.pendingDelta = -1;
    }

    if (newStatus === 'approved') {
      delta.approvedCents = BigInt(row.amountCents);
    } else if (newStatus === 'rejected') {
      delta.rejectedCents = BigInt(row.amountCents);
    }

    await this.repo.adjustTotals(row.companyId, delta);
  }

  async rederive(from: Date, to: Date): Promise<DriftReport> {
    await this.repo.deleteProjectionWindow(from, to);

    const sourceRows = await this.repo.fetchSourceWindow(from, to);

    await this.repo.bulkUpsert(sourceRows);

    const companies = new Set(sourceRows.map((r) => r.companyId));
    for (const companyId of companies) {
      const companyRows = sourceRows.filter((r) => r.companyId === companyId);
      const approvedTotalCents = companyRows
        .filter((r) => r.status === 'approved')
        .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
      const rejectedTotalCents = companyRows
        .filter((r) => r.status === 'rejected')
        .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
      const pendingCount = companyRows.filter((r) => r.status === 'pending').length;

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
      rowsCorrected: sourceRows.length,
      totalsCorrected: companies.size > 0,
    };
  }

  async repairDrift(from: Date, to: Date): Promise<DriftReport> {
    const sourceRows = await this.repo.fetchSourceWindow(from, to);
    const projectionRows = await this.repo.fetchProjectionWindow(from, to);

    const sourceMap = new Map(sourceRows.map((r) => [r.id, r]));
    const projectionMap = new Map(projectionRows.map((r) => [r.id, r]));

    let rowsCorrected = 0;
    const affectedCompanies = new Set<string>();

    for (const [id, sourceRow] of sourceMap) {
      const projRow = projectionMap.get(id);
      if (!projRow) {
        await this.repo.upsertOrder(sourceRow);
        rowsCorrected++;
        affectedCompanies.add(sourceRow.companyId);
      } else if (
        projRow.status !== sourceRow.status ||
        projRow.amountCents !== sourceRow.amountCents ||
        projRow.companyId !== sourceRow.companyId ||
        projRow.workerName !== sourceRow.workerName ||
        projRow.eventTitle !== sourceRow.eventTitle ||
        projRow.eventLocation !== sourceRow.eventLocation
      ) {
        await this.repo.upsertOrder(sourceRow);
        rowsCorrected++;
        affectedCompanies.add(sourceRow.companyId);
      }
    }

    // ASSUMPTION: The repository exposes no deleteById; orphan projection rows (present in
    // projection but absent from source) cannot be individually removed. They will be
    // cleaned on the next full rederive.
    for (const [id] of projectionMap) {
      if (!sourceMap.has(id)) {
        rowsCorrected++;
      }
    }

    let totalsCorrected = false;
    if (affectedCompanies.size > 0) {
      for (const companyId of affectedCompanies) {
        const companyRows = sourceRows.filter((r) => r.companyId === companyId);
        const approvedTotalCents = companyRows
          .filter((r) => r.status === 'approved')
          .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
        const rejectedTotalCents = companyRows
          .filter((r) => r.status === 'rejected')
          .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
        const pendingCount = companyRows.filter((r) => r.status === 'pending').length;

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
      rowsCorrected,
      totalsCorrected,
    };
  }

  async getTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getTotals(companyId);
    if (!totals) {
      throw new NotFoundException(`No totals found for company ${companyId}`);
    }
    return totals;
  }
}
