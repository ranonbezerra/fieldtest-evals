import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OperationsFilter {
  companyId: string;
  status?: string;
  from: Date;
  to: Date;
}

export interface OperationViewRow {
  id: string;
  company_id: string;
  worker_id: string | null;
  worker_name: string | null;
  event_id: string | null;
  event_title: string | null;
  event_venue: string | null;
  event_starts_at: Date | null;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface TotalsRow {
  company_id: string;
  pending_cents: bigint;
  approved_cents: bigint;
  rejected_cents: bigint;
  completed_cents: bigint;
  cancelled_cents: bigint;
  pending_count: bigint;
  approved_count: bigint;
  rejected_count: bigint;
  completed_count: bigint;
  cancelled_count: bigint;
}

interface DayDigest {
  company_id: string;
  day: Date;
  n: bigint;
  s: bigint;
  h: string;
}

interface DriftKey {
  companyId: string;
  day: Date;
}

const VIEW_COLUMNS =
  'id, company_id, worker_id, worker_name, event_id, event_title, event_venue, event_starts_at, status, amount_cents, currency, created_at, updated_at';

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- dashboard read path ----------

  async findPage(filter: OperationsFilter, limit: number, offset: number): Promise<OperationViewRow[]> {
    const { where, params } = this.filterClauses(filter);
    params.push(limit, offset);
    const sql =
      `SELECT ${VIEW_COLUMNS} FROM operation_views WHERE ${where.join(' AND ')} ` +
      `ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return this.prisma.$queryRawUnsafe<OperationViewRow[]>(sql, ...params);
  }

  async count(filter: OperationsFilter): Promise<bigint> {
    const { where, params } = this.filterClauses(filter);
    const sql = `SELECT COUNT(*)::bigint AS total FROM operation_views WHERE ${where.join(' AND ')}`;
    const rows = await this.prisma.$queryRawUnsafe<{ total: bigint }[]>(sql, ...params);
    return rows[0]?.total ?? 0n;
  }

  async getTotals(companyId: string): Promise<TotalsRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<TotalsRow[]>(
      `SELECT company_id, pending_cents, approved_cents, rejected_cents, completed_cents, cancelled_cents,
              pending_count, approved_count, rejected_count, completed_count, cancelled_count
       FROM company_operation_totals WHERE company_id = $1`,
      companyId,
    );
    return rows[0] ?? null;
  }

  private filterClauses(filter: OperationsFilter): { where: string[]; params: (string | Date | number)[] } {
    const params: (string | Date | number)[] = [];
    const where: string[] = [];
    const add = (clause: string, value: string | Date | number): void => {
      params.push(value);
      where.push(`${clause} $${params.length}`);
    };
    add('company_id =', filter.companyId);
    if (filter.status !== undefined) add('status =', filter.status);
    add('created_at >=', filter.from);
    add('created_at <', filter.to);
    return { where, params };
  }

  // ---------- re-derivation ----------

  /**
   * Rebuilds the read model for `created_at ∈ [from, to)` (optionally
   * restricted to one company) from the source tables, in one transaction.
   * Idempotent: the projection is rebuilt from the source of truth, never
   * patched. Totals are all-time per company, so every company with an order
   * in the window is recomputed from its full order history.
   */
  async rederive(from: Date, to: Date, companyId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const companyClause = companyId !== undefined ? ' AND company_id = $3' : '';
      const sourceCompanyClause = companyId !== undefined ? ' AND o.company_id = $3' : '';
      const params: (Date | string)[] = companyId !== undefined ? [from, to, companyId] : [from, to];

      await tx.$executeRawUnsafe(
        `DELETE FROM operation_views WHERE created_at >= $1 AND created_at < $2${companyClause}`,
        ...params,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO operation_views (${VIEW_COLUMNS})
         SELECT o.id, o.company_id, o.worker_id, w.name, o.event_id, e.title, e.venue, e.starts_at,
                o.status, o.amount_cents, o.currency, o.created_at, o.updated_at
         FROM payment_orders o
         LEFT JOIN workers w ON w.id = o.worker_id
         LEFT JOIN events e ON e.id = o.event_id
         WHERE o.created_at >= $1 AND o.created_at < $2${sourceCompanyClause}`,
        ...params,
      );

