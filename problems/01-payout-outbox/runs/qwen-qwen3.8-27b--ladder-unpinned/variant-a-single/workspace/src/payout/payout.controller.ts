import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';

// ASSUMPTION: PayoutService.createPayout accepts { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }

@Controller('payouts')
export class PayoutController {
  constructor(
    private readonly payoutService: PayoutService,
  ) {}

  @Post()
  @HttpCode(201)
  async createPayout(
    @Body()
    body: {
      accountId?: unknown;
      amount?: unknown;
      destinationAddress?: unknown;
      idempotencyKey?: unknown;
    },
  ) {
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'validation_error',
          message: 'accountId must be a non-empty string',
          details: {},
        },
      });
    }
    if (
      typeof body.amount !== 'number' ||
      !Number.isSafeInteger(body.amount) ||
      body.amount <= 0
    ) {
      throw new BadRequestException({
        error: {
          code: 'validation_error',
          message: 'amount must be a positive safe integer (minor units)',
          details: {},
        },
      });
    }
    if (
      typeof body.destinationAddress !== 'string' ||
      body.destinationAddress.length === 0
    ) {
      throw new BadRequestException({
        error: {
          code: 'validation_error',
          message: 'destinationAddress must be a non-empty string',
          details: {},
        },
      });
    }
    if (
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.length === 0
    ) {
      throw new BadRequestException({
        error: {
          code: 'validation_error',
          message: 'idempotencyKey must be a non-empty string',
          details: {},
        },
      });
    }

    return this.payoutService.createPayout({
      accountId: body.accountId,
      amount: BigInt(body.amount),
      destinationAddress: body.destinationAddress,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
