import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InvalidAmountException } from './payout.errors';

type TxClient = PrismaClient;

interface PendingMessageRow {
  id: string;
  payoutId: string;
  attemptCount: number;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Account ──────────────────────────────────────────────

  async reserveFunds(
    tx: TxClient,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) {
      throw new (await import('./payout.errors')).AccountNotFoundException(accountId);
    }

    const amountStr = amount.toString();
    const result = await tx.$executeRaw`
      UPDATE "accounts"
      SET "reserved" = "reserved" + ${amountStr}::bigint
      WHERE "id" = ${accountId}
        AND ("balance" - "reserved") >= ${amountStr}::bigint
    `;
    if (Number(result) === 0) {
      throw new (await import('./payout.errors')).InsufficientFundsException(accountId);
    }
  }

  async settle(tx: TxClient, accountId: string, amount: bigint): Promise<void> {
    const amountStr = amount.toString();
    const result = await tx.$executeRaw`
      UPDATE "accounts"
      SET "balance" = "balance" - ${amountStr}::bigint,
          "reserved" = "reserved" - ${amountStr}::bigint
      WHERE "id" = ${accountId}
        AND "reserved" >= ${amountStr}::bigint
    `;
    if (Number(result) === 0) {
      throw new Error(`Failed to settle payout: account ${accountId} not found or insufficient reserved`);
    }
  }

  async releaseReservation(
    tx: TxClient,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    const amountStr = amount.toString();
    const result = await tx.$executeRaw`
      UPDATE "accounts"
      SET "reserved" = "reserved" - ${amountStr}::bigint
      WHERE "id" = ${accountId}
        AND "reserved" >= ${amountStr}::bigint
    `;
    if (Number(result) === 0) {
      throw new Error(`Failed to release reservation: account ${accountId} not found or insufficient reserved`);
    }
  }

  async findAccount(tx: TxClient, accountId: string) {
    return tx.account.findUnique({
      where: { id: accountId },
      select: { id: true, balance: true, reserved: true },
    });
  }

  // ─── Payout ───────────────────────────────────────────────

  async findByIdempotencyKey(tx: TxClient, idempotencyKey: string) {
    return tx.payout.findUnique({
      where: { idempotencyKey },
    });
  }

  async findById(tx: TxClient, id: string) {
    return tx.payout.findUnique({
      where: { id },
    });
  }

  async createPayout(
    tx: TxClient,
    data: {
      accountId: string;
      amount: bigint;
      destinationAddress: string;
      idempotencyKey: string;
    },
  ) {
    return tx.payout.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        idempotencyKey: data.idempotencyKey,
        status: 'created',
      },
    });
  }

  async updatePayout(
    tx: TxClient,
    id: string,
    data: Partial<{
      status: string;
      txHash: string | null;
      lastError: string | null;
      attemptCount: number;
    }>,
  ) {
    return tx.payout.update({
      where: { id },
      data,
    });
  }

  async updatePayoutStatusIf(
    tx: TxClient,
    id: string,
    fromStatus: string,
    toStatus: string,
    extra?: Record<string, unknown>,
  ): Promise<number> {
    const result = await tx.payout.updateMany({
      where: { id, status: fromStatus },
      data: { status: toStatus, ...extra },
    });
    return Number(result.count);
  }

  // ─── Ledger ───────────────────────────────────────────────

  async createLedgerEntry(
    tx: TxClient,
    data: {
      accountId: string;
      payoutId: string;
      entryType: string;
      debit?: bigint;
      credit?: bigint;
    },
  ) {
    return tx.ledgerEntry.create({
      data: {
        accountId: data.accountId,
        payoutId: data.payoutId,
        entryType: data.entryType,
        debit: data.debit ?? BigInt(0),
        credit: data.credit ?? BigInt(0),
      },
    });
  }

  // ─── Message ────────────────────────────────────────────────

  async createMessage(tx: TxClient, payoutId: string) {
    return tx.payoutMessage.create({
      data: {
        payoutId,
        status: 'pending',
      },
    });
  }

  async findPendingMessages(limit: number): Promise<PendingMessageRow[]> {
    return this.prisma.$queryRaw<PendingMessageRow[]>`
      SELECT "id", "payout_id" as "payoutId", "attempt_count" as "attemptCount"
      FROM "payout_messages"
      WHERE "status" = 'pending'
        AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
        AND ("lock_until" IS NULL OR "lock_until" <= NOW())
      ORDER BY "created_at" ASC
      LIMIT ${limit}
    `;
  }

  async lockMessage(tx: TxClient, messageId: string, lockUntil: Date): Promise<boolean> {
    const result = await tx.$executeRaw`
      UPDATE "payout_messages"
      SET "lock_until" = ${lockUntil}, "updated_at" = NOW()
      WHERE "id" = ${messageId}
        AND "status" = 'pending'
        AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
        AND ("lock_until" IS NULL OR "lock_until" <= NOW())
    `;
    return Number(result) > 0;
  }

  async scheduleRetry(
    tx: TxClient,
    messageId: string,
    attemptCount: number,
    nextRetryAt: Date,
  ) {
    await tx.payoutMessage.update({
      where: { id: messageId },
      data: {
        attemptCount,
        nextRetryAt,
        status: 'pending',
        lockUntil: null,
      },
    });
  }

  async markMessageCompleted(tx: TxClient, messageId: string) {
    await tx.payoutMessage.update({
      where: { id: messageId },
      data: {
        status: 'completed',
        lockUntil: null,
      },
    });
  }

  async findMessageByPayoutId(payoutId: string) {
    return this.prisma.payoutMessage.findUnique({
      where: { payoutId },
    });
  }

  // ─── Test helpers ─────────────────────────────────────────

  async createAccount(data: { id: string; balance: bigint }) {
    return this.prisma.account.create({
      data: {
        id: data.id,
        balance: data.balance,
        reserved: BigInt(0),
      },
    });
  }

  async findMessageWithPayout(messageId: string) {
    return this.prisma.payoutMessage.findUnique({
      where: { id: messageId },
      include: { payout: true },
    });
  }
}
