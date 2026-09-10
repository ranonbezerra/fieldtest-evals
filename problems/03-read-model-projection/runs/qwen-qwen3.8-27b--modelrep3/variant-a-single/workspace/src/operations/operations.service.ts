import { Injectable } from '@nestjs/common';
import type { OperationReadModel } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { OperationsRepository } from './operations.repository.js';

export interface ListDashboardInput {
  companyId: number;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface DashboardItem {
  orderId: number;
  companyId: number;
  status: string;
  amount: string;
  eventId: number;
  eventName: string;
  eventStartsAt: Date;
  workerId: number;
  workerName: string;
  createdAt: Date;
}

export interface DashboardPage {
  items: DashboardItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyTotals {
  companyId: number;
  operationCount: number;
  totalAmount: string;
  approvedAmount: string;
  updatedAt: Date | null;
}

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async listDashboard(input: ListDashboardInput): Promise<DashboardPage> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = input.from ? new Date(input.from) : undefined;
    const to = input.to ? new Date(input.to) : undefined;
    if (from && to && from >= to) {
      throw new ApiError('invalid_date_range', 'to must be after from', { from: input.from, to: input.to });
    }

    const company = await this.repo.findCompany(input.companyId);
    if (!company) {
      throw new ApiError('resource_not_found', `company ${input.companyId} was not found`, { companyId: input.companyId }, 404);
    }

    const { items, total } = await this.repo.listOperations({
      companyId: input.companyId,
      status: input.status,
      from,
      to,
      page,
      pageSize,
    });

    return { items: items.map(toDashboardItem), total, page, pageSize };
  }

  async getCompanyTotals(companyId: number): Promise<CompanyTotals> {
    const company = await this.repo.findCompany(companyId);
    if (!company) {
      throw new ApiError('resource_not_found', `company ${companyId} was not found`, { companyId }, 404);
    }

    const totals = await this.repo.findCompanyTotal(companyId);
    return {
      companyId,
      operationCount: totals?.operationCount ?? 0,
      totalAmount: totals ? totals.totalAmount.toFixed(2) : '0.00',
      approvedAmount: totals ? totals.approvedAmount.toFixed(2) : '0.00',
      updatedAt: totals?.updatedAt ?? null,
    };
  }
}

function toDashboardItem(row: OperationReadModel): DashboardItem {
  return {
    orderId: row.orderId,
    companyId: row.companyId,
    status: row.status,
    amount: row.amount.toFixed(2),
    eventId: row.eventId,
    eventName: row.eventName,
    eventStartsAt: row.eventStartsAt,
    workerId: row.workerId,
    workerName: row.workerName,
    createdAt: row.createdAt,
  };
}
