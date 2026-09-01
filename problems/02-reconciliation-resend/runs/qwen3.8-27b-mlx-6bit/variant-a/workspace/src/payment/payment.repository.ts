import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: bigint;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPending(limit: number): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
  }

  async findByTxid(txid: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({ where: { txid } });
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      where: { status: 'in_doubt', effective_date: date },
    });
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'sent', last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'in_doubt', last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
  }

  async markRejected(id: string): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'rejected', updated_at: new Date() },
    });
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: { in: ['sent', 'in_doubt'] } },
      data: { status: 'settled', settled_at: settledAt, updated_at: new Date() },
    });
  }

  async markPendingForResend(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, status: 'in_doubt' },
      data: { status: 'pending', updated_at: new Date() },
    });
  }

  async markParked(id: string): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { status: 'parked_manual_review', updated_at: new Date() },
    });
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: { id, status: 'pending' },
      data: { attempt_count: { increment: 1 }, last_attempt_at: lastAttemptAt, updated_at: new Date() },
    });
    return result.count;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: bigint;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    await this.prisma.settlement.upsert({
      where: { txid: data.txid },
      update: {},
      create: data,
    });
  }
}
