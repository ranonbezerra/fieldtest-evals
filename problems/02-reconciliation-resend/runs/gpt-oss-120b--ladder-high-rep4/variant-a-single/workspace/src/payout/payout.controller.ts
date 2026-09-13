import { Controller, Post, Body, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { IsString, IsInt, IsDateString, IsPositive } from 'class-validator';

class CreatePayoutDto {
  @IsString()
  supplierKey: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsDateString()
  effectiveDate: string; // ISO 8601 string
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto) {
    try {
      const payout = await this.payoutService.createPayout(dto.supplierKey, dto.amount, new Date(dto.effectiveDate));
      return payout;
    } catch (err) {
      const error = err as Error;
      throw new HttpException(
        { error: { code: 'creation_failed', message: error.message, details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const payout = await this.payoutService.getPayoutById(Number(id));
    if (!payout) {
      throw new HttpException(
        { error: { code: 'resource_not_found', message: `Payout ${id} not found`, details: {} } },
        HttpStatus.NOT_FOUND,
      );
    }
    return payout;
  }
}
