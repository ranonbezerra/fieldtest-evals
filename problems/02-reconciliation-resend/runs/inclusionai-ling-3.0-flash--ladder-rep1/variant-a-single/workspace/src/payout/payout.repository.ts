import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@prisma/nestjs';
import { Repository } from 'prisma';
import { Prisma, PayoutStatus } from '@prisma/client';
import { PayoutRecord, PayoutStatus as PayoutStatusEnum } from './payout.types';

@Injectable()
export class PayoutRepository {
  constructor(@InjectRepository(Payout) private readonly payoutModel: Repository<Payout>) {}

  async findByOrderRef(orderRef: string): Promise<PayoutRecord | null> {
    const row = await this.payoutModel.findUnique({ where: { orderRef } });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<PayoutRecord | null> {
    const row = await this.payoutModel.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findPending(): Promise<PayoutRecord[]> {
    const rows = await this.payoutModel.findMany({
      where: { status: PayoutStatus.PENDING },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findAwaitingEvidenceInRange(start: Date, end: Date): Promise<PayoutRecord[]> {
    const rows = await this.payoutModel.findMany({
      where: {
        status: PayoutStatus.AWAITING_EVIDENCE,
        lastAttemptAt: { gte: start, lte: end },
      },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: Prisma.PayoutCreateInput): Promise<PayoutRecord> {
    const row = await this.payoutModel.create({ data });
    return this.toRecord(row);
  }

  async markSent(
    id: string,
    txid: string,
    outcome: string,
    code: string | null,
    message: string | null,
  ): Promise<PayoutRecord> {
    const row = await this.payoutModel.update({
      where: { id },
      data: {
        txid,
        status: PayoutStatus.AWAITING_EVIDENCE,
        sendAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastSendOutcome: outcome,
        bankResponseCode: code,
        bankResponseMessage: message,
      },
    });
    return this.toRecord(row);
  }

  async markSettled(id: string): Promise<PayoutRecord> {
    const row = await this.payoutModel.update({
      where: { id },
      data: {
        status: PayoutStatus.SETTLED,
        lastSendOutcome: 'settled_via_statement',
        bankResponseCode: null,
        bankResponseMessage: null,
      },
    });
    return this.toRecord(row);
  }

  async markRejected(
    id: string,
    outcome: string,
    code: string | null,
    message: string | null,
  ): Promise<PayoutRecord> {
    const row = await this.payoutModel.update({
      where: { id },
      data: {
        status: PayoutStatus.REJECTED,
        lastSendOutcome: outcome,
        bankResponseCode: code,
        bankResponseMessage: message,
      },
    });
    return this.toRecord(row);
  }

  async parkForReview(id: string): Promise<PayoutRecord> {
    const row = await this.payoutModel.update({
      where: { id },
      data: {
        status: PayoutStatus.PARKED_FOR_REVIEW,
        lastSendOutcome: 'attempts_exhausted',
        bankResponseCode: null,
        bankResponseMessage: null,
      },
    });
    return this.toRecord(row);
  }

  async resend(
    id: string,
    outcome: string,
    code: string | null,
    message: string | null,
  ): Promise<PayoutRecord> {
    const row = await this.payoutModel.update({
      where: { id },
      data: {
        sendAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastSendOutcome: outcome,
        bankResponseCode: code,
        bankResponseMessage: message,
      },
    });
    return this.toRecord(row);
  }

  private toRecord(row: Prisma.PayoutGetPayload<{}>): PayoutRecord {
    return {
      id: row.id,
      orderRef: row.orderRef,
      effectiveDate: row.effectiveDate,
      amount: row.amount,
      txid: row.txid,
      bankKey: row.bankKey,
      status: row.status as PayoutStatusEnum,
      sendAttempts: row.sendAttempts,
      lastAttemptAt: row.lastAttemptAt,
      lastSendOutcome: row.lastSendOutcome,
      bankResponseCode: row.bankResponseCode,
      bankResponseMessage: row.bankResponseMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
