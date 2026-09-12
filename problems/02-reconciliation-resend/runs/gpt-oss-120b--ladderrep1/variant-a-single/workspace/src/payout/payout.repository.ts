import { Injectable } from '@nestjs/common';
import { PrismaClient, Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  private readonly prisma = new PrismaClient();

  async findPending(limit = 100): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.PENDING,
        attempts: { lt: 5 },
      },
      take: limit,
    });
  }

  async findSentInWindow(
    start: Date,
    end: Date,
  ): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.SENT,
        effectiveDate: {
          gte: start,
          lte: end,
        },
      },
    });
  }

  async findByTxId(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { txid },
    });
  }

  async updateStatus(id: string, status: PayoutStatus): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status },
    });
  }

  async incrementAttempts(id: string): Promise<number> {
    const updated = await this.prisma.payout.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
    return updated.attempts;
  }

  async setTxId(id: string, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }

  async parkForReview(id: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PARKED },
    });
  }
}
