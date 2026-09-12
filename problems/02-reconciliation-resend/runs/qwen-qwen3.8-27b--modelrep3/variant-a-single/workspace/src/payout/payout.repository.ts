import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Hard cap on automatic send attempts per order. */
export const MAX_SEND_ATTEMPTS = 5;

export type OrderState = 'pending' | 'in_flight' | 'send_unknown' | 'settled' | 'needs_review';

export interface OpenOrder {
  id: string;
  /** Amount in minor units (integers only). */
  amountMinor: number;
  /** The supplier's bank key. */
  recipientKey: string;
  /** The date the payment applies to; part of the txid derivation. */
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastSendAt: Date | null;
  /** Set by reconciliation once the txid is proven absent past the publishing lag. */
  provenAbsentAt: Date | null;
  settledAt: Date | null;
  reviewReason: string | null;
}

export interface PayoutRepository {
  /** Orders that may be sent now: pending, or send_unknown with a proven absence. */
  findSendable(): Promise<OpenOrder[]>;
  /**
   * Atomically reserves the next attempt for the order (increments the attempt
   * counter, stamps lastSendAt, clears any proven absence). Returns false when the
   * order moved on between the read and the claim.
   */
  claimForSend(orderId: string, expectedState: 'pending' | 'send_unknown', now: Date): Promise<boolean>;
  /** Records the outcome of an attempt this run claimed, guarded by attempt count. */
  recordOutcome(orderId: string, attemptCount: number, state: OrderState, reviewReason: string | null): Promise<void>;
  /** Every order a statement entry could still concern. */
  findOpen(): Promise<OpenOrder[]>;
  /** Settles the order when it is still in one of `expectedStates`. */
  settle(orderId: string, settledAt: Date, expectedStates: OrderState[]): Promise<boolean>;
  /** Marks a send_unknown order's txid as proven absent from the statement. */
  markProvenAbsent(orderId: string, now: Date): Promise<void>;
  /** Parks the order for manual review. */
  markNeedsReview(orderId: string, reason: string): Promise<void>;
}

@Injectable()
export class PayoutRepository implements PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSendable(): Promise<OpenOrder[]> {
    const rows = await this.prisma.payoutOrder.findMany({
      where: {
        attemptCount: { lt: MAX_SEND_ATTEMPTS },
        OR: [{ state: 'pending' }, { state: 'send_unknown', provenAbsentAt: { not: null } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toOpenOrder);
  }

  async claimForSend(orderId: string, expectedState: 'pending' | 'send_unknown', now: Date): Promise<boolean> {
    const where =
      expectedState === 'pending'
        ? { id: orderId, state: 'pending' as const, attemptCount: { lt: MAX_SEND_ATTEMPTS } }
        : {
            id: orderId,
            state: 'send_unknown' as const,
            provenAbsentAt: { not: null },
            attemptCount: { lt: MAX_SEND_ATTEMPTS },
          };
    const result = await this.prisma.payoutOrder.updateMany({
      where,
      data: {
        state: 'send_unknown',
        attemptCount: { increment: 1 },
        lastSendAt: now,
        provenAbsentAt: null,
      },
    });
    return result.count > 0;
  }

  async recordOutcome(orderId: string, attemptCount: number, state: OrderState, reviewReason: string | null): Promise<void> {
    await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: 'send_unknown', attemptCount },
      data: { state, reviewReason },
    });
  }

  async findOpen(): Promise<OpenOrder[]> {
    const rows = await this.prisma.payoutOrder.findMany({
      where: { state: { in: ['in_flight', 'send_unknown', 'needs_review'] } },
    });
    return rows.map(toOpenOrder);
  }

  async settle(orderId: string, settledAt: Date, expectedStates: OrderState[]): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { in: expectedStates } },
      data: { state: 'settled', settledAt, reviewReason: null },
    });
    return result.count > 0;
  }

  async markProvenAbsent(orderId: string, now: Date): Promise<void> {
    await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: 'send_unknown' },
      data: { provenAbsentAt: now },
    });
  }

  async markNeedsReview(orderId: string, reason: string): Promise<void> {
    await this.prisma.payoutOrder.updateMany({
      where: { id: orderId, state: { not: 'settled' } },
      data: { state: 'needs_review', reviewReason: reason },
    });
  }
}

interface PayoutOrderRow {
  id: string;
  amountMinor: number;
  recipientKey: string;
  effectiveDate: Date;
  state: string;
  attemptCount: number;
  lastSendAt: Date | null;
  provenAbsentAt: Date | null;
  settledAt: Date | null;
  reviewReason: string | null;
}

function toOpenOrder(row: PayoutOrderRow): OpenOrder {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    recipientKey: row.recipientKey,
    effectiveDate: row.effectiveDate,
    state: row.state as OrderState,
    attemptCount: row.attemptCount,
    lastSendAt: row.lastSendAt,
    provenAbsentAt: row.provenAbsentAt,
    settledAt: row.settledAt,
    reviewReason: row.reviewReason,
  };
}
