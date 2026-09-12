import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PayoutService, ReconcileWindow } from './payout.service.js';
import { IsDateString } from 'class-validator';

class ExecutePaymentsDto {}

class ReconcileDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  @HttpCode(HttpStatus.ACCEPTED)
  async executePayments(@Body() _dto: ExecutePaymentsDto): Promise<void> {
    await this.payoutService.executePayments();
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Body() dto: ReconcileDto): Promise<void> {
    const window: ReconcileWindow = {
      start: new Date(dto.start),
      end: new Date(dto.end),
    };
    await this.payoutService.reconcile(window);
  }
}
