// src/operations/operations.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * ASSUMPTION:
 * - The read‑model projection tables are named `operations` and `company_totals`
 *   (snake_case in the database, mapped to camelCase model names by Prisma).
 * - Their columns are:
 *   * operations: id, company_id, status, amount, created_at, … (others ignored)
 *   * company_totals: company_id (PK), total_amount
 * - The Prisma client therefore exposes `prisma.operations` and
 *   `prisma.company_totals`. If the actual model names differ, rename the
 *   references accordingly.
 *
 * The repository contains only raw database calls; all business logic lives in
 * the service layer.
 */
@Injectable()
export class OperationsRepository {
  private readonly prisma = new PrismaClient();

  /**
   * Retrieves a paginated list of operations filtered by company, status and
   * date range. The caller is responsible for validating the DTOs.
   */
  async findOperations(params: {
    companyId?: number;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    skip?: number;
    take?: number;
  }) {
    // `where` is annotated as `any` to stay independent of the exact Prisma types.
    const where: any = {};

    if (params.companyId !== undefined) {
      // Prisma column is `company_id` (snake_case)
      where.company_id = params.companyId;
    }

    if (params.status !== undefined) {
      where.status = params.status;
    }

    if (params.startDate !== undefined || params.endDate !== undefined) {
      where.created_at = {};
      if (params.startDate !== undefined) {
        where.created_at.gte = params.startDate;
      }
      if (params.endDate !== undefined) {
        where.created_at.lte = params.endDate;
      }
    }

    return this.prisma.operations.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.take,
    });
  }

  /** Returns the totals row for a given company, or `null` if none exists. */
  async getCompanyTotals(companyId: number) {
    return this.prisma.company_totals.findUnique({
      where: { company_id: companyId },
    });
  }

  /**
   * Increments (or decrements) the total amount for a company.
   * `deltaAmount` may be positive or negative.
   */
  async upsertCompanyTotals(companyId: number, deltaAmount: number) {
    // Prisma `increment` works only on numeric fields.
    return this.prisma.company_totals.upsert({
      where: { company_id: companyId },
      create: { company_id: companyId, total_amount: deltaAmount },
      update: { total_amount: { increment: deltaAmount } },
    });
  }

  /**
   * Re‑derives the total amount for a company for a specific date window.
   * Used by the re‑derivation service.
   */
  async rederiveCompanyTotals(
    companyId: number,
    start: Date,
    end: Date,
  ) {
    const agg = await this.prisma.operations.aggregate({
      _sum: { amount: true },
      where: {
        company_id: companyId,
        created_at: { gte: start, lte: end },
      },
    });

    const total = agg._sum.amount ?? 0;

    return this.prisma.company_totals.upsert({
      where: { company_id: companyId },
      create: { company_id: companyId, total_amount: total },
      update: { total_amount: total },
    });
  }

  /**
   * Placeholder drift‑repair routine.
   * The actual implementation is handled by the drift service; this method
   * simply exists so the service can call a repository method without importing
   * Prisma directly.
   */
  async repairDrift(): Promise<void> {
    // No‑op: concrete logic will be filled in later.
    return;
  }
}
