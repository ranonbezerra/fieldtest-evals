import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus } from '@prisma/client';
import { OperationQuery, OperationsRepository } from './operations.repository.js';

export interface OperationDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  last_event_at: string;
  created_at: string;
  updated_at: string;
}

export interface OperationsPageDto {
  items: OperationDto[];
  page: number;
  page_size: number;
  total_count: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly operations: OperationsRepository) {}

  /** Reads the dashboard page from the projection — no join at request time. */
  async list(query: OperationQuery): Promise<OperationsPageDto> {
    const { items, total } = await this.operations.findPage(query);
    return {
      items: items.map(toDto),
      page: query.page,
      page_size: query.pageSize,
      total_count: total,
    };
  }
}

function toDto(row: Operation): OperationDto {
  return {
    id: row.id,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    status: row.status,
    amount: row.amount.toFixed(4),
    currency: row.currency,
    last_event_at: row.lastEventAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
