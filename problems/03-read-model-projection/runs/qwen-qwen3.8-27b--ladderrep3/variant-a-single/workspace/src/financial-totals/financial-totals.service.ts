import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Injectable()
export class FinancialTotalsService {
  constructor(@Inject(FinancialTotalsRepository) private readonly repository: FinancialTotalsRepository) {}

  /** Exact per-company totals, maintained by atomic increments in the write path. */
  async get(companyId: string) {
    const totals = await this.repository.findByCompanyId(companyId);
    if (!totals) {
      throw new DomainException(
        404,
        'resource_not_found',
        `no financial totals recorded for company ${companyId}`,
        { company_id: companyId },
      );
    }
    return {
      company_id: totals.companyId,
      // bigint is emitted as a string: finance reconciles against exact values
      pending_amount_cents: totals.pendingAmountCents.toString(),
      approved_amount_cents: totals.approvedAmountCents.toString(),
      rejected_amount_cents: totals.rejectedAmountCents.toString(),
      orders_count: totals.ordersCount,
    };
  }
}
