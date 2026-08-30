import { Injectable } from '@nestjs/common';
import { PrismaClient, PayoutStatus, MessageStatus, LedgerDirection } from '@prisma/client';
import { InsufficientFundsError, DuplicatePayoutError } from './payout.service';

export interface MessageRow {
  id: string;
  payoutId: string;
  accountId: string;
  status: MessageStatus;
  attempts: number;
}

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayoutWithMessage(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payout.findFirst({
        where: {
          accountId: input.accountId,
          message: { idempotencyKey: input.idempotencyKey },
        },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicatePayoutError(
          'duplicate_payout',
          `A payout with idempotency key '${input.idempotencyKey}' already exists for account '${input.accountId}'.`,
        );
      }

      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        lock: { mode: 'FOR UPDATE' },
      });

      if (!account) {
        throw new DuplicatePayoutError(
          'resource_not_found',
          `Account '${input.accountId}' not found.`,
        );
      }

      const available = account.settledBalance - account.reservedAmount;
      if (available < input.amount) {
        throw new InsufficientFundsError(
          'insufficient_funds',
          `Account '${input.accountId}' has insufficient available funds. Available: ${available}, requested: ${input.amount}.`,
        );
      }

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          status: PayoutStatus.CREATED,
        },
      });

      await tx.payoutMessage.create({
        data: {
          payoutId: payout.id,
          accountId: input.accountId,
          idempotencyKey: input.idempotencyKey,
          status: MessageStatus.PENDING,
        },
      });

      await tx.account.update({
        where: { id: input.accountId },
        data: { reservedAmount: { increment: input.amount } },
      });

      return { payoutId: payout.id };
    });
  }

  async claimMessage(messageId: string): Promise<MessageRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.payoutMessage.findUnique({
        where: { id: messageId },
        lock: { mode: 'FOR UPDATE SKIP LOCKED' },
      });

      if (!message || message.status !== MessageStatus.PENDING) {
        return null;
      }

      const updated = await tx.payoutMessage.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.PROCESSING,
          claimedAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      return {
        id: updated.id,
        payoutId: updated.payoutId,
        accountId: updated.accountId,
        status: updated.status,
        attempts: updated.attempts,
      };
    });
  }

  async markProcessing(payoutId: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PROCESSING,
        processedAt: new Date(),
      },
    });
  }

  async recordAttemptFailure(payoutId: string, error: string): Promise<void> {
    await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        attempts: { increment: 1 },
        lastError: error,
      },
    });
  }

  async completePayout(payoutId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
      });

      await tx.ledgerEntry.create({
        data: {
          accountId: payout.accountId,
          payoutId: payout.id,
          direction: LedgerDirection.DEBIT,
          amount: payout.amount,
        },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          settledBalance: { decrement: payout.amount },
          reservedAmount: { decrement: payout.amount },
        },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.COMPLETED,
          txHash,
          completedAt: new Date(),
        },
      });

      await tx.payoutMessage.update({
        where: { payoutId },
        data: { status: MessageStatus.DONE },
      });
    });
  }

  async failPayout(payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
      });

      await tx.account.update({
        where: { id: payout.accountId },
        data: {
          reservedAmount: { decrement: payout.amount },
        },
      });

      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.FAILED,
          completedAt: new Date(),
        },
      });

      await tx.payoutMessage.update({
        where: { payoutId },
        data: { status: MessageStatus.DONE },
      });
    });
  }

  async markNeedsReview(payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.NEEDS_REVIEW,
          completedAt: new Date(),
        },
      });

      await tx.payoutMessage.update({
        where: { payoutId },
        data: { status: MessageStatus.DEAD },
      });
    });
  }

  async findPendingMessages(limit: number): Promise<MessageRow[]> {
    const messages = await this.prisma.payoutMessage.findMany({
      where: { status: MessageStatus.PENDING },
      take: limit,
    });

    return messages.map((m) => ({
      id: m.id,
      payoutId: m.payoutId,
      accountId: m.accountId,
      status: m.status,
      attempts: m.attempts,
    }));
  }

  async findMessageById(id: string): Promise<MessageRow | null> {
    const message = await this.prisma.payoutMessage.findUnique({
      where: { id },
    });

    if (!message) {
      return null;
    }

    return {
      id: message.id,
      payoutId: message.payoutId,
      accountId: message.accountId,
      status: message.status,
      attempts: message.attempts,
    };
  }

  async findPayoutByAccountIdemKey(
    accountId: string,
    idempotencyKey: string,
  ): Promise<{ payoutId: string } | null> {
    const payout = await this.prisma.payout.findFirst({
      where: {
        accountId,
        message: { idempotencyKey },
      },
      select: { id: true },
    });

    if (!payout) {
      return null;
    }

    return { payoutId: payout.id };
  }
}
