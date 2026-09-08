import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Payout, PayoutStatus, PayoutRepository, ReconcileWindow } from './payout.types';

type PrismaPayoutRow = {
  id: string;
  externalKey: string;
  amount: number;
  effectiveDate: Date;
  txid: string | null;
  status: string;
  attemptCount: number;
  settledAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaPayoutRepository implements PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
      orderBy: { effectiveDate: 'asc' },
    });
    return results.map(this.toDomain);
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    const result = await this.prisma.payout.findUnique({
      where: { txid },
    });
    return result ? this.toDomain(result) : null;
  }

  async findAwaitingReconcileEligible(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Payout[]> {
    const results = await this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.AWAITING_RECONCILE,
        effectiveDate: {
          gte: window.from,
          lte: cutoff,
        },
      },
    });
    return results.map(this.toDomain);
  }

  async markSent(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.SENT,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markAwaitingReconcile(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.AWAITING_RECONCILE,
        attemptCount: { increment: 1 },
      },
    });
  }

  async markRejected(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.REJECTED,
        rejectedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        settledAt,
      },
    });
  }

  async markForResend(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.PENDING,
      },
    });
  }

  async markFailed(id: string, failedAt: Date): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.FAILED,
        failedAt,
      },
    });
  }

  private toDomain(row: PrismaPayoutRow): Payout {
    return {
      id: row.id,
      externalKey: row.externalKey,
      amount: row.amount,
      effectiveDate: row.effectiveDate,
      txid: row.txid,
      status: row.status as PayoutStatus,
      attemptCount: row.attemptCount,
      settledAt: row.settledAt,
      rejectedAt: row.rejectedAt,
      failedAt: row.failedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
