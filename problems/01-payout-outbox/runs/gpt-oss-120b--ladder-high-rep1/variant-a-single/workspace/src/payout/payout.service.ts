import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { PayoutDto } from './dto/payout.dto.js';
import { Prisma, PayoutStatus } from '@prisma/client';
import { InsufficientFundsError } from './errors.js';

function errorResponse(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

@Injectable()
export class PayoutService {
  constructor(private readonly payoutRepository: PayoutRepository) {}

  async createPayout(dto: CreatePayoutDto): Promise<PayoutDto> {
    const { accountId, amount, destinationAddress, idempotencyKey } = dto;
    try {
      const result = await this.payoutRepository.createPayoutAndReserve({
        accountId,
        amount,
        destinationAddress,
        idempotencyKey,
      });
      return this.toDto(result.payout);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new HttpException(
          errorResponse('insufficient_funds', err.message),
          HttpStatus.BAD_REQUEST,
        );
      }
      // Unexpected errors
      throw new HttpException(
        errorResponse('internal_error', 'Unexpected error'),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private toDto(payout: Prisma.PayoutGetPayload<{}>): PayoutDto {
    return {
      id: payout.id.toString(),
      accountId: payout.accountId.toString(),
      amount: payout.amount.toString(),
      destinationAddress: payout.destinationAddress,
      status: payout.status,
      createdAt: payout.createdAt,
    };
  }
}
