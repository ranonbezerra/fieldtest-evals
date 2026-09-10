import { Injectable } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { CreatePayoutDto, PayoutView } from './payout.dto.js';
import { DuplicateIdempotencyKeyError, InvalidAmountError } from './payout-errors.js';
import { PayoutRepository } from './payout.repository.js';

export interface PayoutResult {
  payout: PayoutView;
  replayed: boolean;
}

const MINOR_UNITS_PATTERN = /^[0-9]{1,19}$/;

@Injectable()
export class PayoutService {
  constructor(private readonly repository: PayoutRepository) {}

  createPayout(input: CreatePayoutDto): Promise<PayoutResult> {
    return this.createPayoutInternal(
      input.accountId,
      input.amount,
      input.destinationAddress,
      input.idempotencyKey,
    );
  }

  private async createPayoutInternal(
    accountId: string,
    rawAmount: string,
    destinationAddress: string,
    idempotencyKey: string,
  ): Promise<PayoutResult> {
    const amount = this.parseAmount(rawAmount);
    try {
      const payout = await this.repository.createPayout({
        accountId,
        amount,
        destinationAddress,
        idempotencyKey,
      });
      return { payout: this.toView(payout), replayed: false };
    } catch (error) {
      if (error instanceof DuplicateIdempotencyKeyError) {
        // A retried key: return the original payout and reserve nothing further.
        const existing = await this.repository.findPayoutByKey(accountId, idempotencyKey);
        if (existing) {
          return { payout: this.toView(existing), replayed: true };
        }
      }
      throw error;
    }
  }

  private parseAmount(raw: string): bigint {
    if (!MINOR_UNITS_PATTERN.test(raw) || BigInt(raw) <= 0n) {
      throw new InvalidAmountError(raw);
    }
    return BigInt(raw);
  }

  private toView(payout: Payout): PayoutView {
    return {
      id: payout.id,
      accountId: payout.accountId,
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      idempotencyKey: payout.idempotencyKey,
      status: payout.status,
      txHash: payout.txHash,
      createdAt: payout.createdAt.toISOString(),
    };
  }
}
