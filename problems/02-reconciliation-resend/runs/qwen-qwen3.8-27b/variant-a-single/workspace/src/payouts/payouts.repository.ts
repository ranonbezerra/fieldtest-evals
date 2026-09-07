import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import type { Payout, ParkReason, PrismaClient } from '@prisma/client';

export interface CreatePayoutData {
  id: string;
  supplierKey: string;
  amountMinor: number;
  effectiveDate: Date;
  txid: string;
}

export interface PayoutTransitionData {
  status: PayoutStatus;
  attempts?: { increment: number };
  parkReason?: ParkReason;
  lastAttemptAt?: Date;
  settledAt?: Date;
}

@Injectable()
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreatePayoutData): Promise<Payout> {
    return this.prisma.payout.create({
      data: {
        id: data.id,
        supplierKey: data.supplierKey,
        amountMinor: data.amountMinor,
        effectiveDate: data.effectiveDate,
        txid: data.txid,
      },
    });
  }

  /** Orders eligible to (re)send: never sent, or proven absent by reconciliation. */
  findToSend(batchSize: number): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: { in: [PayoutStatus.pending, PayoutStatus.retryable] } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
  }

  /** Orders whose send outcome is still unknown and whose attempt is at or before `to`. */
  findInFlightAttemptedBefore(to: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.in_flight, lastAttemptAt: { lte: to } },
    });
  }

  /** Unsettled orders whose txid appears among the given txids. */
  findUnsettledByTxids(txids: string[]): Promise<Payout[]> {
    if (txids.length === 0) return Promise.resolve([]);
    return this.prisma.payout.findMany({
      where: { txid: { in: txids }, status: { not: PayoutStatus.settled } },
    });
  }

  /**
   * Guarded state transition: applied only if the row is still in one of `from`.
   * Returns false when a concurrent run already moved the row, which is what
   * makes overlapping reconcile windows and concurrent sends safe.
   */
  transition(id: string, from: PayoutStatus[], data: PayoutTransitionData): Promise<boolean> {
    return this.prisma.payout
      .updateMany({ where: { id, status: { in: from } }, data })
      .then((result) => result.count > 0);
  }
}
