import { Injectable } from '@nestjs/common';
import { PrismaClient, Order } from '@prisma/client';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { status: 'in_doubt', effectiveDate: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'sent', lastAttemptAt },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'in_doubt', lastAttemptAt },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected' },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settledAt },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending' },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'parked_manual_review' },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ attempt_count: number }>>`
      UPDATE orders
      SET attempt_count = attempt_count + 1,
          last_attempt_at = ${lastAttemptAt},
          updated_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING attempt_count
    `;
    return result.length > 0 ? Number(result[0].attempt_count) : 0;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      create: {
        txid: data.txid,
        amountMinorUnits: data.amount_minor_units,
        settledAt: data.settled_at,
        statementDate: data.statement_date,
      },
      update: {},
    });
  }
}
