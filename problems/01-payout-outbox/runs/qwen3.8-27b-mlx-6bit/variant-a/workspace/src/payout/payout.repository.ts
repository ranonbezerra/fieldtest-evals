import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Account, Message, Payout, Prisma, PrismaClient } from '@prisma/client';
import { PayoutError } from './payout.errors';
import { CreatePayoutDto, MessageStatus, PayoutStatus } from './payout.types';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- account

  async getAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  /**
   * Atomically reserves `amount` from the account's available balance
   * (settled_balance - reserved_amount). The FOR UPDATE lock serializes
   * concurrent reservations on the account row so two racing requests can
   * never overdraw the account.
   */
  async reserveFunds(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{ settled_balance: bigint; reserved_amount: bigint }>
    >`
      SELECT settled_balance, reserved_amount
      FROM accounts
      WHERE id = ${accountId}
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) {
      throw new PayoutError('resource_not_found', `Account ${accountId} not found`);
    }

    const available = row.settled_balance - row.reserved_amount;
    if (available < amount) {
      throw new PayoutError(
        'insufficient_funds',
        `Account ${accountId} has insufficient available funds`,
        { accountId, available, requested: amount },
      );
    }

    await tx.account.update({
      where: { id: accountId },
      data: { reservedAmount: { increment: amount } },
    });

    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        accountId,
        type: 'reserve',
        amount,
      },
    });
  }

  /** Releases a previously reserved amount back to the account. */
  async releaseReserved(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await tx.account.update({
      where: { id: accountId },
      data: { reservedAmount: { decrement: amount } },
    });

    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        accountId,
        type: 'release',
        amount,
      },
    });
  }

  /**
   * Debits the account's settled balance. This is the only place the settled
   * balance decreases; it runs only after the provider confirms a transfer.
   */
  async settleOut(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: bigint,
  ): Promise<void> {
    await tx.account.update({
      where: { id: accountId },
      data: { settledBalance: { decrement: amount } },
    });

    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        accountId,
        type: 'settle_out',
        amount,
      },
    });
  }

  // ---------------------------------------------------------------- payout

  async findPayoutByIdempotencyKey(key: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }

  /**
   * Creates the payout (status `created`) and its queue message (status
   * `pending`) in the caller's transaction. Must run after reserveFunds so a
   * payout never exists without held funds.
   */
  async createPayoutWithMessage(
    tx: Prisma.TransactionClient,
    dto: CreatePayoutDto,
  ): Promise<Payout> {
    const payout = await tx.payout.create({
      data: {
        id: randomUUID(),
        accountId: dto.accountId,
        amount: dto.amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
        status: 'created',
      },
    });

    await tx.message.create({
      data: {
        id: randomUUID(),
        payoutId: payout.id,
        status: 'pending',
      },
    });

    return payout;
  }

  async getPayout(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  async updatePayoutStatus(
    id: string,
    status: PayoutStatus,
    txHash?: string,
  ): Promise<void> {
    await this.prisma.payout.update({
      where: { id },
      // `txHash` is undefined unless provided; Prisma skips undefined fields.
      data: { status, txHash },
    });
  }

  /** Increments the payout's attempt counter and returns the new count. */
  async incrementPayoutAttempts(id: string): Promise<number> {
    const payout = await this.prisma.payout.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    return payout.attempts;
  }

  // --------------------------------------------------------------- message

  /** Returns the oldest pending message, or null when the queue is empty. */
  async claimNextPendingMessage(): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * CAS claim: atomically moves the message from `pending` to `processing`.
   * Returns false when another worker already claimed it (lost the race).
   */
  async claimMessage(id: string): Promise<boolean> {
    const result = await this.prisma.message.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'processing' },
    });
    return result.count === 1;
  }

  async setMessageStatus(
    id: string,
    status: MessageStatus,
    lastError?: string,
  ): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: { status, lastError },
    });
  }

  /** Increments the message's attempt counter and returns the new count. */
  async incrementMessageAttempts(id: string): Promise<number> {
    const message = await this.prisma.message.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    return message.attempts;
  }
}
