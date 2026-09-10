import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from '../common/api-error.js';
import type { OrderStatus } from '../common/order-status.js';

interface RawOrder {
  id: string;
  company_id: string;
  worker_id: string | null;
  event_id: string | null;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentOrderDto {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

const ORDER_COLUMNS =
  'id, company_id, worker_id, event_id, status, amount_cents, currency, created_at, updated_at';

function toDto(row: RawOrder): PaymentOrderDto {
  return {
    id: row.id,
    companyId: row.company_id,
    workerId: row.worker_id,
    eventId: row.event_id,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PaymentOrderDto | null> {
    const rows = await this.prisma.$queryRawUnsafe<RawOrder[]>(
      `SELECT ${ORDER_COLUMNS} FROM payment_orders WHERE id = $1`,
      id,
    );
    return rows.length > 0 ? toDto(rows[0]) : null;
  }

  async create(input: {
    id: string;
    companyId: string;
    workerId: string | null;
    eventId: string | null;
    amountCents: number;
    currency: string;
  }): Promise<PaymentOrderDto> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<RawOrder[]>(
        `INSERT INTO payment_orders (id, company_id, worker_id, event_id, status, amount_cents, currency, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, now(), now())
         RETURNING ${ORDER_COLUMNS}`,
        input.id,
        input.companyId,
        input.workerId,
        input.eventId,
        input.amountCents,
        input.currency,
      );
      // Maintenance hooks: keep the read model consistent with the source
      // write, in the same transaction. A failed hook rolls back the write.
      await this.syncOperationView(tx, input.id);
      await this.applyTotalsDelta(tx, input.companyId, null, 'pending', input.amountCents);
      return toDto(rows[0]);
    });
  }

  async applyStatusChange(id: string, expectedStatus: OrderStatus, nextStatus: OrderStatus): Promise<PaymentOrderDto> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<{ status: string; company_id: string; amount_cents: number }[]>(
        `SELECT status, company_id, amount_cents FROM payment_orders WHERE id = $1 FOR UPDATE`,
        id,
      );
      if (locked.length === 0) {
        throw new ApiError(404, 'resource_not_found', `payment order ${id} not found`, { id });
      }
      if (locked[0].status !== expectedStatus) {
        throw new ApiError(409, 'state_conflict', `payment order ${id} changed concurrently; re-read and retry`, {
          id,
          expectedStatus,
        });
      }
      await tx.$executeRawUnsafe(
        `UPDATE payment_orders SET status = $2, updated_at = now() WHERE id = $1`,
        id,
        nextStatus,
      );
      // Maintenance hooks (same transaction as the source write).
      await this.syncOperationView(tx, id);
      await this.applyTotalsDelta(tx, locked[0].company_id, expectedStatus, nextStatus, locked[0].amount_cents);
      const rows = await tx.$queryRawUnsafe<RawOrder[]>(
        `SELECT ${ORDER_COLUMNS} FROM payment_orders WHERE id = $1`,
        id,
      );
      return toDto(rows[0]);
    });
  }

  /**
   * Upserts the denormalised operation row for an order, rebuilt from the
   * source tables. Always derived from the source of truth, so re-running the
   * hook is idempotent.
   */
  private async syncOperationView(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.$executeRawUnsafe(
      `INSERT INTO operation_views (id, company_id, worker_id, worker_name, event_id, event_title, event_venue, event_starts_at, status, amount_cents, currency, created_at, updated_at)
       SELECT o.id, o.company_id, o.worker_id, w.name, o.event_id, e.title, e.venue, e.starts_at,
              o.status, o.amount_cents, o.currency, o.created_at, o.updated_at
       FROM payment_orders o
       LEFT JOIN workers w ON w.id = o.worker_id
       LEFT JOIN events e ON e.id = o.event_id
       WHERE o.id = $1
       ON CONFLICT (id) DO UPDATE SET
         company_id      = EXCLUDED.company_id,
         worker_id       = EXCLUDED.worker_id,
         worker_name     = EXCLUDED.worker_name,
         event_id        = EXCLUDED.event_id,
         event_title     = EXCLUDED.event_title,
         event_venue     = EXCLUDED.event_venue,
         event_starts_at = EXCLUDED.event_starts_at,
         status          = EXCLUDED.status,
         amount_cents    = EXCLUDED.amount_cents,
         currency        = EXCLUDED.currency,
         created_at      = EXCLUDED.created_at,
         updated_at      = EXCLUDED.updated_at`,
      orderId,
    );
  }

  /**
   * Accumulates the exact per-company, per-status totals. The upsert adds the
   * delta to the current row values; PostgreSQL applies the update to the
   * latest row version, so concurrent updates to one company's totals never
   * lose updates.
   */
  private async applyTotalsDelta(
    tx: Prisma.TransactionClient,
    companyId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    amountCents: number,
  ): Promise<void> {
    const centsDelta = (status: OrderStatus): number =>
      (toStatus === status ? amountCents : 0) - (fromStatus === status ? amountCents : 0);
    const countDelta = (status: OrderStatus): number => {
      const c = centsDelta(status);
      return c > 0 ? 1 : c < 0 ? -1 : 0;
    };
    await tx.$executeRawUnsafe(
      `INSERT INTO company_operation_totals (company_id, pending_cents, approved_cents, rejected_cents, completed_cents, cancelled_cents, pending_count, approved_count, rejected_count, completed_count, cancelled_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (company_id) DO UPDATE SET
         pending_cents   = company_operation_totals.pending_cents   + EXCLUDED.pending_cents,
         approved_cents  = company_operation_totals.approved_cents  + EXCLUDED.approved_cents,
         rejected_cents  = company_operation_totals.rejected_cents  + EXCLUDED.rejected_cents,
         completed_cents = company_operation_totals.completed_cents + EXCLUDED.completed_cents,
         cancelled_cents = company_operation_totals.cancelled_cents + EXCLUDED.cancelled_cents,
         pending_count   = company_operation_totals.pending_count   + EXCLUDED.pending_count,
         approved_count  = company_operation_totals.approved_count  + EXCLUDED.approved_count,
         rejected_count  = company_operation_totals.rejected_count  + EXCLUDED.rejected_count,
         completed_count = company_operation_totals.completed_count + EXCLUDED.completed_count,
         cancelled_count = company_operation_totals.cancelled_count + EXCLUDED.cancelled_count,
         updated_at      = now()`,
      companyId,
      centsDelta('pending'),
      centsDelta('approved'),
      centsDelta('rejected'),
      centsDelta('completed'),
      centsDelta('cancelled'),
      countDelta('pending'),
      countDelta('approved'),
      countDelta('rejected'),
      countDelta('completed'),
      countDelta('cancelled'),
    );
  }
}
