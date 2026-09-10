import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';

export interface OperationRowData {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  pending: number;
  approved: number;
  rejected: number;
  ordersCount: number;
}

@Injectable()
export class ProjectionRepository {
  /**
   * Full-value upsert of one projection row. Idempotent: the hook, the
   * re-derivation and the drift repair all converge on the same value.
   */
  async upsertOperationRow(tx: DbClient, row: OperationRowData): Promise<void> {
    await tx.operationReadModel.upsert({
      where: { paymentOrderId: row.paymentOrderId },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        eventId: row.eventId,
        eventName: row.eventName,
        status: row.status,
        amountCents: row.amountCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      create: row,
    });
  }

  /**
   * Atomic in-place increment of the company's totals row
   * (UPDATE ... SET col = col ± delta, expressed as an upsert so the row is
   * created on first use). No read-modify-write: concurrent transitions on
   * the same row are serialized by the row lock and none of them is lost.
   */
  async applyTotalsDelta(tx: DbClient, companyId: string, delta: TotalsDelta): Promise<void> {
    const pending = BigInt(delta.pending);
    const approved = BigInt(delta.approved);
    const rejected = BigInt(delta.rejected);
    await tx.companyFinancialTotals.upsert({
      where: { companyId },
      update: {
        pendingAmountCents: { increment: pending },
        approvedAmountCents: { increment: approved },
        rejectedAmountCents: { increment: rejected },
        ordersCount: { increment: delta.ordersCount },
      },
      create: {
        companyId,
        pendingAmountCents: pending,
        approvedAmountCents: approved,
        rejectedAmountCents: rejected,
        ordersCount: delta.ordersCount,
      },
    });
  }
}
