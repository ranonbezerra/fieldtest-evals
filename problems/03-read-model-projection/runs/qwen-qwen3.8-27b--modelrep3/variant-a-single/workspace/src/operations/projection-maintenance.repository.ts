import { Injectable } from '@nestjs/common';
import type { CompanyOperationTotal, OperationReadModel, Prisma } from '@prisma/client';

export interface OperationRowData {
  orderId: number;
  companyId: number;
  status: string;
  amount: Prisma.Decimal;
  eventId: number;
  eventName: string;
  eventStartsAt: Date;
  workerId: number;
  workerName: string;
  createdAt: Date;
}

export interface TotalDelta {
  companyId: number;
  operationCount: number;
  totalAmount: Prisma.Decimal;
  approvedAmount: Prisma.Decimal;
}

// DML for the projection and the company totals. Every method runs inside the
// caller's transaction, so a write and its maintenance step commit or roll
// back as one unit.
@Injectable()
export class ProjectionMaintenanceRepository {
  upsertOperationRow(tx: Prisma.TransactionClient, row: OperationRowData): Promise<OperationReadModel> {
    const { orderId, ...update } = row;
    return tx.operationReadModel.upsert({
      where: { orderId },
      update,
      create: row,
    });
  }

  // One atomic statement: row missing -> created from the delta; row present ->
  // SQL-level increments. Concurrent writers on the same company therefore
  // never lose updates.
  adjustCompanyTotal(tx: Prisma.TransactionClient, delta: TotalDelta): Promise<CompanyOperationTotal> {
    return tx.companyOperationTotal.upsert({
      where: { companyId: delta.companyId },
      create: {
        companyId: delta.companyId,
        operationCount: delta.operationCount,
        totalAmount: delta.totalAmount,
        approvedAmount: delta.approvedAmount,
      },
      update: {
        operationCount: { increment: delta.operationCount },
        totalAmount: { increment: delta.totalAmount },
        approvedAmount: { increment: delta.approvedAmount },
      },
    });
  }

  renameEventOnReadModels(tx: Prisma.TransactionClient, eventId: number, name: string): Promise<number> {
    return tx.operationReadModel
      .updateMany({ where: { eventId }, data: { eventName: name } })
      .then((result) => result.count);
  }

  renameWorkerOnReadModels(tx: Prisma.TransactionClient, workerId: number, name: string): Promise<number> {
    return tx.operationReadModel
      .updateMany({ where: { workerId }, data: { workerName: name } })
      .then((result) => result.count);
  }
}
