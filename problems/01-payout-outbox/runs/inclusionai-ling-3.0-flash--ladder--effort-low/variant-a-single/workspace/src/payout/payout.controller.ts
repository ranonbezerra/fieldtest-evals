import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutInput } from './payout.types';
import { KnownError } from '../common/filters/exception.filter';
import type { Payout } from '@prisma/client';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(201)
  async createPayout(@Body() body: unknown): Promise<Payout> {
    const input = this.validateAndExtract(body);
    return this.payoutService.createPayout(input);
  }

  private validateAndExtract(body: unknown): CreatePayoutInput {
    if (body === null || body === undefined || typeof body !== 'object') {
      throw new KnownError('invalid_input', 'Request body must be a JSON object', 400);
    }

    const b = body as Record<string, unknown>;

    const accountId = b.accountId;
    const amount = b.amount;
    const destinationAddress = b.destinationAddress;
    const idempotencyKey = b.idempotencyKey;

    if (typeof accountId !== 'string' || !accountId) {
      throw new KnownError('invalid_input', 'accountId is required', 400);
    }
    if (typeof destinationAddress !== 'string' || !destinationAddress) {
      throw new KnownError('invalid_input', 'destinationAddress is required', 400);
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
      throw new KnownError('invalid_input', 'idempotencyKey is required', 400);
    }
    if (typeof amount === 'number' && Number.isInteger(amount) && amount > 0) {
      return {
        accountId,
        amount: BigInt(amount),
        destinationAddress,
        idempotencyKey,
      };
    }
    if (typeof amount === 'bigint' && amount > 0n) {
      return { accountId, amount, destinationAddress, idempotencyKey };
    }
    throw new KnownError('invalid_amount', 'amount must be a positive integer (bigint in minor units)', 400);
  }
}
