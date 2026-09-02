import { Controller, Post, Body } from '@nestjs/common';
import { PayoutsService, ReconcileResult } from './payouts.service.js';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Post('execute')
  async execute(
    @Body() body: { effectiveDate: string },
  ): Promise<{ sent: number; rejected: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)) {
      throw new Error('invalid_date_format');
    }
    const effectiveDate = new Date(`${body.effectiveDate}T00:00:00.000Z`);
    return this.service.executePayments(effectiveDate);
  }

  @Post('reconcile')
  async reconcile(@Body() body: { date: string }): Promise<ReconcileResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new Error('invalid_date_format');
    }
    return this.service.reconcile(body.date);
  }
}
