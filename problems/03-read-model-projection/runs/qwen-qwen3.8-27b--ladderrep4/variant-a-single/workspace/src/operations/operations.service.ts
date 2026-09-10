import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { OrderStatus } from '../orders/orders.repository.js';
import { OperationsRepository } from './operations.repository.js';

export interface OperationItemDto {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amountCents: string;
  lastEventType: string | null;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationsPageDto {
  items: OperationItemDto[];
  page: number;
  pageSize: number;
}

export interface TotalsDto {
  companyId: string;
  ordersCount: string;
  approvedCount: string;
  approvedAmountCents: string;
  pendingCount: string;
  pendingAmountCents: string;
  rejectedCount: string;
  rejectedAmountCents: string;
}

export interface ListOperationsInput {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly operations: OperationsRepository) {}

  list(input: ListOperationsInput): Promise<OperationsPageDto> {
    if (input.from && Number.isNaN(input.from.getTime())) {
      throw new AppError(400, 'validation_failed', '`from` is not a valid timestamp.', { from: String(input.from) });
    }
    if (input.to && Number.isNaN(input.to.getTime())) {
      throw new AppError(400, 'validation_failed', '`to` is not a valid timestamp.', { to: String(input.to) });
    }
    if (input.from && input.to && input.from.getTime() >= input.to.getTime()) {
      throw new AppError(400, 'validation_failed', '`from` must be strictly before `to`.', {
        from: input.from.toISOString(),
        to: input.to.toISOString(),
      });
    }
    return this.operations
      .list({
        companyId: input.companyId,
        status: input.status,
        from: input.from,
        to: input.to,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      })
      .then((rows) => ({
        items: rows.map((row) => ({
          id: row.id,
          companyId: row.companyId,
          workerId: row.workerId,
          workerName: row.workerName,
          status: row.status,
          amountCents: row.amountCents.toString(),
          lastEventType: row.lastEventType,
          lastEventAt: row.lastEventAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        page: input.page,
        pageSize: input.pageSize,
      }));
  }

  totals(companyId: string): Promise<TotalsDto> {
    return this.operations.findTotals(companyId).then((row) => ({
      companyId,
      ordersCount: (row?.ordersCount ?? 0n).toString(),
      approvedCount: (row?.approvedCount ?? 0n).toString(),
      approvedAmountCents: (row?.approvedAmountCents ?? 0n).toString(),
      pendingCount: (row?.pendingCount ?? 0n).toString(),
      pendingAmountCents: (row?.pendingAmountCents ?? 0n).toString(),
      rejectedCount: (row?.rejectedCount ?? 0n).toString(),
      rejectedAmountCents: (row?.rejectedAmountCents ?? 0n).toString(),
    }));
  }
}
