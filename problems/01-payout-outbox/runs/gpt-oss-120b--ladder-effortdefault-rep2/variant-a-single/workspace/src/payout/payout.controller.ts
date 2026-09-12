import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PayoutService } from './payout.service.js';

export class CreatePayoutDto {
  accountId: string;
  amount: string; // stringified integer to avoid JS number issues
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: CreatePayoutDto) {
    try {
      const payout = await this.payoutService.createPayout({
        accountId: body.accountId,
        amount: BigInt(body.amount),
        destinationAddress: body.destinationAddress,
        idempotencyKey: body.idempotencyKey,
      });
      return payout;
    } catch (err: any) {
      if (err.code === 'INSUFFICIENT_FUNDS') {
        throw new HttpException(
          { error: { code: 'insufficient_funds', message: err.message, details: {} } },
          HttpStatus.BAD_REQUEST,
        );
      }
      // Unexpected error – propagate as internal server error
      throw new HttpException(
        {
          error: {
            code: 'internal_error',
            message: err.message ?? 'Unexpected error',
            details: {},
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
