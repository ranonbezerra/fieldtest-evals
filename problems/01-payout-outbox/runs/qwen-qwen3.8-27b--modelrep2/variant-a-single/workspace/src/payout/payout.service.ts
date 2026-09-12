import { Injectable } from '@nestjs/common';
import { Prisma, PayoutStatus } from '@prisma/client';
import { LedgerEntryDto, PayoutDto } from './dto-payout.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutConfigService } from './payout.config.service.js';
import { TransferProvider } from './transfer.provider.js';

export class PayoutServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly httpStatus = 400,
  ) {
    super(message);
  }
}

export class TransferDefinitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferDefinitiveError';
  }
}

const HOLD_ACCOUNT = 'payouts.hold';
const MAX_KEY_LENGTH = 128;

@Injectable()
export class PayoutService {
  constructor(
    private readonly payouts: PayoutRepository,
    private readonly transfers: TransferProvider,
    private readonly config: PayoutConfigService,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<PayoutDto> {
    this.assertPositiveAmount(input.amount);
    if (input.idempotencyKey.length > MAX_KEY_LENGTH) {
      throw new PayoutServiceError('validation_error', 'idempotencyKey must be at most 128 characters.');
    }

    // Hold batch: funds move from available balance to the payout hold
    // account. The idempotency key is unique, so it doubles as a stable
    // batch id before the payout row exists.
    const hold = this.holdEntries(input.idempotencyKey, input.accountId, input.amount);

    try {
      const result = await this.payouts.createWithDebit(input, hold);
      if (!result.ok) {
        throw new PayoutServiceError(
          'insufficient_funds',
          'Account balance is insufficient for this payout.',
          { accountId: input.accountId, amount: input.amount.toString() },
          422,
        );
      }
      return this.toDto(result.payout);
    } catch (err) {
      // A concurrent request already committed this idempotency key.
      // Re-fetch and return it (or 409 if the payloads differ).
      if (this.isUniqueViolation(err, 'idempotency_key')) {
        const existing = await this.payouts.findPayoutByIdempotencyKey(input.accountId, input.idempotencyKey);
        if (existing) {
          this.assertSamePayload(existing, input);
          return this.toDto(existing);
        }
      }
      throw err;
    }
  }

  async findPayout(id: string): Promise<PayoutDto | null> {
    const payout = await this.payouts.findPayoutById(id);
    return payout ? this.toDto(payout) : null;
  }

  async listPayouts(limit: number, offset: number): Promise<PayoutDto[]> {
    const payouts = await this.payouts.listPayouts(limit, offset);
    return payouts.map((p) => this.toDto(p));
  }

  /**
   * One outbox delivery. At-least-once: every branch is idempotent, so a
   * redelivered message cannot double-post, double-debit or double-transfer.
   */
  async processMessage(messageId: bigint, now = new Date()): Promise<void> {
    const claimed = await this.payouts.claimMessage(now);
    if (!claimed || claimed.id !== messageId) {
      throw new PayoutServiceError(
        'resource_not_found',
        `Outbox message ${messageId} is not claimable.`,
        {},
        404,
      );
    }

    const payout = await this.payouts.findPayoutById(claimed.payoutId);
    if (!payout) {
      throw new PayoutServiceError('resource_not_found', `Payout ${claimed.payoutId} not found.`, {}, 404);
    }

    // Duplicate delivery of an already settled or failed payout: no-op.
    if (payout.status === PayoutStatus.sent || payout.status === PayoutStatus.completed) {
      await this.payouts.markMessageHandled(messageId);
      return;
    }

    let txHash: string;
    try {
      const result = await this.transfers.transfer({ to: payout.destinationAddress, amount: payout.amount });
      txHash = result.txHash;
    } catch (err) {
      if (err instanceof TransferDefinitiveError) {
        const reversed = await this.payouts.failFinal(payout.id, this.reversalEntries(payout));
        if (reversed) await this.payouts.markMessageHandled(messageId);
        return;
      }
      // Transient / unknown outcome: bounded retry, then needs-review.
      if (claimed.attemptCount < this.config.maxDeliveryAttempts) {
        await this.payouts.markRetry(messageId, this.nextAttemptAt(now, claimed.attemptCount));
      } else {
        await this.payouts.exhaust(messageId, payout.id);
      }
      return;
    }

    const settled = await this.payouts.completeSent(payout.id, txHash, this.settlementEntries(payout), now);
    if (settled) await this.payouts.markMessageHandled(messageId);
  }

  private assertPositiveAmount(amount: bigint): void {
    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new PayoutServiceError('validation_error', 'amount must be a positive integer of minor units.');
    }
  }

  private assertSamePayload(
    existing: { amount: bigint; destinationAddress: string },
    input: { amount: bigint; destinationAddress: string },
  ): void {
    if (existing.amount !== input.amount || existing.destinationAddress !== input.destinationAddress) {
      throw new PayoutServiceError(
        'idempotency_conflict',
        'idempotencyKey was already used with a different payout payload.',
        {},
        409,
      );
    }
  }

  private holdEntries(batchId: string, accountId: string, amount: bigint): LedgerEntryDto[] {
    return [
      { batchId: `hold-${batchId}`, entryType: 'debit', accountId, amount, memo: 'payout hold (created)' },
      { batchId: `hold-${batchId}`, entryType: 'credit', accountId: HOLD_ACCOUNT, amount: -amount, memo: 'payout hold (created)' },
    ];
  }

  /**
   * Settlement, posted only after provider confirmation: the account's
   * settlement position is debited and the hold is cleared.
   */
  private settlementEntries(payout: { id: string; accountId: string; amount: bigint }): LedgerEntryDto[] {
    return [
      { batchId: `settle-${payout.id}`, entryType: 'debit', accountId: payout.accountId, amount: -payout.amount, memo: 'payout settled' },
      { batchId: `settle-${payout.id}`, entryType: 'credit', accountId: HOLD_ACCOUNT, amount: payout.amount, memo: 'payout settled' },
    ];
  }

  /**
   * Reversal on definitive failure: the hold is released back to the
   * account's available balance.
   */
  private reversalEntries(payout: { id: string; accountId: string; amount: bigint }): LedgerEntryDto[] {
    return [
      { batchId: `reversal-${payout.id}`, entryType: 'debit', accountId: HOLD_ACCOUNT, amount: payout.amount, memo: 'payout failed (reversal)' },
      { batchId: `reversal-${payout.id}`, entryType: 'credit', accountId: payout.accountId, amount: -payout.amount, memo: 'payout failed (reversal)' },
    ];
  }

  private nextAttemptAt(now: Date, attemptCount: number): Date {
    const backoffMs = this.config.backoffSeconds * 1000 * 2 ** attemptCount;
    return new Date(now.getTime() + backoffMs);
  }

  private isUniqueViolation(err: unknown, field: string): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
    const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]) : [];
    return target.some((t) => t === field || t === `${field}_key` || t.endsWith(`_${field}_key`));
  }

  private toDto(payout: {
    id: string;
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
    status: PayoutStatus;
    txHash: string | null;
    sentAt: Date | null;
  }): PayoutDto {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
      sentAt: payout.sentAt,
    };
  }
}
