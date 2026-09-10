import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotals, OperationRow, OrderStatus } from '@prisma/client';
import { ResourceNotFoundError, ValidationError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { OperationsRepository } from './operations.repository.js';

export interface OperationListFilter {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationDto {
  paymentOrderId: string;
  companyId: string;
  status: OrderStatus;
  workerName: string;
  amountCents: number;
  currency: string;
  latestEventType: string | null;
  latestEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationListResult {
  items: OperationDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FinancialTotalsDto {
  companyId: string;
  pending: { amountCents: number; count: number };
  approved: { amountCents: number; count: number };
  disputed: { amountCents: number; count: number };
  cancelled: { amountCents: number; count: number };
  updatedAt: Date;
}

function toOperationDto(row: OperationRow): OperationDto {
  return {
    paymentOrderId: row.paymentOrderId,
    companyId: row.companyId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    currency: row.currency,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function zeroTotals(companyId: string): FinancialTotalsDto {
  return {
    companyId,
    pending: { amountCents: 0, count: 0 },
    approved: { amountCents: 0, count: 0 },
    disputed: { amountCents: 0, count: 0 },
    cancelled: { amountCents: 0, count: 0 },
    updatedAt: new Date(0),
  };
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsRepository,
    private readonly projection: ProjectionRepository,
  ) {}

  async list(filter: OperationListFilter): Promise<OperationListResult> {
    const query = { companyId: filter.companyId, status: filter.status, from: filter.from, to: filter.to };
    const [rows, total] = await Promise.all([
      this.operations.listOperations({
        ...query,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.operations.countOperations(query),
    ]);
    return { items: rows.map(toOperationDto), total, page: filter.page, pageSize: filter.pageSize };
  }

  async totals(companyId: string): Promise<FinancialTotalsDto> {
    const company = await this.operations.company(companyId);
    if (!company) {
      throw new ResourceNotFoundError(`Company ${companyId} does not exist`, { companyId });
    }
    const row = await this.operations.getTotals(companyId);
    if (!row) {
      return zeroTotals(companyId);
    }
    return {
      companyId,
      pending: { amountCents: Number(row.pendingAmountCents), count: row.pendingCount },
      approved: { amountCents: Number(row.approvedAmountCents), count: row.approvedCount },
      disputed: { amountCents: Number(row.disputedAmountCents), count: row.disputedCount },
      cancelled: { amountCents: Number(row.cancelledAmountCents), count: row.cancelledCount },
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Re-derives the projection for orders created in [from, to) and recomputes all
   * company totals from the source, in one transaction. Idempotent and safe while live.
   */
  async rederive(from: Date, to: Date): Promise<{ rowsRebuilt: number }> {
    if (from.getTime() >= to.getTime()) {
      throw new ValidationError('Invalid re-derivation window', { to: 'must be strictly after "from"' });
    }
    const rowsRebuilt = await this.prisma.transaction(async (tx) => {
      const rebuilt = await this.projection.rederiveWindow(tx, from, to);
      await this.projection.recomputeTotals(tx);
      return rebuilt;
    });
    return { rowsRebuilt };
  }
}
