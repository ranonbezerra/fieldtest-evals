import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';
import { PayoutDto } from './dto/payout.dto.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPayoutDto: CreatePayoutDto): Promise<PayoutDto> {
    return this.payoutService.createPayout(createPayoutDto);
  }
}
