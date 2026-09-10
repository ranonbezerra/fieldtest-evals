import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { zeroTotals } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status, TotalsDelta } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

/** Either the pool client or a transaction client; both speak the same raw SQL. */
type Db = PrismaClient | Prisma.TransactionClient;

type RawOperationRow = {
  order_id: number;
  company_id: number;
  worker_id: number;
  worker_name: string | null;
  status: string;
  amount_cents: number;
  last_event_kind: string | null;
  created_at: Date;
  total: string;
};

function mapOperationRow(r: Record<string, unknown>): OperationRowData {
  return {
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    workerId: Number(r.worker_id),
    workerName: (r.worker_name as string | null) ?? null,
    status: r.status as Status,
    amountCents: Number(r.amount_cents),
    lastEventKind: (r.last_event_kind as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

function mapCompanyTotals(companyId: number, r?: Record<string, unknown>): CompanyTotalsData {
  if (!r) return zeroTotals(companyId);
  return {
    companyId,
    pendingCount: Number(r.pending_count),
    pendingAmountCents: Number(r.pending_amount),
    approvedCount: Number(r.approved_count),
    approvedAmountCents: Number(r.approved_amount),
    rejectedCount: Number(r.rejected_count),
    rejectedAmountCents: Number(r.rejected_amount),
    refundedCount: Number(r.refunded_count),
    refundedAmountCents: Number(r.refunded_amount),
    version: Number(r.version),
  };
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The dashboard query. Reads only the projection; the covering index
   * (company_id, status, created_at DESC, order_id DESC) INCLUDE (...) makes
   * this an index-only scan. count(*) OVER () returns the filtered total in
   * the same round-trip.
   */
  async listOperations(
    q: { companyId: number; statuses: readonly Status[]; from: Date; to: Date; limit: number; offset: number },
    db: Db = this.prisma,
  ): Promise<{ items: OperationRowData[]; total: number }> {
    // ASSUMPTION: "recency" means the order's creation time; created_at DESC
    // with order_id DESC as tie-break gives deterministic pages.
    const rows = await db.$queryRaw<RawOperationRow[]>(
      Prisma.sql`
        SELECT order_id, company_id, worker_id, worker_name, status, amount_cents,
               last_event_kind, created_at,
               count(*) OVER () AS total
        FROM operations_read_model
        WHERE company_id = ${q.companyId}
          AND status = ANY(${q.statuses})
          AND created_at >= ${q.from}
          AND created_at < ${q.to}
        ORDER BY created_at DESC, order_id DESC
        LIMIT ${q.limit} OFFSET ${q.offset}
      `,
    );
    return { items: rows.map(mapOperationRow), total: rows.length > 0 ? Number(rows[0].total) : 0 };
  }

  /** Exact per-company totals, straight from the maintained totals row. */
  async getCompanyTotals(companyId: number, db: Db = this.prisma): Promise<CompanyTotalsData> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
               rejected_count, rejected_amount, refunded_count, refunded_amount, version
        FROM company_totals
        WHERE company_id = ${companyId}
      `,
    );
    return mapCompanyTotals(companyId, rows[0]);
  }

  /** Recompute one projection row from the source (order + worker + latest event). */
  async recomputeOperationRow(orderId: number, db: Db = this.prisma): Promise<OperationRowData | null> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT po.id AS order_id, po.company_id, po.worker_id, w.name AS worker_name,
               po.status, po.amount_cents, po.created_at,
               (SELECT oe.kind
                  FROM order_events oe
                 WHERE oe.order_id = po.id
                 ORDER BY oe.created_at DESC, oe.id DESC
                 LIMIT 1) AS last_event_kind
        FROM payment_orders po
        LEFT JOIN workers w ON w.id = po.worker_id
        WHERE po.id = ${orderId}
      `,
    );
    return rows.length > 0 ? mapOperationRow(rows[0]) : null;
  }

  /** Absolute-value upsert of one projection row; safe to run any number of times. */
  async upsertOperationRow(row: OperationRowData, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO operations_read_model
          (order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at)
        VALUES
          (${row.orderId}, ${row.companyId}, ${row.workerId}, ${row.workerName}, ${row.status},
           ${row.amountCents}, ${row.lastEventKind}, ${row.createdAt}, now())
        ON CONFLICT (order_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          worker_id = EXCLUDED.worker_id,
          worker_name = EXCLUDED.worker_name,
          status = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          last_event_kind = EXCLUDED.last_event_kind,
          created_at = EXCLUDED.created_at,
          maintained_at = now()
      `,
    );
  }

  /**
   * Atomic in-place totals adjustment. The delta is added by the same
   * statement that creates the row, so two concurrent writers to the same
   * company row both apply — Postgres serializes them on the row lock and
   * neither increment is lost.
   */
  async applyTotalsDelta(companyId: number, d: TotalsDelta, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        VALUES
          (${companyId}, ${d.pending.count}, ${d.pending.amountCents}, ${d.approved.count},
           ${d.approved.amountCents}, ${d.rejected.count}, ${d.rejected.amountCents},
           ${d.refunded.count}, ${d.refunded.amountCents}, 1, now())
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = company_totals.pending_count + EXCLUDED.pending_count,
          pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount,
          approved_count = company_totals.approved_count + EXCLUDED.approved_count,
          approved_amount = company_totals.approved_amount + EXCLUDED.approved_amount,
          rejected_count = company_totals.rejected_count + EXCLUDED.rejected_count,
          rejected_amount = company_totals.rejected_amount + EXCLUDED.rejected_amount,
          refunded_count = company_totals.refunded_count + EXCLUDED.refunded_count,
          refunded_amount = company_totals.refunded_amount + EXCLUDED.refunded_amount,
          version = company_totals.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Absolute-value recomputation of the totals rows for the given companies. */
  async recomputeCompanyTotals(companyIds: readonly number[], db: Db = this.prisma): Promise<void> {
    if (companyIds.length === 0) return;
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals AS ct
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        SELECT po.company_id,
               count(*) FILTER (WHERE po.status = 'pending'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0),
               count(*) FILTER (WHERE po.status = 'approved'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
               count(*) FILTER (WHERE po.status = 'rejected'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
               count(*) FILTER (WHERE po.status = 'refunded'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0),
               1,
               now()
        FROM payment_orders po
        WHERE po.company_id = ANY(${companyIds})
        GROUP BY po.company_id
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = EXCLUDED.pending_count,
          pending_amount = EXCLUDED.pending_amount,
          approved_count = EXCLUDED.approved_count,
          approved_amount = EXCLUDED.approved_amount,
          rejected_count = EXCLUDED.rejected_count,
          rejected_amount = EXCLUDED.rejected_amount,
          refunded_count = EXCLUDED.refunded_count,
          refunded_amount = EXCLUDED.refunded_amount,
          version = ct.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Source orders in the window, id-ordered for cursor batching. */
  async sourceOrdersInWindow(
    from: Date,
    to: Date,
    afterOrderId: number,
    limit: number,
    db: Db = this.prisma,
  ): Promise<Array<{ orderId: number; companyId: number }>> {
    const rows = await db.$queryRaw<Array<{ id: number; company_id: number }>>(
      Prisma.sql`
        SELECT id, company_id
        FROM payment_orders
        WHERE created_at >= ${from}
          AND created_at < ${to}
          AND id > ${afterOrderId}
        ORDER BY id
        LIMIT ${limit}
      `,
    );
    return rows.map((r) => ({ orderId: r.id, companyId: r.company_id }));
  }

  /**
   * One re-derivation batch: upsert the projection rows for a batch of orders
   * and recompute the affected companies' totals, in a short transaction.
   * Idempotent — running it any number of times converges to the source state.
   */
  async rederiveBatch(
    from: Date,
    to: Date,
    afterOrderId: number,
    limit: number,
  ): Promise<Array<{ orderId: number; companyId: number }>> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.sourceOrdersInWindow(from, to, afterOrderId, limit, tx);
      for (const b of batch) {
        const row = await this.recomputeOperationRow(b.orderId, tx);
        if (row) await this.upsertOperationRow(row, tx);
      }
      await this.recomputeCompanyTotals([...new Set(batch.map((b) => b.companyId))], tx);
      return batch;
    });
  }

  /** Projection rows in the window that disagree with the source (including missing rows). */
  async countDriftedOrders(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH expected AS (
          SELECT po.id AS order_id, po.status, po.amount_cents, po.created_at, po.worker_id,
                 w.name AS worker_name,
                 (SELECT oe.kind
                    FROM order_events oe
                   WHERE oe.order_id = po.id
                   ORDER BY oe.created_at DESC, oe.id DESC
                   LIMIT 1) AS last_event_kind
          FROM payment_orders po
          LEFT JOIN workers w ON w.id = po.worker_id
          WHERE po.created_at >= ${from}
            AND po.created_at < ${to}
        )
        SELECT count(*) AS drifted
        FROM expected e
        LEFT JOIN operations_read_model r ON r.order_id = e.order_id
        WHERE r.order_id IS NULL
           OR r.status IS DISTINCT FROM e.status
           OR r.amount_cents IS DISTINCT FROM e.amount_cents
           OR r.created_at IS DISTINCT FROM e.created_at
           OR r.worker_id IS DISTINCT FROM e.worker_id
           OR r.worker_name IS DISTINCT FROM e.worker_name
           OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }

  /** Companies (with orders in the window) whose totals row disagrees with the source. */
  async countDriftedCompanies(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH windowed AS (
          SELECT DISTINCT company_id
          FROM payment_orders
          WHERE created_at >= ${from}
            AND created_at < ${to}
        ),
        actual AS (
          SELECT po.company_id,
                 count(*) FILTER (WHERE po.status = 'pending') AS pending_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0) AS pending_amount,
                 count(*) FILTER (WHERE po.status = 'approved') AS approved_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_amount,
                 count(*) FILTER (WHERE po.status = 'rejected') AS rejected_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_amount,
                 count(*) FILTER (WHERE po.status = 'refunded') AS refunded_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0) AS refunded_amount
          FROM payment_orders po
          JOIN windowed w ON w.company_id = po.company_id
          GROUP BY po.company_id
        )
        SELECT count(*) AS drifted
        FROM actual a
        LEFT JOIN company_totals t ON t.company_id = a.company_id
        WHERE t.company_id IS NULL
           OR t.pending_count IS DISTINCT FROM a.pending_count
           OR t.pending_amount IS DISTINCT FROM a.pending_amount
           OR t.approved_count IS DISTINCT FROM a.approved_count
           OR t.approved_amount IS DISTINCT FROM a.approved_amount
           OR t.rejected_count IS DISTINCT FROM a.rejected_count
           OR t.rejected_amount IS DISTINCT FROM a.rejected_amount
           OR t.refunded_count IS DISTINCT FROM a.refunded_count
           OR t.refunded_amount IS DISTINCT FROM a.refunded_amount
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }
}
