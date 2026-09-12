import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { Prisma, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto) {
    // Convert amount to BigInt safely
    let amount: bigint;
    try {
      amount = BigInt(dto.amount);
    } catch {
      throw new HttpException(
        {
          error: {
            code: 'invalid_amount',
            message: 'Amount must be an integer string',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Idempotency check handled inside repository transaction
    const payout = await this.repo.createPayout({
      accountId: dto.accountId,
      amount,
      destinationAddress: dto.destinationAddress,
      idempotencyKey: dto.idempotencyKey,
    });

    return payout;
  }
}
