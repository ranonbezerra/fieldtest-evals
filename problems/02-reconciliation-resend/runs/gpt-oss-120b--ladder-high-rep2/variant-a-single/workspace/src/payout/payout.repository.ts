import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Payout, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingPayouts(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.pending },
    });
  }

  async findAwaitingEvidencePayouts(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.waiting_evidence },
    });
  }

  async findByTxId(txid: string): Promise<Payout | null> {
    return this.prisma.payout.findFirst({
      where: { txid },
    });
  }

  async findById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { id },
    });
  }

  async updateStatus(
    id: string,
    status: PayoutStatus,
    data: Partial<Payout> = {},
  ): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: { status, ...data },
    });
  }

  async incrementAttempts(id: string): Promise<Payout> {
    return this.prisma.payout.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
  }
}
