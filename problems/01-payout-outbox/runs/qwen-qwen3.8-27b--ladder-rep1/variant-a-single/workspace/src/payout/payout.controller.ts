import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { PayoutService } from './payout.service.js';
import type { PayoutResponse } from './payout.service.js';

// `amount` arrives as a decimal string of minor units; the money path is
// bigint end to end (no number, no floating point).
const AMOUNT_PATTERN = /^[1-9]\d{0,14}$/;

@Controller('payouts')
export class PayoutController {
  constructor(@Inject(PayoutService) private readonly payouts: PayoutService) {}

  @Post()
  create(@Body() body: unknown): Promise<PayoutResponse> {
    const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const accountId = this.requireString(value, 'accountId', 191);
    const amount = this.requireAmount(value);
    const destinationAddress = this.requireString(value, 'destinationAddress', 512);
    const idempotencyKey = this.requireString(value, 'idempotencyKey', 191);
    return this.payouts.createPayout({ accountId, amount, destinationAddress, idempotencyKey });
  }

  private requireString(value: Record<string, unknown>, field: string, maxLength: number): string {
    const v = value[field];
    if (typeof v !== 'string' || v.length === 0 || v.length > maxLength) {
      throw new ApiError(
        400,
        'invalid_request',
        `${field} must be a non-empty string of at most ${maxLength} characters`,
        { field },
      );
    }
    return v;
  }

  private requireAmount(value: Record<string, unknown>): bigint {
    const v = value.amount;
    if (typeof v !== 'string' || !AMOUNT_PATTERN.test(v)) {
      throw new ApiError(
        400,
        'invalid_request',
        'amount must be a positive integer in minor units, sent as a decimal string',
        { field: 'amount' },
      );
    }
    return BigInt(v);
  }
}
