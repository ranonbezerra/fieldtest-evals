import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  MessageStatus,
  PayoutStatus,
  CreatePayoutDto,
} from "./payout.types.js";

@Injectable()
export class PayoutRepository {
  constructor(public readonly prisma: PrismaService) {}

  async findAccountById(accountId: string) {
    return this.prisma.account.findUnique({ where: { id: accountId } });
  }

  async createAccount(id: string, settledBalance: bigint) {
    return this.prisma.account.create({
      data: { id, settledBalance },
    });
  }

  async findByCardIdempotencyKey(idempotencyKey: string) {
    return this.prisma.payout.findUnique({
      where: { idempotencyKey },
      include: { account: true },
    });
  }

  async atomicReserveAndCreatePayout(
    data: CreatePayoutDto,
  ): Promise<{ payout: unknown; messageId: string }> {
    return this.prisma.$transaction(async (tx: any) => {
      const reserveResult = await tx.$queryRaw<{ count: bigint }>`
        UPDATE accounts
        SET reserved_balance = reserved_balance + ${data.amount}
        WHERE id = ${data.accountId}
          AND settled_balance - reserved_balance >= ${data.amount}
      `;

      if (Number(reserveResult[0].count) === 0) {
        return null;
      }

      const payout = await tx.payout.create({
        data: {
          accountId: data.accountId,
          amount: data.amount,
          destinationAddress: data.destinationAddress,
          idempotencyKey: data.idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      const message = await tx.message.create({
        data: {
          payoutId: payout.id,
          status: MessageStatus.PENDING,
        },
      });

      return { payout, messageId: message.id };
    });
  }

  async findPendingMessages(limit = 100) {
    return this.prisma.message.findMany({
      where: { status: MessageStatus.PENDING },
      take: limit,
      include: { payout: true },
    });
  }

  async tryLockMessage(messageId: string) {
    const result = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        status: MessageStatus.PENDING,
      },
      data: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  async findSentPayoutsForConfirmation() {
    return this.prisma.payout.findMany({
      where: { status: PayoutStatus.SENT },
      include: { account: true },
    });
  }

  async markMessageCompleted(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED, updatedAt: new Date() },
    });
  }

  async markMessageFailed(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, updatedAt: new Date() },
    });
  }

  async incrementMessageAttempts(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  async releaseMessageToPending(messageId: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  async updatePayoutStatus(
    payoutId: string,
    status: PayoutStatus,
    extra?: { txHash?: string; confirmAttempts?: number },
  ) {
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status,
        ...(extra?.txHash !== undefined ? { txHash: extra.txHash } : {}),
        ...(extra?.confirmAttempts !== undefined
          ? { confirmAttempts: extra.confirmAttempts }
          : {}),
        updatedAt: new Date(),
      },
    });
  }

  async settlePayout(payoutId: string, accountId: string, amount: bigint) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.payout.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.COMPLETED, updatedAt: new Date() },
      });
      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalance: { decrement: amount },
          reservedBalance: { decrement: amount },
        },
      });
    });
  }

  async resetStuckMessages(timeoutMs: number) {
    const cutoff = new Date(Date.now() - timeoutMs);
    return this.prisma.message.updateMany({
      where: {
        status: MessageStatus.PROCESSING,
        processingStartedAt: { lt: cutoff as unknown as Date },
      },
      data: {
        status: MessageStatus.PENDING,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  async createPayoutDirectly(
    data: CreatePayoutDto & { idempotencyKey: string },
  ) {
    return this.prisma.payout.create({
      data: {
        accountId: data.accountId,
        amount: data.amount,
        destinationAddress: data.destinationAddress,
        idempotencyKey: data.idempotencyKey,
        status: PayoutStatus.CREATED,
      },
    });
  }

  async createMessageForPayout(payoutId: string) {
    return this.prisma.message.create({
      data: {
        payoutId,
        status: MessageStatus.PENDING,
      },
    });
  }
}
