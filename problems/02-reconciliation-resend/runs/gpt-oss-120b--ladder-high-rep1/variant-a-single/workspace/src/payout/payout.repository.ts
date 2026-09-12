import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingOrders(limit?: number): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.PENDING,
        attempts: { lt: 5 },
      },
      take: limit,
    });
  }

  async findOrdersAwaitingEvidence(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        status: PayoutStatus.SENT,
      },
    });
  }

  async findOrdersByTxids(txids: string[]): Promise<Payout[]> {
    if (txids.length === 0) return [];
    return this.prisma.payout.findMany({
      where: {
        txid: { in: txids },
      },
    });
  }

  async markSent(id: number, txid: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SENT,
        txid,
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  async markSettled(id: number): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        updatedAt: new Date(),
      },
    });
  }

  async markFailed(id: number): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.FAILED,
        updatedAt: new Date(),
      },
    });
  }

  async parkOrder(id: number): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        status: PayoutStatus.PARKED,
        updatedAt: new Date(),
      },
    });
  }

  async updateTxid(id: number, txid: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        txid,
        updatedAt: new Date(),
      },
    });
  }
}
