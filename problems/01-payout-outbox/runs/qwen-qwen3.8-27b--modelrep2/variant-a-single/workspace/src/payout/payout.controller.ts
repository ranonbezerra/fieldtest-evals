import { Body, Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(
    @Body()
    body: {
      accountId: string;
      amount: string;
      destinationAddress: string;
      idempotencyKey: string;
    },
  ) {
    return this.service.createPayout(body);
  }
}
