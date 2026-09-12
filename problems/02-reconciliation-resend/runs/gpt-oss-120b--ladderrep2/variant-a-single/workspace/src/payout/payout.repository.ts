import { Injectable } from '@nestjs/common';
import { PrismaClient, Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  private readonly prisma = new PrismaClient();

  async findPendingToSend(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.pending },
    });
  }

  async updateAfterSend(
    payoutId: number,
    txid: string,
    status: PayoutStatus,
    attemptsIncrement: number,
  ): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        txid,
        status,
        attempts: { increment: attemptsIncrement },
        updatedAt: new Date(),
      },
    });
  }

  async findAwaitingEvidence(
    now: Date,
    publishingLagMs: number,
  ): Promise<Payout[]> {
    // Orders that have been sent (status = sent) and whose effectiveDate is older than now - publishingLag
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.sent,
        effectiveDate: { lt: new Date(now.getTime() - publishingLagMs) },
      },
    });
  }

  async markSettled(payoutId: number): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.settled,
        updatedAt: new Date(),
      },
    });
  }

  async incrementAttemptsAndMaybePark(
    payoutId: number,
    maxAttempts: number,
  ): Promise<Payout> {
    const payout = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    if (payout.attempts >= maxAttempts) {
      return this.prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.parked,
          updatedAt: new Date(),
        },
      });
    }
    return payout;
  }

  async findByTxid(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { txid },
    });
  }
}
