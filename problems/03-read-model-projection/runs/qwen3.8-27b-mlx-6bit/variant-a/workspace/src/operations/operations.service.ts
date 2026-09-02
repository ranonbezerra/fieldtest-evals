import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository';
import {
  DashboardQuery,
  DashboardResult,
  OperationRow,
  CompanyTotals,
  SimulateWriteInput,
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from './operations.types';

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async getDashboard(query: DashboardQuery): Promise<DashboardResult> {
    if (query.page < 1) {
      throw new ValidationError('page must be >= 1', { page: query.page });
    }
    if (query.page_size < 1 || query.page_size > 100) {
      throw new ValidationError('page_size must be between 1 and 100', {
        page_size: query.page_size,
      });
    }
    if (query.date_from && query.date_to && query.date_from >= query.date_to) {
      throw new InvalidDateRangeError('date_from must be before date_to', {
        date_from: query.date_from.toISOString(),
        date_to: query.date_to.toISOString(),
      });
    }

    return this.repo.queryDashboard(query);
  }

  // ASSUMPTION: The plan specifies the service orchestrates the interactive transaction
  // (passing a Prisma tx to repo methods), which conflicts with the convention "service:
  // zero Prisma client calls." I keep the plan's atomicity requirement by delegating the
  // entire transaction to a single repository method.
  async simulateWrite(input: SimulateWriteInput): Promise<OperationRow> {
    return this.repo.simulateWrite(input);
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getCompanyTotal(companyId);
    if (!totals) {
      throw new ResourceNotFoundError(
        `No financial totals found for company ${companyId}`,
        { company_id: companyId },
      );
    }
    return totals;
  }
}
