import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * SERIALIZABLE so a concurrent writer cannot slip a commit between our
   * source read and our projection write without a detectable conflict; the
   * service retries on serialization failure.
   */
  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  /** Re-creates the window's rows with the same joins the old dashboard query used. */
  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  /**
   * Whole-history rebuild of the per-company totals. The totals are global
   * aggregates, so only a full recompute (never a window delta) is
   * idempotent and exact.
   */
  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
