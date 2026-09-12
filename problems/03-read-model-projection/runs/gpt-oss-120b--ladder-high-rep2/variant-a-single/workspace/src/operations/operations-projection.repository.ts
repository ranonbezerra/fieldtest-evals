import { Injectable } from '@nestjs/common';
import { Prisma, OperationProjection, CompanyFinancialTotal } from '@prisma/client';

interface OperationProjectionUpsert {
  order_id: number;
  company_id: number;
  worker_id?: number | null;
  status: string;
  amount: Prisma.Decimal;
  created_at: Date;
  updated_at: Date;
}

interface CompanyTotalUpsert {
  company_id: number;
  amount: Prisma.Decimal;
}

/**
 * Repository that directly manipulates the projection tables.
 * All methods receive a Prisma TransactionClient to be executed inside a transaction.
 */
@Injectable()
export class OperationsProjectionRepository {
  async upsertOperationProjection(
    tx: Prisma.TransactionClient,
    data: OperationProjectionUpsert,
  ): Promise<void> {
    await tx.operationProjection.upsert({
      where: { order_id: data.order_id },
      create: {
        order_id: data.order_id,
        company_id: data.company_id,
        worker_id: data.worker_id,
        status: data.status,
        amount: data.amount,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
      update: {
        company_id: data.company_id,
        worker_id: data.worker_id,
        status: data.status,
        amount: data.amount,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    });
  }

  async upsertCompanyTotal(
    tx: Prisma.TransactionClient,
    data: CompanyTotalUpsert,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { company_id: data.company_id },
      create: {
        company_id: data.company_id,
        total_amount: data.amount,
        updated_at: new Date(),
      },
      update: {
        total_amount: { increment: data.amount },
        updated_at: new Date(),
      },
    });
  }

  async deleteOperationsByDateRange(
    tx: Prisma.TransactionClient,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    await tx.operationProjection.deleteMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async insertManyOperations(
    tx: Prisma.TransactionClient,
    rows: OperationProjectionUpsert[],
  ): Promise<void> {
    const data = rows.map((r) => ({
      order_id: r.order_id,
      company_id: r.company_id,
      worker_id: r.worker_id,
      status: r.status,
      amount: r.amount.toString(),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    if (data.length > 0) {
      await tx.operationProjection.createMany({ data, skipDuplicates: true });
    }
  }

  async recomputeCompanyTotals(
    tx: Prisma.TransactionClient,
    companyIds: number[],
  ): Promise<void> {
    // Remove existing totals for the affected companies
    await tx.companyFinancialTotal.deleteMany({
      where: { company_id: { in: companyIds } },
    });

    // Recalculate totals from the projection
    const totals = await tx.operationProjection.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: companyIds },
        status: 'approved',
      },
      _sum: {
        amount: true,
      },
    });

    const data = totals.map((t) => ({
      company_id: t.company_id,
      total_amount: t._sum.amount ?? 0,
      updated_at: new Date(),
    }));

    if (data.length > 0) {
      await tx.companyFinancialTotal.createMany({ data });
    }
  }

  async findAllCompanyIdsInWindow(
    tx: Prisma.TransactionClient,
    startDate: Date,
    endDate: Date,
  ): Promise<number[]> {
    const rows = await tx.operationProjection.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: { company_id: true },
    });
    const ids = Array.from(new Set(rows.map((r) => r.company_id)));
    return ids;
  }
}
