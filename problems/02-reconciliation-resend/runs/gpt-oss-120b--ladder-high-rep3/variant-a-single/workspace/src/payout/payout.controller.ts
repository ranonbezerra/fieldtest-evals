import { Controller, Post, Body } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { IsISO8601 } from 'class-validator';

class ReconcileDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async executePayments(): Promise<{ message: string }> {
    await this.payoutService.executePayments();
    return { message: 'Payments execution triggered' };
  }

  @Post('reconcile')
  async reconcile(@Body() dto: ReconcileDto): Promise<{ message: string }> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    await this.payoutService.reconcile({ start, end });
    return { message: 'Reconciliation completed' };
  }
}
