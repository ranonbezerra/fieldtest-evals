import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { CreatePayoutDto } from './dto/create-payout.dto.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    try {
      const payout = await this.payoutService.createPayout(dto);
      return payout;
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        {
          error: {
            code: 'internal_error',
            message: err.message,
            details: {},
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
