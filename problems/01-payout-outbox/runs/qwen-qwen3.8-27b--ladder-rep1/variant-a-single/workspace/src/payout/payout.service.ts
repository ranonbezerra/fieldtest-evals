import { Inject, Injectable } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { PayoutRepository } from './payout.repository.js';

export interface CreatePayoutInput {
  accountId: string;
  /** Minor units, already validated to be a positive decimal integer. */
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface PayoutResponse {
  id: string;
  accountId: string;
  status: string;
  /** Minor units, serialized as a decimal string. */
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
  attempts: number;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PayoutService {
  constructor(@Inject(PayoutRepository) private readonly payouts: PayoutRepository) {}

  async createPayout(input: CreatePayoutInput): Promise<PayoutResponse> {
    const result = await this.payouts.createPayoutAtomic(input);
    switch (result.status) {
      case 'created':
        return this.toResponse(result.payout);
      case 'duplicate':
        if (
          result.payout.amountMinorUnits === input.amount &&
          result.payout.destinationAddress === input.destinationAddress
        ) {
          // Idempotent replay: return the original payout, reserve nothing more.
          return this.toResponse(result.payout);
        }
        throw new ApiError(
          409,
          'idempotency_conflict',
          'idempotencyKey was already used with different payout parameters',
          { idempotencyKey: input.idempotencyKey },
        );
      case 'account_not_found':
        throw new ApiError(404, 'account_not_found', 'account does not exist', {
          accountId: input.accountId,
        });
      case 'insufficient_funds':
        throw new ApiError(
          409,
          'insufficient_funds',
          'account does not have enough available funds for this payout',
          { available: String(result.available), requested: String(input.amount) },
        );
    }
  }

  private toResponse(payout: Payout): PayoutResponse {
    return {
      id: payout.id,
      accountId: payout.accountId,
      status: payout.status,
      amount: String(payout.amountMinorUnits),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      attempts: payout.attempts,
      txHash: payout.txHash,
      createdAt: payout.createdAt.toISOString(),
      updatedAt: payout.updatedAt.toISOString(),
    };
  }
}
