import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DriftFindings {
  driftedOrderIds: string[];
  driftedCompanyIds: string[];
}

interface DriftedOrderRow {
  id: string;
  company_id: string;
}

interface DriftedTotalRow {
  company_id: string;
}

/**
 * Read-only diff between the projection and the source for one window of
 * source `updated_at`. Flags stale or missing ops_rows and company_totals
 * rows that disagree with the source. The repair action itself is the
 * re-derivation routine (ProjectionService.rederiveWindow).
 */
@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  async findDrift(from: Date, to: Date): Promise<DriftFindings> {
    const driftedOrders = await this.db.$queryRaw<DriftedOrderRow[]>`
      SELECT po.id, po.company_id
      FROM payment_orders po
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
        AND NOT EXISTS (
          SELECT 1
          FROM ops_rows r
          WHERE r.id = po.id
            AND r.company_id = po.company_id
            AND r.status = po.status
            AND r.amount_cents = po.amount_cents
            AND r.occurred_at = po.updated_at
            AND r.worker_name IS NOT DISTINCT FROM (SELECT w.name FROM workers w WHERE w.id = po.worker_id)
            AND r.event_name IS NOT DISTINCT FROM (SELECT e.title FROM events e WHERE e.id = po.event_id)
        )
      ORDER BY po.id
    `;
    const driftedTotals = await this.db.$queryRaw<DriftedTotalRow[]>`
      WITH windowed AS (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      ),
      source AS (
        SELECT po.company_id,
               COALESCE(SUM(po.amount_cents), 0) AS total_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_cents,
               COUNT(*) AS order_count
        FROM payment_orders po
        WHERE po.company_id IN (SELECT company_id FROM windowed)
        GROUP BY po.company_id
      )
      SELECT s.company_id
      FROM source s
      LEFT JOIN company_totals t ON t.company_id = s.company_id
      WHERE t.total_cents IS DISTINCT FROM s.total_cents
         OR t.approved_cents IS DISTINCT FROM s.approved_cents
         OR t.rejected_cents IS DISTINCT FROM s.rejected_cents
         OR t.order_count IS DISTINCT FROM s.order_count
    `;
    return {
      driftedOrderIds: driftedOrders.map((row) => row.id),
      driftedCompanyIds: [
        ...new Set([
          ...driftedOrders.map((row) => row.company_id),
          ...driftedTotals.map((row) => row.company_id),
        ]),
      ],
    };
  }
}
