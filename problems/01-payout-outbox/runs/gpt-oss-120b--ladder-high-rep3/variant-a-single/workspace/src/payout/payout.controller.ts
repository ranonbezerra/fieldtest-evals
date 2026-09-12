import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { Payout } from '@prisma/client';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPayoutDto: CreatePayoutDto): Promise<Payout> {
    return this.payoutService.createPayout(createPayoutDto);
  }
}
