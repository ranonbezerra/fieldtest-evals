import { Injectable } from '@nestjs/common';
import { STATUSES } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

export interface OperationListQuery {
  companyId: number;
  statuses?: Status[];
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRowData[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  /** Dashboard read. Projection only — no join back to the source tables. */
  async listOperations(query: OperationListQuery): Promise<OperationPage> {
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + 60_000);
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : STATUSES;
    const { items, total } = await this.repo.listOperations({
      companyId: query.companyId,
      statuses,
      from,
      to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getCompanyTotals(companyId: number): Promise<CompanyTotalsData> {
    return this.repo.getCompanyTotals(companyId);
  }
}
