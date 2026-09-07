import { Inject, Injectable } from '@nestjs/common';
import { Payout, Prisma } from '@prisma/client';
import { DomainError, insufficientFunds, resourceNotFound } from '../common/errors';
import { BLOCKCHAIN_PROVIDER, BlockchainProvider, ProviderOutcome } from './blockchain-provider';
import { PayoutConfig, PAYOUT_CONFIG } from './payout.config';
import { ClaimedMessage, PayoutRepository } from './payout.repository';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface CreatePayoutResult {
  payout: Payout;
  created: boolean;
}

/**
 * Thrown inside the creation transaction when the idempotency key was just taken
 * by a concurrent request. It forces a rollback so the reservation made earlier in
 * the same transaction is not committed without a payout.
 */
class DuplicatePayoutSignal extends Error {
  constructor() {
    super('Duplicate idempotency key');
  }
}

function isPrismaUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    @Inject(BLOCKCHAIN_PROVIDER) private readonly provider: BlockchainProvider,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  /**
   * Creates a payout: reserves funds, writes the payout, enqueues the transfer
   * message and posts the reservation ledger entries — all in one transaction.
   * The provider is NOT called here; the worker executes the transfer later.
   */
  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    const replay = await this.repo.findPayoutByIdempotencyKey(input.idempotencyKey);
    if (replay) return { payout: replay, created: false };

    const accountExists = await this.repo.accountExists(input.accountId);
    if (!accountExists) throw resourceNotFound('account', input.accountId);

    try {
      const payout = await this.repo.withTransaction(async (tx) => {
        const reserved = await this.repo.reserveFundsTx(tx, input.accountId, input.amount);
        if (!reserved) {
          const available = (await this.repo.getAvailableBalanceTx(tx, input.accountId)) ?? 0n;
          throw insufficientFunds(input.accountId, available, input.amount);
        }

        try {
          return await this.repo.createPayoutTx(tx, {
            accountId: input.accountId,
            idempotencyKey: input.idempotencyKey,
            destinationAddress: input.destinationAddress,
            amount: input.amount,
          });
        } catch (err) {
          // A concurrent request committed the same key. Roll back (releasing our
          // reservation); the winner's row is committed by the time P2002 fires, so
          // we can safely fetch it outside this transaction.
          if (isPrismaUniqueViolation(err)) throw new DuplicatePayoutSignal();
          throw err;
        }
      });

      // Outbox + ledger: the transfer happens asynchronously via the worker.
      await this.repo.withTransaction(async (tx) => {
        await this.repo.createMessageTx(tx, { kind: 'payout_transfer', refId: payout.id });
        await this.repo.createLedgerEntriesTx(tx, [
          { payoutId: payout.id, accountId: input.accountId, bucket: 'reserved', side: 'debit', amount: input.amount },
          { payoutId: payout.id, accountId: input.accountId, bucket: 'available', side: 'credit', amount: input.amount },
        ]);
      });

      return { payout, created: true };
    } catch (err) {
      if (err instanceof DuplicatePayoutSignal) {
        const existing = await this.repo.findPayoutByIdempotencyKey(input.idempotencyKey);
        if (existing) return { payout: existing, created: false };
        throw new DomainError(
          409,
          'conflict',
          'A concurrent request with the same idempotency key is in flight; please retry.',
          { idempotencyKey: input.idempotencyKey },
        );
      }
      throw err;
    }
  }

  /** Idempotent handler for one outbox message; safe under at-least-once redelivery. */
  async processMessage(message: ClaimedMessage): Promise<void> {
    if (message.kind === 'payout_transfer') await this.processTransfer(message);
    else if (message.kind === 'payout_finalize') await this.processFinalize(message);
  }

  /** Invoked by the worker when a message handler throws unexpectedly. */
  async handleMessageError(message: ClaimedMessage, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    const payout = await this.repo.findPayout(message.refId).catch(() => null);
    const nextRetry = message.retryCount + 1;

    if (payout && payout.status === 'processing') {
      // An attempt may have reached the provider with an unrecorded outcome: fail closed.
      await this.repo.withTransaction(async (tx) => {
        await this.repo.compareAndSetPayoutTx(tx, payout.id, ['processing'], {
          status: 'needs_review',
          failureReason: `worker error with unverifiable outcome: ${reason}`,
        });
        await this.repo.patchMessageTx(tx, message.id, { status: 'dead', retryCount: nextRetry, lastError: reason });
      });
      return;
    }
    if (nextRetry >= this.config.maxAttempts) {
      await this.repo.withTransaction((tx) =>
        this.repo.patchMessageTx(tx, message.id, { status: 'dead', retryCount: nextRetry, lastError: reason }),
      );
      return;
    }
    // Payout still 'created' means the provider was never reached: retrying is safe.
    await this.repo.withTransaction((tx) =>
      this.repo.patchMessageTx(tx, message.id, {
        status: 'pending',
        retryCount: nextRetry,
        nextAttemptAt: new Date(Date.now() + this.backoffMs(message.retryCount)),
        lastError: reason,
      }),
    );
  }

  private async processTransfer(message: ClaimedMessage): Promise<void> {
    const payout = await this.repo.findPayout(message.refId);
    if (!payout) {
      await this.repo.withTransaction((tx) =>
        this.repo.patchMessageTx(tx, message.id, { status: 'done', lastError: 'payout not found; discarding message' }),
      );
      return;
    }

    if (payout.status === 'created') {
      // Claim the attempt. From this commit on, a crash before the outcome is
      // recorded leaves the payout in 'processing', which is never re-attempted.
      const claimed = await this.repo.withTransaction((tx) =>
        this.repo.compareAndSetPayoutTx(tx, payout.id, ['created'], {
          status: 'processing',
          providerAttemptedAt: new Date(),
        }),
      );
      if (!claimed) {
        const fresh = await this.repo.findPayout(payout.id);
        if (fresh && fresh.status === 'processing') {
          await this.markUnverifiable(
            message,
            fresh,
            'concurrent delivery while transfer in flight; outcome unverifiable',
          );
          return;
        }
        await this.repo.withTransaction((tx) => this.repo.patchMessageTx(tx, message.id, { status: 'done' }));
        return;
      }

      const outcome = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amount });
      await this.applyTransferOutcome(message, payout, outcome);
      return;
    }

    if (payout.status === 'processing') {
      // A previous attempt started but recorded no outcome (crashed worker, lease
      // expiry). The provider SDK has no idempotency key, so calling it again could
      // pay the same destination twice: fail closed instead.
      await this.markUnverifiable(
        message,
        payout,
        'duplicate delivery while transfer in flight; outcome unverifiable',
      );
      return;
    }

    // sent / completed / failed / needs_review: the transfer is already resolved;
    // a redelivered message is a no-op.
    await this.repo.withTransaction((tx) => this.repo.patchMessageTx(tx, message.id, { status: 'done' }));
  }

  private async applyTransferOutcome(message: ClaimedMessage, payout: Payout, outcome: ProviderOutcome): Promise<void> {
    if (outcome.kind === 'confirmed') {
      await this.repo.withTransaction(async (tx) => {
        // Provider confirmation is the only moment settled_balance changes.
        const moved = await this.repo.compareAndSetPayoutTx(tx, payout.id, ['processing'], {
          status: 'sent',
          txHash: outcome.txHash,
        });
        if (!moved) return; // lost to a concurrent decision; leave everything untouched
        await this.repo.adjustBalancesTx(tx, payout.accountId, { settled: payout.amount, reserved: payout.amount });
        await this.repo.createLedgerEntriesTx(tx, [
          { payoutId: payout.id, accountId: payout.accountId, bucket: 'in_transit', side: 'debit', amount: payout.amount },
          { payoutId: payout.id, accountId: payout.accountId, bucket: 'reserved', side: 'credit', amount: payout.amount },
        ]);
        await this.repo.createMessageTx(tx, { kind: 'payout_finalize', refId: payout.id });
        await this.repo.patchMessageTx(tx, message.id, { status: 'done' });
      });
      return;
    }

    if (outcome.kind === 'rejected') {
      // Definitive: the provider will never execute this transfer, so the
      // reservation is released back to the account.
      await this.repo.withTransaction(async (tx) => {
        const moved = await this.repo.compareAndSetPayoutTx(tx, payout.id, ['processing'], {
          status: 'failed',
          failureReason: outcome.reason,
        });
        if (!moved) return;
        await this.repo.adjustBalancesTx(tx, payout.accountId, { reserved: payout.amount });
        await this.repo.createLedgerEntriesTx(tx, [
          { payoutId: payout.id, accountId: payout.accountId, bucket: 'available', side: 'debit', amount: payout.amount },
          { payoutId: payout.id, accountId: payout.accountId, bucket: 'reserved', side: 'credit', amount: payout.amount },
        ]);
        await this.repo.patchMessageTx(tx, message.id, { status: 'done' });
      });
      return;
    }

    if (outcome.kind === 'transient') {
      const nextRetry = message.retryCount + 1;
      if (nextRetry < this.config.maxAttempts) {
        await this.repo.withTransaction(async (tx) => {
          // The provider explicitly said "not executed", so retrying is safe:
          // roll the payout back to 'created' for the next attempt.
          await this.repo.compareAndSetPayoutTx(tx, payout.id, ['processing'], {
            status: 'created',
            providerAttemptedAt: null,
          });
          await this.repo.patchMessageTx(tx, message.id, {
            status: 'pending',
            retryCount: nextRetry,
            nextAttemptAt: new Date(Date.now() + this.backoffMs(message.retryCount)),
            lastError: outcome.reason,
          });
        });
        return;
      }
      // Retries exhausted without a definitive success: fail closed and keep the
      // funds reserved for operator review.
      await this.markUnverifiable(
        message,
        payout,
        `retries exhausted without a definitive provider outcome: ${outcome.reason}`,
        nextRetry,
      );
      return;
    }

    // kind === 'unknown': the transfer may or may not have happened; never auto-retry.
    await this.markUnverifiable(message, payout, `unverifiable provider outcome: ${outcome.reason}`);
  }

  private async processFinalize(message: ClaimedMessage): Promise<void> {
    const payout = await this.repo.findPayout(message.refId);
    if (!payout || payout.status !== 'sent') {
      // Duplicate delivery (already completed) or unexpected state: no-op.
      await this.repo.withTransaction((tx) => this.repo.patchMessageTx(tx, message.id, { status: 'done' }));
      return;
    }
    await this.repo.withTransaction(async (tx) => {
      const moved = await this.repo.compareAndSetPayoutTx(tx, payout.id, ['sent'], { status: 'completed' });
      if (!moved) return;
      // Final booking: funds leave the in-transit bucket. Balances already moved at
      // 'sent'; only the ledger changes here.
      await this.repo.createLedgerEntriesTx(tx, [
        { payoutId: payout.id, accountId: payout.accountId, bucket: 'settled_out', side: 'debit', amount: payout.amount },
        { payoutId: payout.id, accountId: payout.accountId, bucket: 'in_transit', side: 'credit', amount: payout.amount },
      ]);
      await this.repo.patchMessageTx(tx, message.id, { status: 'done' });
    });
  }

  private async markUnverifiable(
    message: ClaimedMessage,
    payout: Payout,
    reason: string,
    retryCount?: number,
  ): Promise<void> {
    await this.repo.withTransaction(async (tx) => {
      await this.repo.compareAndSetPayoutTx(tx, payout.id, ['created', 'processing'], {
        status: 'needs_review',
        failureReason: reason,
      });
      await this.repo.patchMessageTx(tx, message.id, { status: 'dead', retryCount, lastError: reason });
    });
  }

  private backoffMs(retryCount: number): number {
    return Math.min(this.config.retryBaseMs * 2 ** Math.min(retryCount, 10), 900_000);
  }
}
