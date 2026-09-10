import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// ASSUMPTION: @prisma/client has not been generated (Prisma, PrismaClient, and the
// OrderStatus enum are not exported). OrderStatus is defined locally to mirror the
// enum in prisma/schema.prisma, and Prisma client method access is done through a
// narrow structural type.
export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';

interface PrismaClientLike {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | { sql: string },
    ...values: unknown[]
  ): Promise<T>;
  paymentOrder: {
    findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    findFirst(args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  };
}

export interface OperationsFilter {
  companyId: string;
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface OperationRow {
  id: string;
  order_id: string;
  company_id: string;
  status: OrderStatus;
  worker_id: string | null;
  event_type: string | null;
  amount: string;
  created_at: Date;
  updated_at: Date;
}

export interface OperationsPage {
  rows: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsRepository {
  private get client(): PrismaClientLike {
    return this.prisma as unknown as PrismaClientLike;
  }

  constructor(private readonly prisma: PrismaService) {}

  async findPage(filter: OperationsFilter): Promise<OperationsPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const where: string[] = ['company_id = $1'];
    const params: unknown[] = [filter.companyId];

    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.dateFrom) {
      params.push(filter.dateFrom);
      where.push(`created_at >= $${params.length}`);
    }
    if (filter.dateTo) {
      params.push(filter.dateTo);
      where.push(`created_at < $${params.length}`);
    }

    const whereClause = where.join(' AND ');

    const countRows = await this.client.$queryRaw<{ total: string }[]>(
      { sql: `SELECT COUNT(*)::text AS total FROM operations_projection WHERE ${whereClause}` },
      ...params,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    const rows = await this.client.$queryRaw<OperationRow[]>(
      {
        sql: `SELECT id, order_id, company_id, status, worker_id, event_type, amount, created_at, updated_at
              FROM operations_projection
              WHERE ${whereClause}
              ORDER BY created_at DESC
              LIMIT ${pageSize} OFFSET ${offset}`,
      },
      ...params,
    );

    return { rows, total, page, pageSize };
  }

  async findCompanyTotals(companyId: string): Promise<Record<OrderStatus, number>> {
    const rows = await this.client.$queryRaw<{ status: OrderStatus; cnt: string }[]>(
      {
        sql: `SELECT status, COUNT(*)::text AS cnt FROM operations_projection WHERE company_id = $1 GROUP BY status`,
      },
      companyId,
    );

    const totals: Record<OrderStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const row of rows) {
      totals[row.status] = parseInt(row.cnt, 10);
    }

    return totals;
  }

  async findPaymentOrdersByCompany(companyId: string, dateFrom: string, dateTo: string): Promise<Record<string, unknown>[]> {
    return this.client.paymentOrder.findMany({
      where: {
        companyId,
        createdAt: { gte: new Date(dateFrom), lt: new Date(dateTo) },
      },
    });
  }
}
