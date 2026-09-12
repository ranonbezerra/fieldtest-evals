import { Injectable } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { ApiError } from './api-error.js';
import { HttpStatus } from '@nestjs/common';
import { Payout } from '@prisma/client';

// Custom error for insufficient funds
export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

@Injectable()
export class PayoutService {
  constructor(private readonly payoutRepository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<Payout> {
    const existing = await this.payoutRepository.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      return existing;
    }

    try {
      const payout = await this.payoutRepository.createPayoutWithReservation(
        dto.accountId,
        dto.amount,
        dto.destinationAddress,
        dto.idempotencyKey,
      );
      return payout;
    } catch (err: any) {
      if (err instanceof InsufficientFundsError) {
        throw new ApiError('insufficient_funds', err.message);
      }
      throw new ApiError('internal_error', err.message ?? 'Unexpected error', {}, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
