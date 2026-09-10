import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OpRowSnapshot {
  id: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  totalDelta: number;
  approvedDelta: number;
  rejectedDelta: number;
  countDelta: number;
}

export interface RederiveResult {
  rowsRebuilt: number;
  companiesRecomputed: number;
}

/**
 * The only layer that writes the projection tables.
 *
 * Amounts cross into raw SQL as numbers: at this scale (integer cents;
 * company totals at most a few hundred trillion cents) they stay far below
 * 2^53, while the columns themselves remain BIGINT.
 */
@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs?: number): Promise<T> {
    return timeoutMs === undefined
      ? this.db.$transaction(fn)
      : this.db.$transaction(fn, { timeout: timeoutMs });
  }

  /**
   * Idempotent upsert of one order's projection row. Names are kept from the
   * existing row when the caller has none (status changes do not rename the
   * worker or the event).
   */
  upsertOpRow(tx: Prisma.TransactionClient, row: OpRowSnapshot): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
        VALUES (${row.id}, ${row.companyId}, ${row.status}, ${row.amountCents}, ${row.occurredAt}, ${row.workerName}, ${row.eventName}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          company_id   = EXCLUDED.company_id,
          status       = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          occurred_at  = EXCLUDED.occurred_at,
          worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
          event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
          updated_at   = EXCLUDED.updated_at
      `
      .then(() => undefined);
  }

  updateOpRowStatus(tx: Prisma.TransactionClient, id: string, status: string, at: Date): Promise<void> {
    return tx
      .$executeRaw`
        UPDATE ops_rows
        SET status = ${status},
            occurred_at = ${at},
            updated_at = ${at}
        WHERE id = ${id}
      `
      .then(() => undefined);
  }

  /**
   * Atomic in-place totals update. Concurrent updates to the same company
   * serialize on the row lock; because there is no read-modify-write, none
   * of them can be lost.
   */
  applyTotalsDelta(tx: Prisma.TransactionClient, d: TotalsDelta): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
        VALUES (${d.companyId}, ${d.totalDelta}, ${d.approvedDelta}, ${d.rejectedDelta}, ${d.countDelta})
        ON CONFLICT (company_id) DO UPDATE SET
          total_cents    = company_totals.total_cents + EXCLUDED.total_cents,
          approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
          rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
          order_count    = company_totals.order_count + EXCLUDED.order_count
      `
      .then(() => undefined);
  }

  /**
   * Rebuild the projection for orders whose `updated_at` falls in
   * [from, to]: re-derive every row in the window straight from the source
   * tables and recompute the exact totals of every company the window
   * touches. Every statement is idempotent, so the routine is safe to run
   * while the system is live, and running it twice over the same window
   * leaves the same result.
   */
  async rederiveWindow(tx: Prisma.TransactionClient, from: Date, to: Date): Promise<RederiveResult> {
    const rowsRebuilt = await tx.$executeRaw`
      INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
      SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.title, po.created_at, po.updated_at
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      LEFT JOIN events e ON e.id = po.event_id
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
      ON CONFLICT (id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
        event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
        updated_at   = EXCLUDED.updated_at
    `;
    const companiesRecomputed = await tx.$executeRaw`
      INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
      SELECT po.company_id,
             COALESCE(SUM(po.amount_cents), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
             COUNT(*)
      FROM payment_orders po
      WHERE po.company_id IN (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      )
      GROUP BY po.company_id
      ON CONFLICT (company_id) DO UPDATE SET
        total_cents    = EXCLUDED.total_cents,
        approved_cents = EXCLUDED.approved_cents,
        rejected_cents = EXCLUDED.rejected_cents,
        order_count    = EXCLUDED.order_count
    `;
    return { rowsRebuilt: Number(rowsRebuilt), companiesRecomputed: Number(companiesRecomputed) };
  }
}
