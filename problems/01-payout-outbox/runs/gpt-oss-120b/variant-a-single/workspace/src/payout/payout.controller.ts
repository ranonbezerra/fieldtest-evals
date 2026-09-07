// src/payout/payout.controller.ts

import { Controller, Post, Body } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutDto } from './dto/create-payout.dto';

// ASSUMPTION: PayoutService has a method `create(dto: CreatePayoutDto): Promise<any>`
// that handles the business logic and returns the created payout entity.
// ASSUMPTION: CreatePayoutDto is a valid class exposing the fields required by the API
// (accountId, amount, destinationAddress, idempotencyKey).

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() createPayoutDto: CreatePayoutDto) {
    // The controller delegates all business logic to the service.
    // It simply validates the request body (via DTO) and returns the result.
    return this.payoutService.create(createPayoutDto);
  }
}
