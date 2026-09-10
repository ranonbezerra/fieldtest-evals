import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreatePayoutDto, PayoutView } from './payout.dto.js';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /**
   * POST /payouts — create a payout (201) or, on a retry with the same
   * idempotencyKey, return the original payout (200).
   */
  @Post()
  async create(
    @Body() body: CreatePayoutDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PayoutView> {
    const result = await this.service.createPayout(body);
    response.status(result.replayed ? 200 : 201);
    return result.payout;
  }
}
