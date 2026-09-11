import { Injectable } from '@nestjs/common';
import type { PayoutOrder } from '@prisma/client';
import type { PrismaService } from '../prisma.service.js';

/**
 * The only layer that touches the database. Every write is a state-guarded
 * `updateMany`: exactly one writer can apply a given transition and everyone
 * else gets `false`, which is what makes overlapping runs idempotent.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Orders due for the bank: fresh PENDING ones plus RETRYABLE ones whose
   * absence from the statement has been proven by reconciliation. */
  async findSendable(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({
      where: {
        OR: [
          { state: 'PENDING' },
          { state: 'RETRYABLE', resendEligibleAt: { not: null } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findRetryable(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({ where: { state: 'RETRYABLE' } });
  }

  async findByTxids(txids: string[]): Promise<PayoutOrder[]> {
    if (txids.length === 0) return [];
    return this.prisma.payoutOrder.findMany({ where: { txid: { in: txids } } });
  }

  /** Bank acknowledged the payment (accepted, or duplicate of an earlier attempt). */
  async markAwaitingSettlement(
    orderId: string,
    data: { txid: string; attempts: number; lastSendAt: Date; lastOutcome: string },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'RETRYABLE'] } },
      data: {
        state: 'AWAITING_SETTLEMENT',
        txid: data.txid,
        attempts: data.attempts,
        lastSendAt: data.lastSendAt,
        lastOutcome: data.lastOutcome,
        resendEligibleAt: null, // must be re-proven absent if this ever bounces back
      },
    });
    return result.count > 0;
  }

  /** Send failed/timed out; may only be re-sent after reconciliation proves absence. */
  async markRetryable(
    orderId: string,
    data: { attempts: number; lastSendAt: Date; lastOutcome: string },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'RETRYABLE'] } },
      data: {
        state: 'RETRYABLE',
        attempts: data.attempts,
        lastSendAt: data.lastSendAt,
        lastOutcome: data.lastOutcome,
        resendEligibleAt: null,
      },
    });
    return result.count > 0;
  }

  /** Terminal for the automatic jobs: never left again by executePayments/reconcile. */
  async markParked(
    orderId: string,
    data: { reason: string; lastOutcome?: string; attempts?: number; lastSendAt?: Date },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { in: ['PENDING', 'RETRYABLE', 'AWAITING_SETTLEMENT'] } },
      data: {
        state: 'NEEDS_MANUAL_REVIEW',
        parkedReason: data.reason,
        lastOutcome: data.lastOutcome,
        attempts: data.attempts,
        lastSendAt: data.lastSendAt,
      },
    });
    return result.count > 0;
  }

  /** Statement matched and the amount agrees. Also allowed from
   * NEEDS_MANUAL_REVIEW: if the statement proves the money moved, record it. */
  async markSettled(
    orderId: string,
    data: { settledAt: Date; settlementAmount: number },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { in: ['AWAITING_SETTLEMENT', 'RETRYABLE', 'NEEDS_MANUAL_REVIEW'] } },
      data: {
        state: 'SETTLED',
        settledAt: data.settledAt,
        settlementAmount: data.settlementAmount,
      },
    });
    return result.count > 0;
  }

  /** Marks retryable orders as proven absent (hence resendable) as of `at`. */
  async markResendEligible(orderIds: string[], at: Date): Promise<number> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: { in: orderIds }, state: 'RETRYABLE' },
      data: { resendEligibleAt: at },
    });
    return result.count;
  }
}
