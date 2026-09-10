import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { ORDER_STATUSES } from '../common/validation.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';

export interface CompanyTotalRow {
  company_id: string;
  status: OrderStatus;
  order_count: number;
  /** Exact integer cents, serialised as a string so JSON cannot round it. */
  total_cents: string;
}

@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repository: CompanyTotalsRepository) {}

  async forCompany(companyId?: string): Promise<CompanyTotalRow[]> {
    const rows = await this.repository.list(undefined, companyId);

    const byCompany = new Map<string, Map<OrderStatus, { count: number; cents: bigint }>>();
    for (const row of rows) {
      let buckets = byCompany.get(row.companyId);
      if (!buckets) {
        buckets = new Map();
        byCompany.set(row.companyId, buckets);
      }
      buckets.set(row.status, { count: row.orderCount, cents: row.totalCents });
    }

    const companies = companyId !== undefined ? [companyId] : [...byCompany.keys()].sort();

    // Zero-fill every bucket so the operator always sees a stable shape.
    const result: CompanyTotalRow[] = [];
    for (const company of companies) {
      const buckets = byCompany.get(company);
      for (const status of ORDER_STATUSES) {
        const bucket = buckets?.get(status);
        result.push({
          company_id: company,
          status,
          order_count: bucket?.count ?? 0,
          total_cents: (bucket?.cents ?? 0n).toString(),
        });
      }
    }
    return result;
  }
}
