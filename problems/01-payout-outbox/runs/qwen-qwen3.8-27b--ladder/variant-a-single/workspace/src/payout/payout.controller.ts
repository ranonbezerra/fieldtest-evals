import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { PayoutService } from './payout.service';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  create(
    @Body()
    body: {
      accountId?: string;
      amount?: number;
      destinationAddress?: string;
      idempotencyKey?: string;
    },
  ) {
    if (!body.accountId || typeof body.accountId !== 'string') {
      throw new BadRequestException('accountId is required and must be a string');
    }
    if (
      body.amount === undefined ||
      typeof body.amount !== 'number' ||
      !Number.isInteger(body.amount) ||
      body.amount <= 0
    ) {
      throw new BadRequestException('amount must be a positive integer (minor units)');
    }
    if (!body.destinationAddress || typeof body.destinationAddress !== 'string') {
      throw new BadRequestException('destinationAddress is required and must be a string');
    }
    if (!body.idempotencyKey || typeof body.idempotencyKey !== 'string') {
      throw new BadRequestException('idempotencyKey is required and must be a string');
    }

    return this.payoutService.create(
      body.accountId,
      body.amount,
      body.destinationAddress,
      body.idempotencyKey,
    );
  }
}
