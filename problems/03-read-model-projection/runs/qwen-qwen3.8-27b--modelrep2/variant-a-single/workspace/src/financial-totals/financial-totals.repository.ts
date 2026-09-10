import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotal, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface StatusTransition {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amount: Prisma.Decimal;
}

export interface TotalRowInput {
  companyId: string;
  status: OrderStatus;
  orderCount: number;
  totalAmount: Prisma.Decimal;
}

@Injectable()
export class FinancialTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maintenance hook: apply the exact deltas of a status transition.
   * Each delta is a single INSERT ... ON CONFLICT DO UPDATE with an `increment`,
   * so concurrent writers serialize on the (company_id, status) row and the
   * aggregate stays exact under any interleaving.
   */
  async applyStatusTransition(tx: Prisma.TransactionClient, transition: StatusTransition): Promise<void> {
    if (transition.fromStatus !== null && transition.fromStatus !== transition.toStatus) {
      await this.applyDelta(tx, transition.companyId, transition.fromStatus, -1, transition.amount.neg());
    }
    await this.applyDelta(tx, transition.companyId, transition.toStatus, 1, transition.amount);
  }

  findByCompany(companyId: string): Promise<CompanyFinancialTotal[]> {
    return this.prisma.companyFinancialTotal.findMany({
      where: { companyId },
      orderBy: { status: 'asc' },
    });
  }

  /** Re-derivation: replace the rows of the given companies with exact source-derived values. */
  async replaceForCompanies(tx: Prisma.TransactionClient, companyIds: string[], rows: TotalRowInput[]): Promise<void> {
    if (companyIds.length === 0) return;
    await tx.companyFinancialTotal.deleteMany({ where: { companyId: { in: companyIds } } });
    if (rows.length > 0) {
      await tx.companyFinancialTotal.createMany({ data: rows });
    }
  }

  private async applyDelta(
    tx: Prisma.TransactionClient,
    companyId: string,
    status: OrderStatus,
    countDelta: number,
    amountDelta: Prisma.Decimal,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId_status: { companyId, status } },
      create: { companyId, status, orderCount: countDelta, totalAmount: amountDelta },
      update: {
        orderCount: { increment: countDelta },
        totalAmount: { increment: amountDelta },
      },
    });
  }
}
