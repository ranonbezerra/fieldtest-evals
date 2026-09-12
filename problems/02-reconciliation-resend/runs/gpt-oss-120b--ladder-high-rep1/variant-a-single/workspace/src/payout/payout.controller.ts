import { Controller, HttpCode, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  @HttpCode(202)
  async executePayments(): Promise<void> {
    await this.payoutService.executePayments();
  }

  @Post('reconcile')
  @HttpCode(202)
  async reconcile(): Promise<void> {
    const now = new Date();
    const from = new Date(now.getTime() - 15 * 60 * 1000);
    await this.payoutService.reconcile({ from, to: now });
  }
}
