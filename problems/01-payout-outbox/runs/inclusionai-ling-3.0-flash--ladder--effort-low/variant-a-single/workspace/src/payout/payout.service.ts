import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PayoutRepository } from './payout.repository';
import { ProviderService } from '../provider/provider.service';
import {
  PayoutStatus,
  MessageStatus,
  LedgerType,
  CreatePayoutInput,
  MAX_RETRIES,
  POLL_INTERVAL_MS,
} from './payout.types';
import { KnownError } from '../common/filters/exception.filter';
import type { Payout } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  /**
   * POST /payouts — create a payout if the account has sufficient available funds.
   * Idempotent on idempotencyKey. Reserve + payout creation + message queue
   * all happen in one transaction.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const { accountId, amount, destinationAddress, idempotencyKey } = input;

    // Validate input
    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new KnownError('invalid_amount', 'Amount must be a positive integer', 400);
    }
    if (!accountId || !destinationAddress || !idempotencyKey) {
      throw new KnownError('invalid_input', 'All fields are required', 400);
    }

    // Idempotency: return existing payout if key was already seen
    const existing = await this.payoutRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    // Check account exists
    const account = await this.payoutRepo.findAccount(accountId);
    if (!account) {
      throw new KnownError('account_not_found', 'Account not found', 404);
    }

    // Single transaction: reserve funds → create payout → queue message
    const payout = await this.prisma.$transaction(async (tx: any) => {
      // Atomic conditional reserve — only one concurrent caller can win per account
      const reserved = await this.payoutRepo.reserveFunds(accountId, amount);
      if (!reserved) {
        throw new KnownError('insufficient_funds', 'Insufficient available funds', 409);
      }

      // Create payout (status = CREATED, no money moved from settled balance)
      const created = await tx.payout.create({
        data: {
          accountId,
          amount,
          destinationAddress,
          idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      // Queue message in the same transaction — no orphaned reservation
      await tx.message.create({
        data: {
          payoutId: created.id,
          status: MessageStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      });

      // Ledger entry: HOLD documents the obligation without changing settled balance
      await tx.ledgerEntry.create({
        data: {
          accountId,
          amount: 0n,
          type: LedgerType.HOLD,
          payoutId: created.id,
        },
      });

      return created;
    });

    return payout;
  }

  /**
   * Polling worker — processes pending messages and checks SENT payouts for confirmation.
   * Safe against redelivery via conditional status transitions.
   */
  async processMessages(): Promise<void> {
    // 1. Process pending messages (send transfers)
    const messages = await this.payoutRepo.claimPendingMessages();

    for (const msg of messages) {
      await this.processSingleMessage(msg);
    }

    // 2. Check SENT payouts for on-chain confirmation
    const sentPayouts = await this.payoutRepo.findPayoutsByStatus(PayoutStatus.SENT);
    for (const payout of sentPayouts) {
      await this.attemptSettle(payout);
    }
  }

  /**
   * Process a single message: call provider, handle success/failure with bounded retries.
   */
  private async processSingleMessage(msg: {
    id: string;
    payoutId: string;
    attempts: number;
  }): Promise<void> {
    // Conditional transition CREATED → PROCESSING
    // If this returns null, another worker already grabbed it — this is a duplicate delivery
    const payout = await this.payoutRepo.tryStartProcessing(msg.payoutId);
    if (!payout) {
      // Another worker is already processing this payout — mark this message done
      await this.payoutRepo.markMessageProcessed(msg.id);
      return;
    }

    try {
      // Call external provider — NOT inside DB transaction
      const { txHash } = await this.provider.transfer(
        payout.destinationAddress,
        payout.amount,
      );

      // On success: mark payout SENT and message PROCESSED in a transaction
      await this.prisma.$transaction(async (tx: any) => {
        await this.payoutRepo.markSent(tx, payout.id, txHash, msg.id);
      });
    } catch {
      // Transient failure (throw, timeout, or slow)
      const attempts = msg.attempts + 1;

      if (attempts >= MAX_RETRIES) {
        // Retry exhausted — move to terminal review state, reservation stays intact
        await this.payoutRepo.markNeedsReview(payout.id);
        await this.payoutRepo.markMessageFailed(msg.id);
        // Do NOT reverse the reservation: the provider may have already settled.
      } else {
        // Schedule a retry with exponential backoff
        await this.payoutRepo.scheduleRetry(msg.id, attempts);
      }
    }
  }

  /**
   * Attempt to confirm a SENT payout and settle if confirmed.
   */
  private async attemptSettle(payout: {
    id: string;
    accountId: string;
    amount: bigint;
    txHash?: string | null;
  }): Promise<void> {
    if (!payout.txHash) return;

    try {
      const confirmed = await this.provider.confirmTransfer(payout.txHash);
      if (confirmed) {
        await this.payoutRepo.settlePayout(payout.id, payout.accountId, payout.amount);
      }
    } catch {
      // Provider confirm call failed — leave as SENT, will retry on next poll
    }
  }
}
