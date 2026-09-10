import { Injectable } from '@nestjs/common';
import type { CompanyTotals, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx: Prisma.TransactionClient | undefined, companyId?: string): Promise<CompanyTotals[]> {
    return (tx ?? this.prisma).companyTotals.findMany({
      where: companyId === undefined ? {} : { companyId },
      orderBy: [{ companyId: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Applies a signed delta with one INSERT ... ON CONFLICT statement. The
   * increment happens inside Postgres, so two transactions racing on the
   * same (company_id, status) bucket both land; a client-side
   * read-modify-write (even in a transaction) would lose one of them. Raw
   * SQL is confined to this repository — the service layer never touches it.
   */
  applyDelta(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    status: OrderStatus,
    deltaCount: number,
    deltaCents: bigint,
  ): Promise<number> {
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES (${companyId}, ${status}, ${deltaCount}, ${deltaCents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = company_totals.order_count + ${deltaCount},
          total_cents = company_totals.total_cents + ${deltaCents},
          updated_at  = now()
    `;
  }

  /**
   * Absolute reset of a company's three buckets, used by the re-derivation.
   * One multi-row statement so the three buckets land consistently.
   */
  recompute(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    totals: Record<OrderStatus, { count: number; cents: bigint }>,
  ): Promise<number> {
    const { pending, approved, rejected } = totals;
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES
        (${companyId}, ${'pending'}, ${pending.count}, ${pending.cents}, now()),
        (${companyId}, ${'approved'}, ${approved.count}, ${approved.cents}, now()),
        (${companyId}, ${'rejected'}, ${rejected.count}, ${rejected.cents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = EXCLUDED.order_count,
          total_cents = EXCLUDED.total_cents,
          updated_at  = now()
    `;
  }
}
