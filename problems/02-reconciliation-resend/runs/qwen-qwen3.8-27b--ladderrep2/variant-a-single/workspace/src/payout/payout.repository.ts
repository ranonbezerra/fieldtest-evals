import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/** DI token so the service depends on the contract, not the class. */
export const PAYOUT_REPOSITORY = 'PAYOUT_REPOSITORY';

/**
 * Data contract the service depends on.
 *
 * Every transition is a *conditional* update: the where clause repeats the
 * state the caller just observed (status, attempt count). If another run
 * moved the order first, zero rows match and the caller skips. That is
 * what makes overlapping reconcile windows idempotent without locks, and
 * what guarantees parked/rejected orders can never be auto-reverted.
 */
export interface PayoutRepositoryApi {
  create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder>;
  findById(id: string): Promise<PayoutOrder | null>;
  findPending(): Promise<PayoutOrder[]>;
  findAwaitingEvidence(): Promise<PayoutOrder[]>;
  settle(id: string, observedAt: Date): Promise<boolean>;
  claimSend(id: string, now: Date): Promise<boolean>;
  claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean>;
  park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean>;
}

/** Orders that still owe statement evidence. */
const AWAITING_EVIDENCE = ['in_flight', 'accepted', 'unknown'] as const;

@Injectable()
export class PayoutRepository implements PayoutRepositoryApi {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    id: string;
    supplierKey: string;
    amount: number;
    effectiveDate: Date;
    txid: string;
  }): Promise<PayoutOrder> {
    return this.prisma.payoutOrder.create({
      data: {
        id: input.id,
        supplierKey: input.supplierKey,
        amount: BigInt(input.amount),
        effectiveDate: input.effectiveDate,
        txid: input.txid,
        // status defaults to "pending", attempt_count to 0 (schema defaults).
      },
    });
  }

  findById(id: string): Promise<PayoutOrder | null> {
    return this.prisma.payoutOrder.findUnique({ where: { id } });
  }

  findPending(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findAwaitingEvidence(): Promise<PayoutOrder[]> {
    return this.prisma.payoutOrder.findMany({
      where: { status: { in: [...AWAITING_EVIDENCE] } },
    });
  }

  /** Settle on a statement match — but only if we still owe evidence. */
  async settle(id: string, observedAt: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] } },
      data: { status: 'settled', settledAt: observedAt },
    });
    return result.count > 0;
  }

  /** First send: pending (attempt 0) -> in_flight (attempt 1). */
  async claimSend(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: 'pending', attemptCount: 0 },
      data: { status: 'in_flight', attemptCount: 1, lastAttemptAt: now },
    });
    return result.count > 0;
  }

  /** Reconcile-proven resend: awaiting evidence -> in_flight, attempt + 1. */
  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] }, attemptCount: expectedAttemptCount },
      data: { status: 'in_flight', attemptCount: expectedAttemptCount + 1, lastAttemptAt: now },
    });
    return result.count > 0;
  }

  /** Record a classified bank outcome on the in-flight claim. */
  async recordOutcome(
    id: string,
    expectedAttemptCount: number,
    data: { status: string; lastOutcome: string },
  ): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: 'in_flight', attemptCount: expectedAttemptCount },
      data,
    });
    return result.count > 0;
  }

  /** Attempts exhausted -> parked for manual review. Automation never leaves parked. */
  async park(id: string, expectedAttemptCount: number, reason: string): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [...AWAITING_EVIDENCE] }, attemptCount: expectedAttemptCount },
      data: { status: 'parked', lastOutcome: 'attempts_exhausted', note: reason },
    });
    return result.count > 0;
  }
}
