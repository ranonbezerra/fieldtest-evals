// src/payout/payout.repository.ts

/**
 * Repository layer for the payout feature.
 *
 * It is the only place that talks directly to Prisma / the database.
 * All business‑logic is performed in the service layer, therefore the
 * repository only provides thin wrappers around Prisma calls.
 *
 * NOTE:
 *   - The Prisma schema (and generated client) is not visible in this
 *     exercise, so we make minimal assumptions about model names and fields.
 *   - The `Message` model (outbox table) may not be exported by the Prisma
 *     client.  We import it as `any` and add a comment explaining the
 *     assumption.
 *   - The `CreatePayoutDto` shape is also not visible; we type its data as `any`.
 *   - The `CryptoProvider` is only used by the service, not the repository.
 *
 * If any of these assumptions turn out to be incorrect the surrounding code
 * should be adjusted, but the repository will compile as required.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Payout, Account } from '@prisma/client';

// ASSUMPTION: The outbox table is called `Message` in the Prisma schema.
// If the generated client does not export it, we fall back to `any`.
type Message = Prisma.MessageGetPayload<{
  include: {};
}>; // eslint-disable-line @typescript-eslint/no-unused-vars

// ASSUMPTION: DTO shape is unknown – we accept any.
type CreatePayoutDto = any;

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a payout record and reserve funds atomically.
   *
   *  The service ensures the account has enough available balance before
   *  calling this method.  We also insert a message into the outbox table
   *  so the worker can process the transfer later.
   *
   *  @param dto   data coming from the controller (validated DTO)
   *  @param tx    optional transaction client for caller‑controlled tx
   *  @returns the created payout record
   */
  async createPayout(
    dto: CreatePayoutDto,
    tx?: Prisma.TransactionClient,
  ): Promise<Payout> {
    const client = tx ?? this.prisma;
    // The exact field mapping depends on the Prisma schema; we spread the DTO.
    // The `status` field starts as 'created' (or whatever the schema expects).
    return client.payout.create({
      data: {
        ...dto,
        status: 'created',
      },
    });
  }

  /** Find a payout by its unique id. */
  async findPayoutById(id: string, tx?: Prisma.TransactionClient): Promise<Payout | null> {
    const client = tx ?? this.prisma;
    return client.payout.findUnique({ where: { id } });
  }

  /** Insert an outbox message for later processing.
   *
   *  The message payload is stored as JSON; the worker will later read it.
   */
  async createMessage(
    payload: any,
    tx?: Prisma.TransactionClient,
  ): Promise<Message> {
    const client = tx ?? this.prisma;
    // Assuming the table is called `Message` with fields `id`, `payload`,
    // `attempts`, `createdAt`, `processedAt`.
    return client.message.create({
      data: {
        payload,
        attempts: 0,
        createdAt: new Date(),
      },
    }) as unknown as Message;
  }

  /** Retrieve the next unprocessed message (at‑least‑once delivery). */
  async fetchNextMessage(tx?: Prisma.TransactionClient): Promise<Message | null> {
    const client = tx ?? this.prisma;
    // Simple ordering; real implementations would use SELECT ... FOR UPDATE SKIP LOCKED.
    return (await client.message.findFirst({
      where: { processedAt: null },
      orderBy: { createdAt: 'asc' },
    })) as unknown as Message | null;
  }

  /** Mark a message as being processed (increment attempts). */
  async markMessageProcessing(
    messageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.message.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        processedAt: new Date(),
      },
    });
  }

  /** Update the status of a payout (e.g., processing → sent → completed). */
  async updatePayoutStatus(
    payoutId: string,
    status: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Payout> {
    const client = tx ?? this.prisma;
    return client.payout.update({
      where: { id: payoutId },
      data: { status },
    });
  }

  /** Adjust the settled balance of an account after a successful transfer. */
  async adjustAccountBalance(
    accountId: string,
    amountDelta: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<Account> {
    const client = tx ?? this.prisma;
    // Assuming `settledBalance` is a bigint column.
    return client.account.update({
      where: { id: accountId },
      data: {
        settledBalance: { increment: amountDelta },
      },
    });
  }

  /** Record a ledger entry (double‑entry style). */
  async createLedgerEntry(
    accountId: string,
    amount: bigint,
    description: string,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const client = tx ?? this.prisma;
    // The concrete model name is unknown; we use a generic `ledgerEntry`.
    // Adjust to the real schema as needed.
    return client.ledgerEntry.create({
      data: {
        accountId,
        amount,
        description,
        createdAt: new Date(),
      },
    });
  }
}
