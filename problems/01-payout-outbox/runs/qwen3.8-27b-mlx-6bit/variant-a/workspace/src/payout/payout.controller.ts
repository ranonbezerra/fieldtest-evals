import { Controller, Post, Body } from '@nestjs/common';
import type { CreatePayoutDto, PayoutResponse } from './payout.types.js';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() dto: CreatePayoutDto): Promise<PayoutResponse> {
    return this.service.create(dto);
  }
}
