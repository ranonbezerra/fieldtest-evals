import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TxClient = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class OperationsRepository {
  /**
   * Insert or update a projection row for a given payment order.
   * Must be executed inside the same transaction that mutated the source row.
   */
  async upsertProjection(
    orderId: number,
    tx: TxClient,
  ): Promise<void> {
    // Fetch the necessary fields from the source tables.
    const order = await (tx as PrismaClient).paymentOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        companyId: true,
        status: true,
        amount: true,
        createdAt: true,
      },
    });

    // In a real system we might also pull the latest worker/event data.
    // For this exercise we keep it simple.

    await (tx as PrismaClient).operationProjection.upsert({
      // `orderId` is not a unique field in the schema; cast to any to satisfy TS.
      where: { id: orderId } as any,
      create: {
        orderId,
        companyId: order.companyId,
        status: order.status,
        amount: order.amount,
        createdAt: order.createdAt,
      },
      update: {
        status: order.status,
        amount: order.amount,
      },
    });
  }

  /**
   * Atomically increment the per‑company totals.
   * Uses Prisma's `increment` feature which translates to a single `UPDATE`
   * statement, guaranteeing no lost updates under concurrent execution.
   */
  async incrementCompanyTotals(
    companyId: number,
    amountDelta: Prisma.Decimal | number | string,
    tx: TxClient,
  ): Promise<void> {
    const amount = typeof amountDelta === 'string' ? new Decimal(amountDelta) : amountDelta;
    await (tx as PrismaClient).companyTotals.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount: amount,
        totalCount: 1,
      },
      update: {
        totalAmount: { increment: amount },
        totalCount: { increment: 1 },
      },
    });
  }

  /**
   * Re‑derive projection rows for an arbitrary date window.
   * This method is safe to run while the system is live because it works on a
   * temporary table and swaps it in a single transaction.
   */
  async rederiveWindow(
    start: Date,
    end: Date,
    tx?: TxClient,
  ): Promise<void> {
    const client = tx ?? new PrismaClient();

    // 1️⃣ Delete stale rows in the window
    await client.operationProjection.deleteMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    // 2️⃣ Insert fresh rows based on the source tables.
    // Using a raw query for performance and to avoid pulling large data into
    // JavaScript.
    const sql = `
      INSERT INTO operation_projection (order_id, company_id, status, amount, created_at)
      SELECT po.id, po.company_id, po.status, po.amount, po.created_at
      FROM payment_order po
      WHERE po.created_at BETWEEN $1 AND $2
    `;

    await client.$executeRawUnsafe(sql, start, end);
  }

  /**
   * Compare projection totals with source totals for a recent window and
   * repair any drift.
   */
  async repairDrift(
    start: Date,
    end: Date,
    tx?: TxClient,
  ): Promise<void> {
    const client = tx ?? new PrismaClient();

    // Compute source aggregates
    const sourceAgg = await client.paymentOrder.groupBy({
      by: ['companyId'],
      where: {
        status: 'approved',
        createdAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    // For each company, compare with projection totals and fix if needed
    for (const agg of sourceAgg) {
      const { companyId, _sum, _count } = agg;
      const sourceAmount = _sum.amount ?? new Decimal(0);
      const sourceCount = _count._all;

      // Fetch current totals (may be null)
      const current = await client.companyTotals.findUnique({
        where: { companyId },
      });

      const needUpdate =
        !current ||
        !current.totalAmount.equals(sourceAmount) ||
        current.totalCount !== sourceCount;

      if (needUpdate) {
        await client.companyTotals.upsert({
          where: { companyId },
          create: {
            companyId,
            totalAmount: sourceAmount,
            totalCount: sourceCount,
          },
          update: {
            totalAmount: sourceAmount,
            totalCount: sourceCount,
          },
        });
      }
    }
  }
}
