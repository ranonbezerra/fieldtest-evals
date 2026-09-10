import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel } from '@prisma/client';
import { OperationsRepository, type OperationListParams } from './operations.repository.js';

export interface OperationItemDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  list(params: OperationListParams): Promise<{ items: OperationItemDto[]; page: number; page_size: number; total: number }> {
    return this.repository.findPage(params).then(({ items, total }) => ({
      items: items.map(toItemDto),
      page: params.page,
      page_size: params.pageSize,
      total,
    }));
  }
}

function toItemDto(row: OperationReadModel): OperationItemDto {
  return {
    id: row.paymentOrderId,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    event_id: row.eventId,
    event_name: row.eventName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
