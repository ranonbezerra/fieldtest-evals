import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

import { InsufficientFundsError, PayoutService } from './payout.service.js';
import type { CreatePayoutInput, PayoutResponse } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>): Promise<PayoutResponse> {
    const required = ['accountId', 'amount', 'destinationAddress', 'idempotencyKey'] as const;
    const missing = required.filter((field) => body[field] === undefined || body[field] === null);

    if (missing.length > 0) {
      throw new HttpException(
        {
          error: {
            code: 'validation_error',
            message: `Missing required fields: ${missing.join(', ')}`,
            details: { missing },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const input: CreatePayoutInput = {
      accountId: body.accountId as string,
      amount: BigInt(body.amount as string | number),
      destinationAddress: body.destinationAddress as string,
      idempotencyKey: body.idempotencyKey as string,
    };

    try {
      return await this.payoutService.createPayout(input);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new HttpException(
          {
            error: {
              code: error.code,
              message: error.message,
              details: {},
            },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }
}
