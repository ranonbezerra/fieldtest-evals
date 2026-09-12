import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutRepository, InsufficientFundsError } from './payout.repository';
import { Payout } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(private readonly payoutRepository: PayoutRepository) {}

  async createPayout(
    accountId: string,
    amount: bigint,
    destinationAddress: string,
    idempotencyKey: string,
  ): Promise<Payout> {
    // Idempotency – return existing payout if present
    const existing = await this.payoutRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    try {
      const payout = await this.payoutRepository.reserveAndCreatePayout(
        accountId,
        amount,
        destinationAddress,
        idempotencyKey,
      );
      return payout;
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new HttpException(
          {
            error: {
              code: 'insufficient_funds',
              message: 'Insufficient available funds',
              details: {},
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      // Propagate unexpected errors as internal errors
      throw new HttpException(
        {
          error: {
            code: 'internal_error',
            message: err.message ?? 'Internal server error',
            details: {},
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
