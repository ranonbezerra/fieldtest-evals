import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import type { OrderStatus } from '../orders/orders.repository.js';

type Tx = Prisma.TransactionClient;

export interface DriftSummary {
  /** Source orders in the window whose projection row is missing or differs. */
  operationsStale: number;
  /** Projection rows in the window whose source order no longer exists. */
  operationsOrphan: number;
  /** Companies whose totals row is wrong or missing for the window. */
  totalsCompanies: string[];
}

@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* --------------------------------------------------------------------- *
   * Maintenance hooks.
   * Called by the write services on the write's own transaction client, so
   * each hook commits or rolls back atomically with the source write.
   * --------------------------------------------------------------------- */

  async onOrderCreated(tx: Tx, input: { id: string; companyId: string; amountCents: bigint }): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO op_operations (id, company_id, worker_id, worker_name, status, amount_cents, last_event_type, last_event_at, created_at, updated_at)
      SELECT o.id, o.company_id, o.worker_id, w.name, o.status, o.amount_cents, le.event_type, le.occurred_at, o.created_at, o.updated_at
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN LATERAL (
        SELECT e.type AS event_type, e.occurred_at
        FROM events e
        WHERE e.company_id = o.company_id
          AND e.worker_id = o.worker_id
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT 1
      ) le ON true
      WHERE o.id = ${input.id}`;

    await tx.$executeRaw`
      INSERT INTO company_totals (company_id, orders_count, pending_count, pending_amount_cents, updated_at)
      VALUES (${input.companyId}, 1, 1, ${input.amountCents}, now())
      ON CONFLICT (company_id) DO UPDATE
      SET orders_count = company_totals.orders_count + 1,
          pending_count = company_totals.pending_count + 1,
          pending_amount_cents = company_totals.pending_amount_cents + ${input.amountCents},
          updated_at = now()`;
  }

  async onOrderStatusChanged(
    tx: Tx,
    input: { id: string; companyId: string; amountCents: bigint; from: OrderStatus; to: OrderStatus },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE op_operations
      SET status = ${input.to},
          updated_at = now()
      WHERE id = ${input.id}`;

    // In-place increments (atomic at the database level), never a
    // read-modify-write: concurrent transitions on the same company cannot
    // lose one another's contribution.
    await tx.$executeRaw`
      UPDATE company_totals
      SET approved_count = approved_count + (CASE WHEN ${input.to} = 'approved' THEN 1 WHEN ${input.from} = 'approved' THEN -1 ELSE 0 END),
          approved_amount_cents = approved_amount_cents + ${input.amountCents} * (CASE WHEN ${input.to} = 'approved' THEN 1 WHEN ${input.from} = 'approved' THEN -1 ELSE 0 END),
          pending_count = pending_count + (CASE WHEN ${input.to} = 'pending' THEN 1 WHEN ${input.from} = 'pending' THEN -1 ELSE 0 END),
          pending_amount_cents = pending_amount_cents + ${input.amountCents} * (CASE WHEN ${input.to} = 'pending' THEN 1 WHEN ${input.from} = 'pending' THEN -1 ELSE 0 END),
          rejected_count = rejected_count + (CASE WHEN ${input.to} = 'rejected' THEN 1 WHEN ${input.from} = 'rejected' THEN -1 ELSE 0 END),
          rejected_amount_cents = rejected_amount_cents + ${input.amountCents} * (CASE WHEN ${input.to} = 'rejected' THEN 1 WHEN ${input.from} = 'rejected' THEN -1 ELSE 0 END),
          updated_at = now()
      WHERE company_id = ${input.companyId}`;
  }

  async onEventLogged(
    tx: Tx,
    input: { companyId: string; workerId: string; type: string; occurredAt: Date },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE op_operations
      SET last_event_type = ${input.type},
          last_event_at = ${input.occurredAt}
      WHERE company_id = ${input.companyId}
        AND worker_id = ${input.workerId}
        AND (last_event_at IS NULL OR last_event_at <= ${input.occurredAt})`;
  }

  /* --------------------------------------------------------------------- *
   * Re-derivation / repair
   * --------------------------------------------------------------------- */

  /**
   * Rebuilds the projection for [from, to) from source, in one transaction
   * (READ COMMITTED):
   *   1. locks the totals rows of every affected company (in sorted order),
   *      serializing with live writers — a concurrent hook blocks until this
   *      transaction commits, then applies its increment on top of the
   *      recomputed value; a writer that committed earlier is already included
   *      in the recompute. Either way the final totals are exact.
   *   2. deletes the window's op_operations rows and re-projects them from
   *      source (delete + insert => running it twice is a no-op).
   *   3. recomputes the exact totals of each affected company from source.
   */
  async rebuildWindow(from: Date, to: Date, extraCompanyIds: readonly string[] = []): Promise<{ companies: number; operationsRows: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        const affected = await tx.$queryRaw<Array<{ company_id: string }>>`
          SELECT DISTINCT company_id
          FROM payment_orders
          WHERE created_at >= ${from} AND created_at < ${to}
          ORDER BY company_id`;

        // Sorted order so concurrent rebuilds lock rows in the same order (no deadlock).
        const companies = Array.from(new Set([...affected.map((row) => row.company_id), ...extraCompanyIds])).sort();

        for (const companyId of companies) {
          await tx.$executeRaw`
            INSERT INTO company_totals (company_id, updated_at)
            VALUES (${companyId}, now())
            ON CONFLICT (company_id) DO NOTHING`;
          await tx.$executeRaw`
            SELECT 1 FROM company_totals WHERE company_id = ${companyId} FOR UPDATE`;
        }

        await tx.$executeRaw`
          DELETE FROM op_operations
          WHERE created_at >= ${from} AND created_at < ${to}`;

        const operationsRows = await tx.$executeRaw`
          INSERT INTO op_operations (id, company_id, worker_id, worker_name, status, amount_cents, last_event_type, last_event_at, created_at, updated_at)
          SELECT o.id, o.company_id, o.worker_id, w.name, o.status, o.amount_cents, le.event_type, le.occurred_at, o.created_at, o.updated_at
          FROM payment_orders o
          JOIN workers w ON w.id = o.worker_id
          LEFT JOIN LATERAL (
            SELECT e.type AS event_type, e.occurred_at
            FROM events e
            WHERE e.company_id = o.company_id
              AND e.worker_id = o.worker_id
            ORDER BY e.occurred_at DESC, e.id DESC
            LIMIT 1
          ) le ON true
          WHERE o.created_at >= ${from} AND o.created_at < ${to}`;

        for (const companyId of companies) {
          await tx.$executeRaw`
            INSERT INTO company_totals (company_id, orders_count, approved_count, approved_amount_cents, pending_count, pending_amount_cents, rejected_count, rejected_amount_cents, updated_at)
            SELECT
              ${companyId},
              count(*),
              count(*) FILTER (WHERE status = 'approved'),
              coalesce(sum(amount_cents) FILTER (WHERE status = 'approved'), 0),
              count(*) FILTER (WHERE status = 'pending'),
              coalesce(sum(amount_cents) FILTER (WHERE status = 'pending'), 0),
              count(*) FILTER (WHERE status = 'rejected'),
              coalesce(sum(amount_cents) FILTER (WHERE status = 'rejected'), 0),
              now()
            FROM payment_orders
            WHERE company_id = ${companyId}
            ON CONFLICT (company_id) DO UPDATE SET
              orders_count = EXCLUDED.orders_count,
              approved_count = EXCLUDED.approved_count,
              approved_amount_cents = EXCLUDED.approved_amount_cents,
              pending_count = EXCLUDED.pending_count,
              pending_amount_cents = EXCLUDED.pending_amount_cents,
              rejected_count = EXCLUDED.rejected_count,
              rejected_amount_cents = EXCLUDED.rejected_amount_cents,
              updated_at = EXCLUDED.updated_at`;
        }

        return { companies: companies.length, operationsRows: Number(operationsRows) };
      },
      { timeout: 60_000 },
    );
  }

  /** Compares the projection against source for [from, to). Read-only. */
  async findDrift(from: Date, to: Date): Promise<DriftSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        const [stale] = await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n
          FROM payment_orders o
          WHERE o.created_at >= ${from} AND o.created_at < ${to}
            AND NOT EXISTS (
              SELECT 1
              FROM op_operations p
              JOIN workers w ON w.id = o.worker_id
              LEFT JOIN LATERAL (
                SELECT e.type AS event_type, e.occurred_at
                FROM events e
                WHERE e.company_id = o.company_id
                  AND e.worker_id = o.worker_id
                ORDER BY e.occurred_at DESC, e.id DESC
                LIMIT 1
              ) le ON true
              WHERE p.id = o.id
                AND p.company_id = o.company_id
                AND p.worker_id = o.worker_id
                AND p.status = o.status
                AND p.amount_cents = o.amount_cents
                AND p.worker_name = w.name
                AND p.last_event_type IS NOT DISTINCT FROM le.event_type
                AND p.last_event_at IS NOT DISTINCT FROM le.occurred_at
            )`;

        const [orphan] = await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n
          FROM op_operations p
          WHERE p.created_at >= ${from} AND p.created_at < ${to}
            AND NOT EXISTS (SELECT 1 FROM payment_orders o WHERE o.id = p.id)`;

        const mismatchedTotals = await tx.$queryRaw<Array<{ company_id: string }>>`
          SELECT t.company_id
          FROM company_totals t
          WHERE EXISTS (
            SELECT 1 FROM payment_orders o
            WHERE o.company_id = t.company_id
              AND o.created_at >= ${from} AND o.created_at < ${to}
          )
            AND (
              t.orders_count <> (SELECT count(*) FROM payment_orders o WHERE o.company_id = t.company_id)
              OR t.approved_count <> (SELECT count(*) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'approved')
              OR t.approved_amount_cents <> coalesce((SELECT sum(o.amount_cents) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'approved'), 0)
              OR t.pending_count <> (SELECT count(*) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'pending')
              OR t.pending_amount_cents <> coalesce((SELECT sum(o.amount_cents) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'pending'), 0)
              OR t.rejected_count <> (SELECT count(*) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'rejected')
              OR t.rejected_amount_cents <> coalesce((SELECT sum(o.amount_cents) FROM payment_orders o WHERE o.company_id = t.company_id AND o.status = 'rejected'), 0)
            )
          ORDER BY t.company_id`;

        const missingTotals = await tx.$queryRaw<Array<{ company_id: string }>>`
          SELECT DISTINCT o.company_id
          FROM payment_orders o
          WHERE o.created_at >= ${from} AND o.created_at < ${to}
            AND NOT EXISTS (SELECT 1 FROM company_totals t WHERE t.company_id = o.company_id)
          ORDER BY o.company_id`;

        const orphanCompanies = await tx.$queryRaw<Array<{ company_id: string }>>`
          SELECT DISTINCT p.company_id
          FROM op_operations p
          WHERE p.created_at >= ${from} AND p.created_at < ${to}
            AND NOT EXISTS (SELECT 1 FROM payment_orders o WHERE o.id = p.id)
          ORDER BY p.company_id`;

        const totalsCompanies = Array.from(
          new Set([
            ...mismatchedTotals.map((row) => row.company_id),
            ...missingTotals.map((row) => row.company_id),
            ...orphanCompanies.map((row) => row.company_id),
          ]),
        );

        return {
          operationsStale: Number(stale?.n ?? 0n),
          operationsOrphan: Number(orphan?.n ?? 0n),
          totalsCompanies,
        };
      },
      { timeout: 60_000 },
    );
  }
}