      await tx.$executeRawUnsafe(
        `WITH affected AS (
           SELECT DISTINCT company_id FROM payment_orders
           WHERE created_at >= $1 AND created_at < $2${companyClause}
         )
         DELETE FROM company_operation_totals
         WHERE company_id IN (SELECT company_id FROM affected)`,
        ...params,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO company_operation_totals (company_id, pending_cents, approved_cents, rejected_cents, completed_cents, cancelled_cents,
                                               pending_count, approved_count, rejected_count, completed_count, cancelled_count, updated_at)
         SELECT p.company_id,
                COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'pending'), 0),
                COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'approved'), 0),
                COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'rejected'), 0),
                COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'completed'), 0),
                COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'cancelled'), 0),
                COALESCE(COUNT(*) FILTER (WHERE p.status = 'pending'), 0),
                COALESCE(COUNT(*) FILTER (WHERE p.status = 'approved'), 0),
                COALESCE(COUNT(*) FILTER (WHERE p.status = 'rejected'), 0),
                COALESCE(COUNT(*) FILTER (WHERE p.status = 'completed'), 0),
                COALESCE(COUNT(*) FILTER (WHERE p.status = 'cancelled'), 0),
                now()
         FROM payment_orders p
         WHERE p.company_id IN (
           SELECT DISTINCT company_id FROM payment_orders
           WHERE created_at >= $1 AND o.created_at < $2${companyClause}
         )
         GROUP BY p.company_id`,
        ...params,
      );
    });
  }

  // ---------- drift detection ----------

  /**
   * Per (company, UTC day) digest over the window: row count, cents and an
   * md5 over `id|status|cents|worker|event`, source vs view. The hash catches
   * status flips and denormalised-field staleness that count+sum would not.
   */
  async driftCheck(from: Date, to: Date): Promise<DriftKey[]> {
    const sourceDigests = await this.prisma.$queryRawUnsafe<DayDigest[]>(
      `SELECT o.company_id, date_trunc('day', o.created_at) AS day,
              COUNT(*) AS n,
              COALESCE(SUM(o.amount_cents), 0) AS s,
              md5(COALESCE(string_agg(o.id || '|' || o.status || '|' || o.amount_cents || '|' || COALESCE(w.name, '') || '|' || COALESCE(e.title, ''), ',' ORDER BY o.id), '')) AS h
       FROM payment_orders o
       LEFT JOIN workers w ON w.id = o.worker_id
       LEFT JOIN events e ON e.id = o.event_id
       WHERE o.created_at >= $1 AND o.created_at < $2
       GROUP BY o.company_id, date_trunc('day', o.created_at)`,
      from,
      to,
    );
    const viewDigests = await this.prisma.$queryRawUnsafe<DayDigest[]>(
      `SELECT company_id, date_trunc('day', created_at) AS day,
              COUNT(*) AS n,
              COALESCE(SUM(amount_cents), 0) AS s,
              md5(COALESCE(string_agg(id || '|' || status || '|' || amount_cents || '|' || COALESCE(worker_name, '') || '|' || COALESCE(event_title, ''), ',' ORDER BY id), '')) AS h
       FROM operation_views
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY company_id, date_trunc('day', created_at)`,
      from,
      to,
    );

    const sourceMap = new Map(sourceDigests.map((d) => [this.digestKey(d), this.digestSig(d)]));
    const viewMap = new Map(viewDigests.map((d) => [this.digestKey(d), this.digestSig(d)]));

    const drifted: DriftKey[] = [];
    const seen = new Set<string>();
    for (const [key, sig] of sourceMap) {
      seen.add(key);
      if (viewMap.get(key) !== sig) drifted.push(this.keyToDrift(key));
    }
    for (const [key] of viewMap) {
      if (seen.has(key)) continue;
      drifted.push(this.keyToDrift(key));
    }
    return drifted;
  }

  /** All-time per-company totals from the source vs the stored totals. */
  async companyTotalsDrift(): Promise<string[]> {
    const sourceRows = await this.prisma.$queryRawUnsafe<TotalsRow[]>(
      `SELECT company_id,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)   AS pending_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)  AS approved_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'rejected'), 0)  AS rejected_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'completed'), 0) AS completed_cents,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_cents,
              COALESCE(COUNT(*) FILTER (WHERE status = 'pending'), 0)            AS pending_count,
              COALESCE(COUNT(*) FILTER (WHERE status = 'approved'), 0)           AS approved_count,
              COALESCE(COUNT(*) FILTER (WHERE status = 'rejected'), 0)           AS rejected_count,
              COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0)          AS completed_count,
              COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled'), 0)          AS cancelled_count
       FROM payment_orders
       GROUP BY company_id`,
    );
    const storedRows = await this.prisma.$queryRawUnsafe<TotalsRow[]>(
      `SELECT company_id, pending_cents, approved_cents, rejected_cents, completed_cents, cancelled_cents,
              pending_count, approved_count, rejected_count, completed_count, cancelled_count
       FROM company_operation_totals`,
    );
    const sig = (r: TotalsRow): string =>
      [r.pending_cents, r.approved_cents, r.rejected_cents, r.completed_cents, r.cancelled_cents,
       r.pending_count, r.approved_count, r.rejected_count, r.completed_count, r.cancelled_count].join('|');
    const sourceMap = new Map(sourceRows.map((r) => [r.company_id, sig(r)]));
    const storedMap = new Map(storedRows.map((r) => [r.company_id, sig(r)]));
    const drifted = new Set<string>();
    for (const [companyId, s] of sourceMap) {
      if (storedMap.get(companyId) !== s) drifted.add(companyId);
    }
    for (const [companyId, s] of storedMap) {
      if (sourceMap.get(companyId) !== s) drifted.add(companyId);
    }
    return [...drifted];
  }

  /** The created_at range of a company's orders, or null when it has none. */
  async companyOrderRange(companyId: string): Promise<{ min: Date; max: Date } | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ min: Date | null; max: Date | null }[]>(
      `SELECT MIN(created_at) AS min, MAX(created_at) AS max FROM payment_orders WHERE company_id = $1`,
      companyId,
    );
    const row = rows[0];
    if (row === undefined || row.min === null || row.max === null) return null;
    return { min: row.min, max: row.max };
  }

  /** Removes a company's stale projection state when no source orders remain. */
  async dropCompanyProjection(companyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM operation_views WHERE company_id = $1`, companyId);
      await tx.$executeRawUnsafe(`DELETE FROM company_operation_totals WHERE company_id = $1`, companyId);
    });
  }

  private digestKey(d: DayDigest): string {
    return `${d.company_id}|${new Date(d.day).toISOString()}`;
  }

  private digestSig(d: DayDigest): string {
    return `${d.n}|${d.s}|${d.h}`;
  }

  private keyToDrift(key: string): DriftKey {
    const idx = key.indexOf('|');
    return { companyId: key.slice(0, idx), day: new Date(key.slice(idx + 1)) };
  }
}
