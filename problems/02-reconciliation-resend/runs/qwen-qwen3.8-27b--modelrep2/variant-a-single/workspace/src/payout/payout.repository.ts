import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ClaimResult, Order, SendResult } from './order.types.js';

/**
 * Only layer that touches the database.
 * All transitions are guarded single-row updates so that overlapping runs
 * and overlapping windows are safe by construction.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Orders a send is allowed to touch: never-settled, and either fresh
   * (PENDING) or failed and proven absent from the statement past the
   * publishing lag, under the attempt cap.
   */
  async findSendableOrders(maxAttempts: number): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        OR: [
          { state: 'PENDING' },
          { state: 'FAILED', absentConfirmedAt: { not: null }, attempts: { lt: maxAttempts } },
        ],
      },
    });
    return rows.map(mapRow);
  }

  /**
   * Guarded claim: the only transition that advances attempts.
   * Returns ok=false if another run already claimed this order.
   */
  async claim(orderId: string, txid: string, now: Date): Promise<ClaimResult> {
    const res = await this.prisma.$transaction([
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'PENDING' },
        data: { state: 'SENT', attempts: 1, txid, sentAt: now, lastError: null },
      }),
      this.prisma.order.updateMany({
        where: { id: orderId, state: 'FAILED' },
        data: { state: 'SENT', attempts: { increment: 1 }, txid, sentAt: now, lastError: null },
      }),
    ]);
    const claimed = (res[0].count + res[1].count) === 1;
    if (!claimed) {
      return { ok: false, reason: 'already_claimed' };
    }
    const row = await this.prisma.order.findUnique({ where: { id: orderId } });
    return row ? { ok: true, order: mapRow(row) } : { ok: false, reason: 'already_claimed' };
  }

  /** Record the classified outcome of a claimed send. */
  async sendResult(orderId: string, kind: SendResult['kind'], note: string | null): Promise<void> {
    if (kind === 'success') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { lastError: note },
      });
      return;
    }
    if (kind === 'permanent') {
      await this.prisma.order.updateMany({
        where: { id: orderId, state: 'SENT' },
        data: { state: 'MANUAL_REVIEW', lastError: note },
      });
      return;
    }
    await this.prisma.order.updateMany({
      where: { id: orderId, state: 'SENT' },
      data: { state: 'FAILED', lastError: note },
    });
  }

  /** Orders reconciliation may still advance, with their derived txid. */
  async findSettleCandidates(): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { state: { in: ['PENDING', 'SENT', 'FAILED'] }, txid: { not: null } },
    });
    return rows.map(mapRow);
  }

  /** Guarded advance to SETTLED; only the matching states may move. */
  async settleMatched(orderId: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'SENT', 'FAILED'] } },
      data: { state: 'SETTLED', lastError: null },
    });
    return res.count;
  }

  /**
   * Guarded park for manual review. Used for permanent rejections and for
   * attempt exhaustion. A proven-absent FAILED order that is exhausted is
   * parked here; nothing ever auto-reverts SETTLED rows.
   */
  async parkForReview(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: { in: ['SENT', 'FAILED'] } },
      data: { state: 'MANUAL_REVIEW', lastError: note },
    });
    return res.count;
  }

  /** A PENDING order whose send died without a reply is a failed attempt. */
  async failStalePending(orderId: string, note: string): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'PENDING' },
      data: { state: 'FAILED', attempts: { increment: 1 }, lastError: note },
    });
    return res.count;
  }

  /** Mark a FAILED order as proven absent from the statement past the lag. */
  async confirmAbsent(orderId: string, at: Date): Promise<number> {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, state: 'FAILED', absentConfirmedAt: null },
      data: { absentConfirmedAt: at },
    });
    return res.count;
  }
}

function mapRow(row: {
  id: string;
  supplierKey: string;
  amountMinor: bigint | Prisma.JsonValue;
  effectiveDate: Date;
  state: string;
  attempts: number;
  txid: string | null;
  sentAt: Date | null;
  absentConfirmedAt: Date | null;
  lastError: string | null;
}): Order {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountMinor: BigInt(row.amountMinor as bigint),
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    state: row.state as Order['state'],
    attempts: row.attempts,
    txid: row.txid,
    sentAt: row.sentAt,
    absentConfirmedAt: row.absentConfirmedAt,
    lastError: row.lastError,
  };
}
