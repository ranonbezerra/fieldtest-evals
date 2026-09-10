import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OperationsFilter, OperationsRepository } from './operations.repository';

export interface OperationsPageInput extends OperationsFilter {
  page: number;
  pageSize: number;
}

export interface OperationItem {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

export interface OperationsPage {
  items: OperationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompanyTotals {
  companyId: string;
  totalCents: number;
  approvedCents: number;
  rejectedCents: number;
  orderCount: number;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repo: OperationsRepository) {}

  async listOperations(input: OperationsPageInput): Promise<OperationsPage> {
    const filter: OperationsFilter = {
      companyId: input.companyId,
      status: input.status,
      from: input.from,
      to: input.to,
    };
    const [rows, total] = await Promise.all([
      this.repo.listRows(filter, input.page, input.pageSize),
      this.repo.countRows(filter),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        status: row.status,
        amountCents: Number(row.amountCents),
        occurredAt: row.occurredAt,
        workerName: row.workerName,
        eventName: row.eventName,
        createdAt: row.createdAt,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getCompanyTotal(companyId);
    return {
      companyId,
      totalCents: Number(totals?.totalCents ?? 0n),
      approvedCents: Number(totals?.approvedCents ?? 0n),
      rejectedCents: Number(totals?.rejectedCents ?? 0n),
      orderCount: totals?.orderCount ?? 0,
    };
  }
}
