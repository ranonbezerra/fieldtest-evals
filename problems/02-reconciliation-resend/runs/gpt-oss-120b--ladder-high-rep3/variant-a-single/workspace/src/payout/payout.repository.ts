import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingPayouts(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.PENDING },
    });
  }

  async findSentPendingPayoutsWithinWindow(start: Date, end: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.SENT_PENDING,
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

  async updatePayout(id: number, data: Partial<Payout>): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data,
    });
  }

  async setTxId(id: number, txid: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: { txid },
    });
  }
}
