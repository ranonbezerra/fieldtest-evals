import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

export interface RederivationResult {
  ordersRedriven: number;
  companiesRecounted: number;
}

export interface DriftCount {
  missing: number;
  stale: number;
}

@Injectable()
export class RederivationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Re-derives the read-model rows for orders created in [from, to) and recounts
  // the totals of every company touched by the window, straight from the source
  // tables. Idempotent: running it twice over the same window is a no-op.
  async rederiveWindow(from: Date, to: Date): Promise<RederivationResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const [windowCount] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM payment_orders
          WHERE created_at >= ${from} AND created_at < ${to}
        `;

        await tx.$executeRaw`
          DELETE FROM operation_read_models
          WHERE created_at >= ${from} AND created_at < ${to}
        `;

        await tx.$executeRaw`
          INSERT INTO operation_read_models
            (order_id, company_id, status, amount, event_id, event_name, event_starts_at, worker_id, worker_name, created_at)
          SELECT
            o.id, o.company_id, o.status, o.amount,
            e.id, e.name, e.starts_at,
            w.id, w.name,
            o.created_at
          FROM payment_orders o
          JOIN events e ON e.id = o.event_id
          JOIN workers w ON w.id = o.worker_id
          WHERE o.created_at >= ${from} AND o.created_at < ${to}
        `;

        const companies = await tx.$queryRaw<{ company_id: number }[]>`
          SELECT DISTINCT company_id
          FROM payment_orders
          WHERE created_at >= ${from} AND created_at < ${to}
        `;

        for (const { company_id } of companies) {
          await tx.$executeRaw`
            INSERT INTO company_operation_totals
              (company_id, operation_count, total_amount, approved_amount, updated_at)
            SELECT
              ${company_id}::int,
              count(*)::int,
              COALESCE(sum(amount), 0),
              COALESCE(sum(amount) FILTER (WHERE status = 'approved'), 0),
              now()
            FROM payment_orders
            WHERE company_id = ${company_id}
            ON CONFLICT (company_id) DO UPDATE
              SET operation_count = excluded.operation_count,
                  total_amount = excluded.total_amount,
                  approved_amount = excluded.approved_amount,
                  updated_at = excluded.updated_at
          `;
        }

        return { ordersRedriven: windowCount?.count ?? 0, companiesRecounted: companies.length };
      },
      { timeout: 60000 },
    );
  }

  // Counts read-model rows inside [from, to) that diverge from the source join:
  // "missing" = orders with no read-model row; "stale" = rows whose
  // denormalized fields no longer match the joined source.
  async countDrift(from: Date, to: Date): Promise<DriftCount> {
    const [row] = await this.prisma.$queryRaw<{ missing: number; stale: number }[]>`
      SELECT
        (
          SELECT count(*)
          FROM payment_orders o
          LEFT JOIN operation_read_models r ON r.order_id = o.id
          WHERE o.created_at >= ${from} AND o.created_at < ${to}
            AND r.order_id IS NULL
        )::int AS missing,
        (
          SELECT count(*)
          FROM operation_read_models r
          JOIN payment_orders o ON o.id = r.order_id
          JOIN events e ON e.id = o.event_id
          JOIN workers w ON w.id = o.worker_id
          WHERE r.created_at >= ${from} AND r.created_at < ${to}
            AND (
              r.company_id <> o.company_id
              OR r.status <> o.status
              OR r.amount <> o.amount
              OR r.event_id <> o.event_id
              OR r.event_name <> e.name
              OR r.worker_id <> o.worker_id
              OR r.worker_name <> w.name
            )
        )::int AS stale
    `;
    return { missing: row?.missing ?? 0, stale: row?.stale ?? 0 };
  }
}
