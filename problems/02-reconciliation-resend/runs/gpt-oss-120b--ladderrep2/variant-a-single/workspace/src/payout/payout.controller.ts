import { Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(): Promise<{ message: string }> {
    await this.payoutService.executePayments();
    return { message: 'Execution started' };
  }

  @Post('reconcile')
  async reconcile(): Promise<{ message: string }> {
    // For simplicity we reconcile the last hour
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    await this.payoutService.reconcile({ start, end: now });
    return { message: 'Reconciliation run' };
  }
}
