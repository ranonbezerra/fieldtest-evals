import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Payout, PayoutMessage } from '@prisma/client';
import { PayoutRepository, type CreatePayoutInput } from './payout.repository';
import { PAYOUT_PROVIDER, isDefinitiveProviderError, type PayoutProvider } from './payout.provider';

/**
 * Domain error. The global error filter renders these as the single API
 * envelope { "error": { "code", "message", "details" } }.
 */
export class PayoutError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

export interface PayoutDto {
  id: string;
  accountId: string;
  /** minor units as a decimal string (BigInt is not JSON-serializable) */
  amountMinor: string;
  destinationAddress: string;
  idempotencyKey: string;
  status: Payout['status'];
  txHash: string | null;
  failureReason: string | null;
  createdAt: Date;
}

function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amountMinor: payout.amountMinor.toString(),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    failureReason: payout.failureReason,
    createdAt: payout.createdAt,
  };
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  // All configuration comes from environment variables (see src/main.ts).
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryCapMs: number;
  private readonly batchLimit: number;
  private readonly staleClaimMs: number;

  constructor(
    @Inject(PayoutRepository) private readonly repository: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {
    this.maxAttempts = Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 5);
    this.retryBaseMs = Number(process.env.PAYOUT_RETRY_BASE_MS ?? 1_000);
    this.retryCapMs = Number(process.env.PAYOUT_RETRY_CAP_MS ?? 60_000);
    this.batchLimit = Number(process.env.PAYOUT_WORKER_BATCH_SIZE ?? 20);
    this.staleClaimMs = Number(process.env.PAYOUT_STALE_CLAIM_MS ?? 120_000);
  }

  /**
   * Creates a payout, or returns the one an earlier call with the same
   * idempotency key already created. Funds reservation (guarded debit), the
   * payout row, the balanced ledger pair and the outbox message commit in one
   * database transaction — the request never touches the provider.
   */
  async createPayout(input: CreatePayoutInput): Promise<PayoutDto> {
    const result = await this.repository.createPayout(input);
    switch (result.outcome) {
      case 'created':
        return toPayoutDto(result.payout);
      case 'duplicate':
        // Idempotent retry: same payout returned, nothing reserved twice.
        return toPayoutDto(result.payout);
      case 'account_not_found':
        throw new PayoutError(404, 'account_not_found', `account does not exist: ${input.accountId}`, {
          accountId: input.accountId,
        });
      case 'insufficient_funds':
        throw new PayoutError(
          409,
          'insufficient_funds',
          'account does not have enough available funds for this payout',
          {
            accountId: input.accountId,
            requestedMinor: input.amountMinor.toString(),
            availableMinor: result.availableMinor.toString(),
          },
        );
    }
  }

  /**
   * One polling pass. Safe to call repeatedly and concurrently: claiming is a
   * guarded UPDATE and every outcome transition is idempotent, so duplicate
   * delivery can never double-reserve, double-post the ledger, or (with a
   * single worker) double-transfer.
   */
  async processMessages(): Promise<void> {
    const claimToken = randomUUID();
    const claimed = await this.repository.claimMessages(this.batchLimit, claimToken, this.staleClaimMs);
    for (const message of claimed) {
      try {
        await this.processMessage(message);
      } catch (error) {
        // The message stays 'processing'; stale-claim recovery retries it.
        this.logger.error(
          `message ${message.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async processMessage(message: PayoutMessage): Promise<void> {
    const payout = await this.repository.findPayoutById(message.payoutId);
    if (!payout) {
      this.logger.error(`message ${message.id} references missing payout ${message.payoutId}`);
      await this.repository.finishMessage(message.id, 'dead');
      return;
    }

    switch (payout.status) {
      case 'completed':
      case 'failed':
        // Duplicate delivery after a terminal outcome: nothing left to do.
        await this.repository.finishMessage(message.id, 'done');
        return;
      case 'needs_review':
        // Already parked by a previous pass; stop delivering.
        await this.repository.finishMessage(message.id, 'dead');
        return;
      case 'created': {
        const flipped = await this.repository.transitionToProcessing(payout.id);
        if (flipped === 0) {
          // A concurrent worker owns this payout right now (stale double
          // claim). Back off; stale recovery will retry on a later pass.
          this.logger.warn(`payout ${payout.id} was already taken by another worker; backing off`);
          return;
        }
        break;
      }
      case 'processing':
        break; // retry of an in-flight payout
      case 'sent':
        // 'sent' is only ever committed together with 'completed' (one
        // transaction), so a live 'sent' row is a defensive no-op.
        break;
    }

    try {
      const { txHash } = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amountMinor,
      });
      await this.repository.applySent(payout.id, message.id, txHash);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (isDefinitiveProviderError(error)) {
        // The transfer is known NOT to have happened: fail the payout and
        // release the reservation (balanced ledger reversal).
        await this.repository.applyFailed(payout.id, message.id, reason);
        return;
      }
      const attempts = message.attempts + 1;
      if (attempts >= this.maxAttempts) {
        // Retries exhausted without a definitive outcome. Park for human
        // review and KEEP the reservation — see DESIGN.md.
        await this.repository.applyExhausted(payout.id, message.id, attempts, reason);
      } else {
        const backoffMs = Math.min(this.retryBaseMs * 2 ** (attempts - 1), this.retryCapMs);
        await this.repository.applyRetry(message.id, attempts, new Date(Date.now() + backoffMs), reason);
      }
    }
  }
}
