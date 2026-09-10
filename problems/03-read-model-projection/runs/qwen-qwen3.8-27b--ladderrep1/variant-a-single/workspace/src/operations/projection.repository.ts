import { Injectable } from '@nestjs/common';
import {
  CompanyFinancialTotalsCreateInput,
  CompanyFinancialTotalsUpdateInput,
  OperationRow,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OrderRowInput {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LatestEventInput {
  id: string;
  paymentOrderId: string;
  eventType: string;
  occurredAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amountCents: number;
}

type Tx = Prisma.TransactionClient;

// Fixed status → totals-column mapping. The only place projection SQL is assembled;
// identifiers come from this table, values are always bound parameters.
const TOTALS_FIELDS: Record<OrderStatus, { amount: string; count: string }> = {
  pending: { amount: 'pendingAmountCents', count: 'pendingCount' },
  approved: { amount: 'approvedAmountCents', count: 'approvedCount' },
  disputed: { amount: 'disputedAmountCents', count: 'disputedCount' },
  cancelled: { amount: 'cancelledAmountCents', count: 'cancelledCount' },
};

/**
 * The only layer that writes the read-model tables. Called exclusively from
 * maintenance hooks that already run inside the writer's transaction.
 */
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Hook: upsert the order's operation row. The worker name is re-read from the
   * source inside the statement so the row is always a faithful denormalization. */
  async upsertOperationRow(tx: Tx, order: OrderRowInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency, created_at, updated_at
      )
      VALUES (
        ${order.paymentOrderId}, ${order.companyId}, ${order.status}::"OrderStatus",
        (SELECT name FROM workers WHERE id = ${order.workerId}),
        ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt}
      )
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id   = excluded.company_id,
        status       = excluded.status,
        worker_name  = excluded.worker_name,
        amount_cents = excluded.amount_cents,
        currency     = excluded.currency,
        updated_at   = excluded.updated_at
    `;
  }

  /**
   * Hook: apply an exact in-place delta to the company's totals row.
   *
   * The row is never read-modify-written in app code: the create branch inserts
   * the delta, the update branch uses atomic increment/decrement, so concurrent
   * writers to the same company serialize on the row lock and no update is lost.
   */
  async applyTotalsDelta(tx: Tx, delta: TotalsDelta): Promise<void> {
    const to = TOTALS_FIELDS[delta.toStatus];

    const create = { companyId: delta.companyId, updatedAt: new Date() } as CompanyFinancialTotalsCreateInput;
    (create as Record<string, unknown>)[to.amount] = delta.amountCents;
    (create as Record<string, unknown>)[to.count] = 1;

    const update = { updatedAt: new Date() } as CompanyFinancialTotalsUpdateInput;
    (update as Record<string, unknown>)[to.amount] = { increment: delta.amountCents };
    (update as Record<string, unknown>)[to.count] = { increment: 1 };
    if (delta.fromStatus && delta.fromStatus !== delta.toStatus) {
      const from = TOTALS_FIELDS[delta.fromStatus];
      (update as Record<string, unknown>)[from.amount] = { decrement: delta.amountCents };
      (update as Record<string, unknown>)[from.count] = { decrement: 1 };
    }

    await tx.companyFinancialTotals.upsert({ where: { companyId: delta.companyId }, create, update });
  }

  /** Hook: set the order's latest event, but only if the new event is strictly newer
   * (occurred_at, id) than the current one. Never touches the row's updated_at. */
  async applyLatestEvent(tx: Tx, event: LatestEventInput): Promise<void> {
    await tx.$executeRaw`
      UPDATE operation_rows
      SET latest_event_type = ${event.eventType},
          latest_event_at   = ${event.occurredAt},
          latest_event_id   = ${event.id}
      WHERE payment_order_id = ${event.paymentOrderId}
        AND (latest_event_id IS NULL OR (${event.occurredAt}, ${event.id}) > (latest_event_at, latest_event_id))
    `;
  }

  async findOperationRow(tx: Tx, paymentOrderId: string): Promise<OperationRow | null> {
    return tx.operationRow.findUnique({ where: { paymentOrderId } });
  }

  /**
   * Re-derivation: rebuild operation_rows from the source tables for orders created in [from, to).
   * Set-based and idempotent — the result depends only on the current source state, so running it
   * twice leaves the same result; running it while live is safe because writes that commit after
   * the snapshot are re-applied by the hooks. Returns the number of rows written.
   */
  async rederiveWindow(tx: Tx, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, event_type, occurred_at, id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency,
        latest_event_type, latest_event_at, latest_event_id,
        created_at, updated_at
      )
      SELECT
             o.id, o.company_id, o.status, w.name,
             o.amount_cents, o.currency,
             le.event_type, le.occurred_at, le.id,
             o.created_at, o.updated_at
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id        = excluded.company_id,
        status            = excluded.status,
        worker_name       = excluded.worker_name,
        amount_cents      = excluded.amount_cents,
        currency          = excluded.currency,
        latest_event_type = excluded.latest_event_type,
        latest_event_at   = excluded.latest_event_at,
        latest_event_id   = excluded.latest_event_id,
        created_at        = excluded.created_at,
        updated_at        = excluded.updated_at
    `;
    return Number(affected);
  }

  /**
   * Recompute company_financial_totals from scratch, for every company with orders.
   * Idempotent: the result depends only on the current source state. Totals are global
   * (not windowable), so they are always rebuilt as a whole.
   */
  async recomputeTotals(tx: Tx): Promise<void> {
    await tx.$executeRaw`
      WITH agg AS (
        SELECT company_id,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)   AS pending_amount_cents,
               COUNT(*) FILTER (WHERE status = 'pending')                         AS pending_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)  AS approved_amount_cents,
               COUNT(*) FILTER (WHERE status = 'approved')                        AS approved_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'disputed'), 0)  AS disputed_amount_cents,
               COUNT(*) FILTER (WHERE status = 'disputed')                        AS disputed_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_amount_cents,
               COUNT(*) FILTER (WHERE status = 'cancelled')                       AS cancelled_count
        FROM payment_orders
        GROUP BY company_id
      )
      INSERT INTO company_financial_totals (
        company_id,
        pending_amount_cents, pending_count,
        approved_amount_cents, approved_count,
        disputed_amount_cents, disputed_count,
        cancelled_amount_cents, cancelled_count,
        updated_at
      )
      SELECT company_id,
             pending_amount_cents, pending_count,
             approved_amount_cents, approved_count,
             disputed_amount_cents, disputed_count,
             cancelled_amount_cents, cancelled_count,
             now()
      FROM agg
      ON CONFLICT (company_id) DO UPDATE SET
        pending_amount_cents   = excluded.pending_amount_cents,
        pending_count          = excluded.pending_count,
        approved_amount_cents  = excluded.approved_amount_cents,
        approved_count         = excluded.approved_count,
        disputed_amount_cents  = excluded.disputed_amount_cents,
        disputed_count         = excluded.disputed_count,
        cancelled_amount_cents = excluded.cancelled_amount_cents,
        cancelled_count        = excluded.cancelled_count,
        updated_at             = excluded.updated_at
    `;
    await tx.$executeRaw`
      DELETE FROM company_financial_totals cft
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = cft.company_id)
    `;
  }

  /** Orders created in [from, to) whose operation row is missing or disagrees with the source. */
  async findDriftedOrderIds(tx: Tx, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, id AS event_id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      SELECT o.id
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN operation_rows r ON r.payment_order_id = o.id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
        AND (
          r.id IS NULL
          OR r.status IS DISTINCT FROM o.status
          OR r.company_id IS DISTINCT FROM o.company_id
          OR r.worker_name IS DISTINCT FROM w.name
          OR r.amount_cents IS DISTINCT FROM o.amount_cents
          OR r.currency IS DISTINCT FROM o.currency
          OR r.latest_event_id IS DISTINCT FROM le.event_id
        )
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Companies whose totals row is missing, left for a company with no orders, or disagrees
   * with the source aggregate. Scoped to companies with activity in [from, to).
   */
  async findTotalsDriftedCompanyIds(tx: Tx, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ company_id: string }[]>`
      SELECT company_id
      FROM (
        SELECT DISTINCT po.company_id
        FROM payment_orders po
        WHERE po.created_at >= ${from} OR po.updated_at >= ${from}
      ) active
      WHERE active.company_id NOT IN (SELECT company_id FROM company_financial_totals)
         OR EXISTS (
           SELECT 1
           FROM company_financial_totals t
           WHERE t.company_id = active.company_id
             AND NOT EXISTS (
               SELECT 1
               FROM (
                 SELECT po2.company_id,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'pending'), 0)   AS pending_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'pending')                             AS pending_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'approved'), 0)  AS approved_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'approved')                            AS approved_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'disputed'), 0)  AS disputed_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'disputed')                            AS disputed_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'cancelled'), 0) AS cancelled_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'cancelled')                           AS cancelled_count
                 FROM payment_orders po2
                 WHERE po2.company_id = active.company_id
                 GROUP BY po2.company_id
               ) s
               WHERE s.pending_amount   IS DISTINCT FROM t.pending_amount_cents
                  OR s.pending_count    IS DISTINCT FROM t.pending_count
                  OR s.approved_amount  IS DISTINCT FROM t.approved_amount_cents
                  OR s.approved_count   IS DISTINCT FROM t.approved_count
                  OR s.disputed_amount  IS DISTINCT FROM t.disputed_amount_cents
                  OR s.disputed_count   IS DISTINCT FROM t.disputed_count
                  OR s.cancelled_amount IS DISTINCT FROM t.cancelled_amount_cents
                  OR s.cancelled_count  IS DISTINCT FROM t.cancelled_count
             )
         )
      UNION
      SELECT t.company_id
      FROM company_financial_totals t
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = t.company_id)
    `;
    return rows.map((row) => row.company_id);
  }
}
