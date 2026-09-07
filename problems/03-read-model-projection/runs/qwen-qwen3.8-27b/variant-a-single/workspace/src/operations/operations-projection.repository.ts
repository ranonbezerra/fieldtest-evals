import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTx } from '../common/prisma.service';

// ASSUMPTION: Prisma client is not generated in this environment; OrderStatus is defined locally.
export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'settled' | 'cancelled';

interface ProjectionRow {
  id: number;
  order_id: string;
  company_id: string;
  status: string;
  amount_cents: number;
  occurred_at: Date;
  event_id: string | null;
  worker_id: string | null;
  updated_at: Date;
}

interface DashboardFilter {
  companyId: string;
  status?: OrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
}

interface DashboardResult {
  rows: ProjectionRow[];
  total: number;
}

@Injectable()
export class OperationsProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Sync-hook: upsert a single projection row after an order write ---

  async upsert(
    tx: PrismaTx,
    data: {
      orderId: string;
      companyId: string;
      status: OrderStatus;
      amountCents: number;
      occurredAt: Date;
      eventId: string | null;
      workerId: string | null;
    },
  ): Promise<void> {
    const client = tx as any;
    await client.$executeRaw`
      INSERT INTO operations_projection
        (order_id, company_id, status, amount_cents, occurred_at, event_id, worker_id, updated_at)
      VALUES
        (${data.orderId}, ${data.companyId}, ${data.status}, ${data.amountCents}, ${data.occurredAt}, ${data.eventId}, ${data.workerId}, NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        event_id     = EXCLUDED.event_id,
        worker_id    = EXCLUDED.worker_id,
        updated_at   = NOW()
    `;
  }

  async upsertStandalone(
    data: {
      orderId: string;
      companyId: string;
      status: OrderStatus;
      amountCents: number;
      occurredAt: Date;
      eventId: string | null;
      workerId: string | null;
    },
  ): Promise<void> {
    const client = this.prisma as any;
    await client.$executeRaw`
      INSERT INTO operations_projection
        (order_id, company_id, status, amount_cents, occurred_at, event_id, worker_id, updated_at)
      VALUES
        (${data.orderId}, ${data.companyId}, ${data.status}, ${data.amountCents}, ${data.occurredAt}, ${data.eventId}, ${data.workerId}, NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        event_id     = EXCLUDED.event_id,
        worker_id    = EXCLUDED.worker_id,
        updated_at   = NOW()
    `;
  }

  // --- Dashboard query: filtered, sorted by recency, paginated ---

  async findForDashboard(
    filter: DashboardFilter,
    page: number,
    limit: number,
  ): Promise<DashboardResult> {
    const client = this.prisma as any;
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [`company_id = ${filter.companyId}`];
    const params: unknown[] = [];

    if (filter.status) {
      whereClauses.push(`status = ${filter.status}`);
    }
    if (filter.dateFrom) {
      whereClauses.push(`occurred_at >= ${filter.dateFrom}`);
    }
    if (filter.dateTo) {
      whereClauses.push(`occurred_at <= ${filter.dateTo}`);
    }

    const where = whereClauses.join(' AND ');

    const rows = (await client.$queryRaw`
      SELECT order_id, company_id, status, amount_cents, occurred_at, event_id, worker_id, updated_at
      FROM operations_projection
      WHERE ${this.prisma.$unsafeRaw(where)}
      ORDER BY occurred_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `) as ProjectionRow[];

    const countResult = (await client.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM operations_projection
      WHERE ${this.prisma.$unsafeRaw(where)}
    `) as Array<{ total: number }>;

    return { rows, total: countResult[0]?.total ?? 0 };
  }

  // --- Re-derivation for an arbitrary date window ---

  async reDerive(since: Date, until: Date, tx?: PrismaTx): Promise<number> {
    const client = (tx ?? this.prisma) as any;

    await client.$executeRaw`
      DELETE FROM operations_projection
      WHERE occurred_at >= ${since} AND occurred_at < ${until}
    `;

    const result = await client.$executeRaw`
      INSERT INTO operations_projection
        (order_id, company_id, status, amount_cents, occurred_at, event_id, worker_id, updated_at)
      SELECT
        po.id,
        po.company_id,
        po.status,
        po.amount_cents,
        po.created_at,
        po.event_id,
        po.worker_id,
        NOW()
      FROM payment_orders po
      WHERE po.created_at >= ${since} AND po.created_at < ${until}
    `;

    return result;
  }

  // --- Drift repair: reconcile projection rows against source of truth ---

  async driftRepair(since: Date, until: Date): Promise<{ repaired: number; removed: number }> {
    const client = this.prisma as any;

    // Remove projection rows whose source order no longer exists
    const removedResult = await client.$executeRaw`
      DELETE FROM operations_projection
      WHERE order_id NOT IN (
        SELECT id FROM payment_orders WHERE created_at >= ${since} AND created_at < ${until}
      )
      AND occurred_at >= ${since} AND occurred_at < ${until}
    `;

    // Upsert all rows that should exist
    const repairedResult = await client.$executeRaw`
      INSERT INTO operations_projection
        (order_id, company_id, status, amount_cents, occurred_at, event_id, worker_id, updated_at)
      SELECT
        po.id,
        po.company_id,
        po.status,
        po.amount_cents,
        po.created_at,
        po.event_id,
        po.worker_id,
        NOW()
      FROM payment_orders po
      WHERE po.created_at >= ${since} AND po.created_at < ${until}
      ON CONFLICT (order_id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        event_id     = EXCLUDED.event_id,
        worker_id    = EXCLUDED.worker_id,
        updated_at   = NOW()
      WHERE operations_projection.company_id IS DISTINCT FROM EXCLUDED.company_id
         OR operations_projection.status IS DISTINCT FROM EXCLUDED.status
         OR operations_projection.amount_cents IS DISTINCT FROM EXCLUDED.amount_cents
         OR operations_projection.event_id IS DISTINCT FROM EXCLUDED.event_id
         OR operations_projection.worker_id IS DISTINCT FROM EXCLUDED.worker_id
    `;

    return { repaired: repairedResult, removed: removedResult };
  }
}
