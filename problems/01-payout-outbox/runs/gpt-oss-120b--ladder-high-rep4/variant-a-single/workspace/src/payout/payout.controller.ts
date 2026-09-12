import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { ApiError } from './api-error.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    try {
      const payout = await this.payoutService.createPayout(dto);
      return {
        id: payout.id,
        status: payout.status,
        amount: payout.amount.toString(),
        destinationAddress: payout.destination_address,
        createdAt: payout.created_at,
        txHash: payout.tx_hash ?? null,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new HttpException(
        { error: { code: 'internal_error', message: 'Unexpected error', details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
