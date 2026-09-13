import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Payout, PayoutState } from '@prisma/client';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: { supplier_key: string; amount: number; effective_date: Date }): Promise<Payout> {
    return this.prisma.payout.create({
      data,
    });
  }

  async findById(id: number): Promise<Payout | null> {
    return this.prisma.payout.findUnique({
      where: { id },
    });
  }

  async findPending(): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: { state: PayoutState.pending },
    });
  }

  async findByEffectiveDateRange(from: Date, to: Date): Promise<Payout[]> {
    return this.prisma.payout.findMany({
      where: {
        effective_date: {
          gte: from,
          lte: to,
        },
      },
    });
  }

  async updateStateAndAttempt(
    id: number,
    data: {
      state: PayoutState;
      attempts: { increment: number };
      last_attempt_at: Date;
      txid?: string;
    },
  ): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: {
        state: data.state,
        attempts: data.attempts,
        last_attempt_at: data.last_attempt_at,
        txid: data.txid,
      },
    });
  }

  async updateState(id: number, state: PayoutState): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      data: { state },
    });
  }
}
