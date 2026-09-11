import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus, PrismaClient } from '@prisma/client';
import type { PayoutOrder } from '@prisma/client';

/**
 * The lifecycle of a payout order. PENDING/SENT/OUTCOME_UNKNOWN are the only
 * states the system moves on its own; SETTLED/REJECTED/PARKED are terminal
 * and reviewed by a human.
 */
export type PayoutStatusValue =
  | 'PENDING'
  | 'SENT'
  | 'OUTCOME_UNKNOWN'
  | 'SETTLED'
  | 'REJECTED'
  | 'PARKED';

export interface PayoutOrderRow {
  id: string;
  supplierId: string;
  key: string;
  /** Integer amount in the currency's minor units. */
  amountMinor: number;
  currency: string;
  /** Calendar date stored at UTC midnight. */
  effectiveDate: Date;
  status: PayoutStatusValue;
  /** The txid actually submitted to the bank; null before the first send. */
  txid: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  rejectionReason: string | null;
  settledAt: Date | null;
  parkedAt: Date | null;
}

export interface SendRecord {
  status: PayoutStatusValue;
  txid: string;
  lastAttemptAt: Date;
  rejectionReason: string | null;
}

export interface ResendRecord {
  status: PayoutStatusValue;
  rejectionReason: string | null;
}

/**
 * Persistence contract for payout orders.
 *
 * Every mutation is a conditional (compare-and-set) update: it only applies
 * if the row is still in the expected state, so two overlapping runs can
 * never double-send, double-settle or overwrite a state a later run already
 * took. The boolean result tells the caller whether it won the race.
 */
export abstract class PayoutOrderStore {
  /** Orders that were never sent. */
  abstract findPending(): Promise<PayoutOrderRow[]>;
  /** Orders still awaiting statement evidence for the given UTC days. */
  abstract findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  /** Record the first send. Only applies from PENDING with zero attempts. */
  abstract recordSendOutcome(id: string, data: SendRecord): Promise<boolean>;
  /**
   * Claim the right to perform the next resend. Atomic: at most one of
   * concurrent claimers with the same expected count succeeds.
   */
  abstract claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  /** Record a resend's outcome. Skipped if the order left the awaiting states. */
  abstract recordResendOutcome(id: string, data: ResendRecord): Promise<boolean>;
  /** Match to a statement entry. Skipped if the order left the awaiting states. */
  abstract markSettled(id: string, at: Date): Promise<boolean>;
  /** Park for manual review. Skipped if the order left the awaiting states. */
  abstract markParked(id: string, at: Date): Promise<boolean>;
}

const STATUS_TO_PRISMA: Record<PayoutStatusValue, PayoutStatus> = {
  PENDING: PayoutStatus.PENDING,
  SENT: PayoutStatus.SENT,
  OUTCOME_UNKNOWN: PayoutStatus.OUTCOME_UNKNOWN,
  SETTLED: PayoutStatus.SETTLED,
  REJECTED: PayoutStatus.REJECTED,
  PARKED: PayoutStatus.PARKED,
};

const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {
  [PayoutStatus.PENDING]: 'PENDING',
  [PayoutStatus.SENT]: 'SENT',
  [PayoutStatus.OUTCOME_UNKNOWN]: 'OUTCOME_UNKNOWN',
  [PayoutStatus.SETTLED]: 'SETTLED',
  [PayoutStatus.REJECTED]: 'REJECTED',
  [PayoutStatus.PARKED]: 'PARKED',
};

const AWAITING_EVIDENCE: PayoutStatus[] = [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN];

function toRow(order: PayoutOrder): PayoutOrderRow {
  return {
    id: order.id,
    supplierId: order.supplierId,
    key: order.key,
    amountMinor: order.amountMinor,
    currency: order.currency,
    effectiveDate: order.effectiveDate,
    status: STATUS_FROM_PRISMA[order.status],
    txid: order.txid,
    attemptCount: order.attemptCount,
    lastAttemptAt: order.lastAttemptAt,
    rejectionReason: order.rejectionReason,
    settledAt: order.settledAt,
    parkedAt: order.parkedAt,
  };
}

/** The only layer that touches the database. */
@Injectable()
export class PayoutRepository extends PayoutOrderStore implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: { status: PayoutStatus.PENDING, attemptCount: 0 },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return orders.map(toRow);
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: {
        status: { in: AWAITING_EVIDENCE },
        txid: { not: null },
        effectiveDate: { in: effectiveDates },
      },
    });
    return orders.map(toRow);
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: PayoutStatus.PENDING, attemptCount: 0 },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        txid: data.txid,
        attemptCount: 1,
        lastAttemptAt: data.lastAttemptAt,
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: {
        id,
        status: { in: AWAITING_EVIDENCE },
        attemptCount: expectedAttemptCount,
      },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return result.count === 1;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.SETTLED, settledAt: at },
    });
    return result.count === 1;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.PARKED, parkedAt: at },
    });
    return result.count === 1;
  }
}
