import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus } from '@prisma/client';
import { OperationsRepository, type OperationsQuery } from './operations.repository.js';

export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount_cents: number;
  created_at: string;
  updated_at: string;
  last_event_type: string | null;
  last_event_at: string | null;
}

export interface OperationsPage {
  items: OperationItem[];
  meta: { page: number; page_size: number; total_count: number };
}

function toItem(row: OperationRead): OperationItem {
  return {
    id: row.id,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_event_type: row.lastEventType,
    last_event_at: row.lastEventAt?.toISOString() ?? null,
  };
}

@Injectable()
export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}

  async list(query: OperationsQuery): Promise<OperationsPage> {
    const [items, totalCount] = await Promise.all([
      this.repository.list(undefined, query),
      this.repository.count(undefined, query),
    ]);
    return {
      items: items.map(toItem),
      meta: { page: query.page, page_size: query.pageSize, total_count: totalCount },
    };
  }
}
