import { Injectable } from '@nestjs/common';
import { PaymentOrder, PaymentOrderState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutOrderStore, PaymentOrderRecord } from './payout.types.js';

/**
 * The only layer that touches the database. Every state change is a guarded,
 * one-way transition: the WHERE clause pins the expected prior state, so a
 * repeated (or concurrent) run can apply each transition at most once.
 */
@Injectable()
export class PayoutRepository implements PayoutOrderStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: { state: PaymentOrderState.PENDING },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        state: {
          in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN],
        },
        effectiveDate: { gte: from, lte: to },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.IN_FLIGHT, attemptCount: { increment: 1 }, lastAttemptAt: at, lastResult },
    );
  }

  async markOutcomeUnknown(id: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      {
        state: PaymentOrderState.OUTCOME_UNKNOWN,
        attemptCount: { increment: 1 },
        lastAttemptAt: at,
        lastResult: 'transient',
      },
    );
  }

  async markRejected(id: string, at: Date, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      {
        state: PaymentOrderState.REJECTED,
        attemptCount: { increment: 1 },
        lastAttemptAt: at,
        lastResult: 'permanent',
        rejectReason: reason,
      },
    );
  }

  async markSettled(id: string, txid: string, at: Date): Promise<boolean> {
    return this.transition(
      {
        id,
        state: {
          in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN],
        },
      },
      { state: PaymentOrderState.SETTLED, settleTxid: txid, settledAt: at },
    );
  }

  async markPendingForResend(id: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.PENDING },
    );
  }

  async markNeedsReview(id: string, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.NEEDS_REVIEW, parkedReason: reason },
    );
  }

  private async transition(
    where: Prisma.PaymentOrderWhereUniqueInput,
    data: Prisma.PaymentOrderUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.prisma.paymentOrder.updateMany({ where, data });
    return result.count > 0;
  }
}

function toRecord(row: PaymentOrder): PaymentOrderRecord {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountCents: row.amountCents,
    effectiveDate: row.effectiveDate,
    state: row.state,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
  };
}
