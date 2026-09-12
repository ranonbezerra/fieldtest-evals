import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Payout } from '@prisma/client';
import { ResourceNotFoundError } from '../common/app-error.js';
import { CreatePayoutDto } from './payout.dto.js';
import { PayoutRepository } from './payout.repository.js';
import { DefinitiveTransferError, TRANSFER_PROVIDER, TransferProvider } from './transfer.provider.js';

export interface CreatePayoutResult {
  payout: Payout;
  duplicate: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    @Inject(TRANSFER_PROVIDER) private readonly provider: TransferProvider,
  ) {}

  /**
   * Creates a payout with an atomic reserve, or replays the existing payout
   * when the idempotency key was already used (no second payout, no second
   * reserve).
   */
  async createPayout(dto: CreatePayoutDto): Promise<CreatePayoutResult> {
    const account = await this.repo.findAccount(dto.accountId);
    if (!account) throw new ResourceNotFoundError('account', dto.accountId);

    const amountMinor = BigInt(dto.amount);

    try {
      const payout = await this.repo.createPayoutWithReserve({
        accountId: dto.accountId,
        amountMinor,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });
      return { payout, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.repo.findPayoutByIdempotencyKey(dto.idempotencyKey);
        if (existing) return { payout: existing, duplicate: true };
      }
      throw error;
    }
  }

  // ---- operations used by the polling worker ----

  findPayoutForMessage(messageId: string): Promise<Payout | null> {
    return this.repo.findPayoutForMessage(messageId);
  }

  takeDueMessages(limit: number) {
    return this.repo.takeDueMessages(limit);
  }

  claimMessage(messageId: string): Promise<boolean> {
    return this.repo.claimMessage(messageId);
  }

  markMessageProcessed(messageId: string): Promise<void> {
    return this.repo.markMessageProcessed(messageId);
  }

  scheduleMessageRetry(messageId: string, nextAttemptAt: Date, lastError: string): Promise<void> {
    return this.repo.scheduleMessageRetry(messageId, nextAttemptAt, lastError);
  }

  markMessageDead(messageId: string, lastError: string): Promise<void> {
    return this.repo.markMessageDead(messageId, lastError);
  }

  recoverStaleMessages(cutoff: Date): Promise<number> {
    return this.repo.recoverStaleMessages(cutoff);
  }

  /**
   * Drives one claimed message to a terminal (or retryable) state. Safe
   * under at-least-once delivery: every transition it applies is guarded by
   * the payout's current status, so a redelivered message is a no-op.
   */
  async processMessage(
    messageId: string,
    attemptNo: number,
    retry: RetryPolicy,
  ): Promise<'completed' | 'failed' | 'needs_review' | 'retry' | 'skipped'> {
    const payout = await this.repo.findPayoutForMessage(messageId);
    if (!payout) {
      await this.repo.markMessageDead(messageId, 'payout not found for message');
      return 'skipped';
    }

    switch (payout.status) {
      case 'COMPLETED':
      case 'FAILED':
        // already resolved by an earlier delivery
        await this.repo.markMessageProcessed(messageId);
        return 'skipped';
      case 'NEEDS_REVIEW':
        // deliberately never retried automatically
        await this.repo.markMessageDead(messageId, 'payout already escalated to manual review');
        return 'skipped';
      case 'SENT': {
        // crash recovery: the provider confirmed the transfer (txHash stored)
        // but settlement never ran. Finalizing is idempotent.
        await this.repo.finalizePayout(payout.id);
        await this.repo.markMessageProcessed(messageId);
        return 'completed';
      }
      case 'CREATED': {
        const started = await this.repo.startPayoutProcessing(payout.id);
        if (!started) {
          // a concurrent pass (redelivery) already advanced the payout;
          // leave the message for that pass / stale recovery
          return 'skipped';
        }
        // fall through: attempt the transfer
      }
      case 'PROCESSING': {
        try {
          const { txHash } = await this.provider.transfer({
            to: payout.destinationAddress,
            amount: payout.amountMinor,
          });
          await this.repo.markPayoutSent(payout.id, txHash);
          // the settled balance changes only here, on provider confirmation
          await this.repo.finalizePayout(payout.id);
          await this.repo.markMessageProcessed(messageId);
          return 'completed';
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (error instanceof DefinitiveTransferError) {
            // definitive: the transfer did not happen — fail and release the hold
            await this.repo.failPayout(payout.id, reason);
            await this.repo.markMessageProcessed(messageId);
            return 'failed';
          }
          if (attemptNo >= retry.maxAttempts) {
            // unknown outcome, retries exhausted: keep the hold and escalate.
            // A timeout is not a failure — the transfer may have landed — so
            // releasing the funds here could double-spend the customer.
            await this.repo.escalatePayout(
              payout.id,
              `retries exhausted without a definitive outcome: ${reason}`,
            );
            await this.repo.markMessageDead(messageId, reason);
            return 'needs_review';
          }
          const backoffMs = Math.min(retry.backoffMaxMs, retry.backoffBaseMs * 2 ** (attemptNo - 1));
          await this.repo.scheduleMessageRetry(messageId, new Date(Date.now() + backoffMs), reason);
          return 'retry';
        }
      }
      default:
        throw new Error(`unexpected payout status ${(payout as Payout).status} for message ${messageId}`);
    }
  }
}
