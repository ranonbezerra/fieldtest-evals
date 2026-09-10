import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { CreatePayoutInput, CreatePayoutResult } from './payout.types';

// ASSUMPTION: PayoutRepository exposes findPayoutByAccountAndIdempotencyKey(accountId, key) → Payout | null
// and createPayoutWithReservation({ accountId, amount, destinationAddress, idempotencyKey }) → Payout,
// the latter performing an atomic check-and-reserve under a row-level lock.
// ASSUMPTION: CreatePayoutInput = { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }
// and CreatePayoutResult = { payoutId: string; idempotent: boolean }.

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    // Idempotency: return the existing payout if this (account, key) pair was already processed.
    const existing = await this.repository.findPayoutByAccountAndIdempotencyKey(
      input.accountId,
      input.idempotencyKey,
    );
    if (existing) {
      return { payoutId: existing.id, idempotent: true };
    }

    // Atomically: verify balance, reserve funds, insert the payout row, and
    // enqueue the processing message. The repository holds a row-level lock on
    // the account for the duration of the transaction, preventing concurrent
    // requests from overdraw.
    const payout = await this.repository.createPayoutWithReservation({
      accountId: input.accountId,
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      idempotencyKey: input.idempotencyKey,
    });

    return { payoutId: payout.id, idempotent: false };
  }
}
