import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

export interface FinancialStatusTotalDto {
  status: OrderStatus;
  order_count: number;
  total_amount: string;
}

export interface FinancialTotalsDto {
  company_id: string;
  by_status: FinancialStatusTotalDto[];
  total: { order_count: number; total_amount: string };
}

@Injectable()
export class FinancialTotalsService {
  constructor(private readonly totals: FinancialTotalsRepository) {}

  /**
   * Financial totals for one company. The per-status rows are exact aggregates
   * maintained transactionally by the write hooks; the grand total below is an
   * exact decimal sum — never an approximation.
   */
  async forCompany(companyId: string): Promise<FinancialTotalsDto> {
    const rows = await this.totals.findByCompany(companyId);
    const totalAmount = rows.reduce((acc, row) => acc.plus(row.totalAmount), new Prisma.Decimal(0));
    const orderCount = rows.reduce((acc, row) => acc + row.orderCount, 0);
    return {
      company_id: companyId,
      by_status: rows.map(row => ({
        status: row.status,
        order_count: row.orderCount,
        total_amount: row.totalAmount.toFixed(4),
      })),
      total: {
        order_count: orderCount,
        total_amount: totalAmount.toFixed(4),
      },
    };
  }
}
