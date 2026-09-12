import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type PayoutStatus =
  | 'pending'
  | 'sent'
  | 'send_failed'
  | 'settled'
  | 'review';

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface PayoutRecord {
  id: string;
  supplierId: string | null;
  bankKey: string;
  amountMinor: number;
  effectiveDate: Date;
  status: PayoutStatus;
  attempts: number;
  lastTxId: string | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  resendProvenAt: Date | null;
  settledAt: Date | null;
  settlementId: string | null;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettlementInput {
  statementDate: Date;
  txId: string;
  amountMinor: number;
  settledAt?: Date | null;
  bankReference?: string | null;
}

export interface SettlementRecord {
  id: string;
  statementDate: Date;
  txId: string;
  amountMinor: number;
  settledAt: Date | null;
  bankReference: string | null;
  receivedAt: Date;
}

export interface CoverageRecord {
  date: Date;
  checkedAt: Date;
}

export interface SendOutcomeUpdate {
  status: PayoutStatus;
  attempts?: number;
  lastTxId?: string | null;
  lastAttemptAt?: Date | null;
  lastError?: string | null;
  reviewReason?: string | null;
}

export interface PayoutRepositoryContract {
  findPendingOrders(limit?: number): Promise<PayoutRecord[]>;
  findOrdersByTxId(txId: string): Promise<PayoutRecord[]>;
  findSendFailedOrders(): Promise<PayoutRecord[]>;
  upsertSettlement(input: SettlementInput): Promise<SettlementRecord>;
  findSettlementByStatementDateAndTxId(
    statementDate: Date,
    txId: string,
  ): Promise<SettlementRecord | null>;
  recordStatementCoverage(date: Date, checkedAt: Date): Promise<void>;
  getStatementCoverage(date: Date): Promise<CoverageRecord | null>;
  markSettled(id: string, settlementId: string, settledAt: Date): Promise<boolean>;
  markReview(id: string, reason: string): Promise<boolean>;
  updateSendOutcome(id: string, data: SendOutcomeUpdate): Promise<void>;
  claimSendFailedForResend(id: string, provenAt: Date): Promise<boolean>;
}

type PayoutRow = Prisma.PayoutGetPayload<{}>;
type SettlementRow = Prisma.SettlementGetPayload<{}>;
type CoverageRow = Prisma.StatementCoverageGetPayload<{}>;

function mapPayout(row: PayoutRow): PayoutRecord {
  return {
    id: row.id,
    supplierId: row.supplierId,
    bankKey: row.bankKey,
    amountMinor: row.amountMinor,
    effectiveDate: row.effectiveDate,
    status: row.status as PayoutStatus,
    attempts: row.attempts,
    lastTxId: row.lastTxId,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    resendProvenAt: row.resendProvenAt,
    settledAt: row.settledAt,
    settlementId: row.settlementId,
    reviewReason: row.reviewReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSettlement(row: SettlementRow): SettlementRecord {
  return {
    id: row.id,
    statementDate: row.statementDate,
    txId: row.txId,
    amountMinor: row.amountMinor,
    settledAt: row.settledAt,
    bankReference: row.bankReference,
    receivedAt: row.receivedAt,
  };
}

function mapCoverage(row: CoverageRow): CoverageRecord {
  return {
    date: row.date,
    checkedAt: row.checkedAt,
  };
}

@Injectable()
export class PayoutRepository implements PayoutRepositoryContract {
  private readonly prisma = new PrismaClient();

  async findPendingOrders(limit = 100): Promise<PayoutRecord[]> {
    const safeLimit = limit > 0 ? limit : 100;
    const rows = await this.prisma.payout.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: safeLimit,
    });
    return rows.map(mapPayout);
  }

  async findOrdersByTxId(txId: string): Promise<PayoutRecord[]> {
    const rows = await this.prisma.payout.findMany({
      where: { lastTxId: txId },
    });
    return rows.map(mapPayout);
  }

  async findSendFailedOrders(): Promise<PayoutRecord[]> {
    const rows = await this.prisma.payout.findMany({
      where: { status: 'send_failed' },
    });
    return rows.map(mapPayout);
  }

  async upsertSettlement(input: SettlementInput): Promise<SettlementRecord> {
    const existing = await this.prisma.settlement.findUnique({
      where: {
        statementDate_txId: {
          statementDate: input.statementDate,
          txId: input.txId,
        },
      },
    });

    if (existing) {
      const updated = await this.prisma.settlement.update({
        where: { id: existing.id },
        data: {
          amountMinor: input.amountMinor,
          settledAt: input.settledAt ?? undefined,
          bankReference: input.bankReference ?? undefined,
        },
      });
      return mapSettlement(updated);
    }

    const created = await this.prisma.settlement.create({
      data: {
        statementDate: input.statementDate,
        txId: input.txId,
        amountMinor: input.amountMinor,
        settledAt: input.settledAt ?? null,
        bankReference: input.bankReference ?? null,
      },
    });
    return mapSettlement(created);
  }

  async findSettlementByStatementDateAndTxId(
    statementDate: Date,
    txId: string,
  ): Promise<SettlementRecord | null> {
    const row = await this.prisma.settlement.findUnique({
      where: {
        statementDate_txId: {
          statementDate,
          txId,
        },
      },
    });
    return row ? mapSettlement(row) : null;
  }

  async recordStatementCoverage(date: Date, checkedAt: Date): Promise<void> {
    const existing = await this.getStatementCoverage(date);
    if (existing && existing.checkedAt.getTime() >= checkedAt.getTime()) {
      return;
    }

    await this.prisma.statementCoverage.upsert({
      where: { date },
      update: { checkedAt },
      create: { date, checkedAt },
    });
  }

  async getStatementCoverage(date: Date): Promise<CoverageRecord | null> {
    const row = await this.prisma.statementCoverage.findUnique({
      where: { date },
    });
    return row ? mapCoverage(row) : null;
  }

  async markSettled(
    id: string,
    settlementId: string,
    settledAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: {
        id,
        status: { in: ['pending', 'sent', 'send_failed'] },
      },
      data: {
        status: 'settled',
        settledAt,
        settlementId,
        lastError: null,
        resendProvenAt: null,
        reviewReason: null,
      },
    });
    return result.count > 0;
  }

  async markReview(id: string, reason: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: {
        id,
        status: { in: ['pending', 'sent', 'send_failed'] },
      },
      data: {
        status: 'review',
        reviewReason: reason,
      },
    });
    return result.count > 0;
  }

  async updateSendOutcome(id: string, data: SendOutcomeUpdate): Promise<void> {
    await this.prisma.payout.updateMany({
      where: {
        id,
        status: { in: ['pending', 'sent', 'send_failed'] },
      },
      data: {
        status: data.status,
        attempts: data.attempts,
        lastTxId: data.lastTxId,
        lastAttemptAt: data.lastAttemptAt,
        lastError: data.lastError,
        reviewReason: data.reviewReason,
      },
    });
  }

  async claimSendFailedForResend(
    id: string,
    provenAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: {
        id,
        status: 'send_failed',
      },
      data: {
        status: 'pending',
        resendProvenAt: provenAt,
      },
    });
    return result.count > 0;
  }
}
