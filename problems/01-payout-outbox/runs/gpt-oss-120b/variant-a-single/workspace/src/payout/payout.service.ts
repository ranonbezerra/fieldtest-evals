// src/payout/payout.service.ts

import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoProvider } from '../provider/crypto.provider';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { PayoutRepository } from './payout.repository';

// ASSUMPTION: The repository exposes the methods used below with the indicated signatures.
// If the real repository differs, adjust the calls accordingly.

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PayoutRepository,
    private readonly cryptoProvider: CryptoProvider,
  ) {}

  /**
   * Creates a payout request while guaranteeing:
   *   - Idempotency (no double‑reserve for the same idempotencyKey)
   *   - Sufficient funds (account balance is checked inside a transaction)
   *   - Ledger entry for the reserved amount
   *   - Outbox message for asynchronous processing
   */
  async createPayout(dto: CreatePayoutDto): Promise<any> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1️⃣ Idempotency check – if a payout already exists for this key, return it.
      const existingPayout = await this.repository.findByIdempotencyKey(
        dto.idempotencyKey,
        tx,
      );
      if (existingPayout) {
        return existingPayout;
      }

      // 2️⃣ Load the account with a row‑level lock (FOR UPDATE) to avoid races.
      const account = await this.repository.getAccountForUpdate(
        dto.accountId,
        tx,
      );
      if (!account) {
        throw new Error('Account not found');
      }

      // 3️⃣ Verify sufficient available balance.
      if (account.availableBalance < dto.amount) {
        throw new Error('Insufficient funds');
      }

      // 4️⃣ Create a ledger entry that *reserves* the amount.
      await this.repository.createLedgerEntry(
        {
          accountId: dto.accountId,
          amount: -dto.amount, // negative = debit / reservation
          type: 'RESERVED', // ASSUMPTION: enum/value understood by the repository
          referenceId: null,
        },
        tx,
      );

      // 5️⃣ Persist the payout record (status = 'CREATED').
      const payout = await this.repository.createPayout(dto, tx);

      // 6️⃣ Enqueue an outbox message for the async worker.
      await this.repository.createMessage(
        {
          payoutId: payout.id,
          type: 'PAYOUT',
          payload: JSON.stringify(dto),
          attempts: 0,
        },
        tx,
      );

      return payout;
    });
  }

  /**
   * Worker‑side processing of a single outbox message.
   * Delivery is at‑least‑once; the method must be safe against duplicate execution.
   *
   * @param messageId Identifier of the outbox message to process.
   */
  async processMessage(messageId: number): Promise<void> {
    // Load the message (no transaction – we only read here).
    const message = await this.repository.findMessageById(messageId);
    if (!message) {
      // Message may have been already processed/deleted.
      return;
    }

    // Load the associated payout.
    const payout = await this.repository.findPayoutById(message.payoutId);
    if (!payout) {
      // Inconsistent state – mark the message for review.
      await this.repository.markMessageNeedsReview(message.id);
      return;
    }

    const MAX_ATTEMPTS = 3;

    // The whole processing is wrapped in a transaction to guarantee atomic updates.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      try {
        // Attempt the blockchain transfer.
        const result = await this.cryptoProvider.transfer({
          to: payout.destinationAddress,
          amount: payout.amount,
        });

        // Transfer succeeded – update payout status.
        await this.repository.updatePayoutStatus(
          payout.id,
          'SENT', // ASSUMPTION: status literals understood by the repository
          tx,
        );

        // Create a settled ledger entry (credit).
        await this.repository.createLedgerEntry(
          {
            accountId: payout.accountId,
            amount: payout.amount, // positive = credit / settlement
            type: 'SETTLED',
            referenceId: payout.id,
          },
          tx,
        );

        // Remove the processed outbox message.
        await this.repository.deleteMessage(message.id, tx);
      } catch (err) {
        // Transfer failed – decide whether to retry or give up.
        const attempts = (message.attempts ?? 0) + 1;

        if (attempts >= MAX_ATTEMPTS) {
          // Exhausted retries – mark payout as failed and remove the message.
          await this.repository.updatePayoutStatus(
            payout.id,
            'FAILED',
            tx,
          );
          await this.repository.deleteMessage(message.id, tx);
        } else {
          // Increment the attempt counter so the worker can retry later.
          await this.repository.updateMessageAttempts(
            message.id,
            attempts,
            tx,
          );
        }
      }
    });
  }
}
