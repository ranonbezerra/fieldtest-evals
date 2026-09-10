import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

interface DriftedRow {
  payment_order_id: string;
}

interface DriftedCompany {
  company_id: string;
}

@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Compare projection against source for orders created in [from, to]:
   * rows that are missing or disagree field by field, and companies whose
   * totals disagree with a re-aggregation of the source.
   */
  async findDrift(from: Date, to: Date): Promise<{ driftedRows: string[]; driftedCompanies: string[] }> {
    const [rows, companies] = await this.prisma.$transaction([
      this.prisma.$queryRaw<DriftedRow[]>`
        SELECT o."id" AS "payment_order_id"
        FROM "payment_orders" o
        JOIN "workers" w ON w."id" = o."worker_id"
        JOIN "events" e ON e."id" = o."event_id"
        LEFT JOIN "operation_read_model" p ON p."payment_order_id" = o."id"
        WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
          AND (
            p."payment_order_id" IS NULL
            OR p."company_id" IS DISTINCT FROM o."company_id"
            OR p."worker_id" IS DISTINCT FROM o."worker_id"
            OR p."worker_name" IS DISTINCT FROM w."full_name"
            OR p."event_id" IS DISTINCT FROM o."event_id"
            OR p."event_name" IS DISTINCT FROM e."name"
            OR p."status" IS DISTINCT FROM o."status"
            OR p."amount_cents" IS DISTINCT FROM o."amount_cents"
            OR p."created_at" IS DISTINCT FROM o."created_at"
            OR p."updated_at" IS DISTINCT FROM o."updated_at"
          )
      `,
      this.prisma.$queryRaw<DriftedCompany[]>`
        SELECT t."company_id" AS "company_id"
        FROM "company_financial_totals" t
        WHERE t."company_id" IN (
          SELECT "company_id" FROM "payment_orders"
          WHERE "created_at" >= ${from} AND "created_at" <= ${to}
        )
          AND (
            t."pending_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'pending'), 0)
            OR t."approved_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'approved'), 0)
            OR t."rejected_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'rejected'), 0)
            OR t."orders_count" <> (SELECT COUNT(*)::int FROM "payment_orders" po WHERE po."company_id" = t."company_id")
          )
        UNION
        SELECT DISTINCT po."company_id" AS "company_id"
        FROM "payment_orders" po
        WHERE po."created_at" >= ${from} AND po."created_at" <= ${to}
          AND NOT EXISTS (SELECT 1 FROM "company_financial_totals" t WHERE t."company_id" = po."company_id")
      `,
    ]);

    return {
      driftedRows: rows.map((row) => row.payment_order_id),
      driftedCompanies: companies.map((company) => company.company_id),
    };
  }
}
