import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutState } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPendingPayments(): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: { state: PayoutState.pending },
    });
  }

  async findPaymentsNeedingResend(maxAttempts: number): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: {
        state: { in: [PayoutState.pending, PayoutState.sent] },
        sendAttempts: { lt: maxAttempts },
        txid: { not: null },
      },
    });
  }

  async findByTxids(txids: string[]): Promise<any[]> {
    return this.prisma.payout.findMany({
      where: { txid: { in: txids } },
    });
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state },
    });
  }

  async incrementAttempts(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { sendAttempts: { increment: 1 } },
    });
  }

  async setTxid(id: number, txid: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }

  async markManualReview(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state: PayoutState.manual_review },
    });
  }

  async markSettled(id: number): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state: PayoutState.settled },
    });
  }
}
