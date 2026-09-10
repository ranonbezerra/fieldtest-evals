import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type { CreatePayoutInput } from './payout.repository.js';
import { PayoutService, type PayoutDto } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Post()
  @HttpCode(201)
  async createPayout(@Body() rawBody: unknown): Promise<PayoutDto> {
    const input = parseCreatePayoutBody(rawBody);
    return this.payouts.createPayout(input);
  }
}

function parseCreatePayoutBody(raw: unknown): CreatePayoutInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('body must be a JSON object', 'body');
  }
  const body = raw as Record<string, unknown>;
  return {
    accountId: requireNonEmptyString(body.accountId, 'accountId'),
    amount: parseAmount(body.amount),
    destinationAddress: requireNonEmptyString(body.destinationAddress, 'destinationAddress'),
    idempotencyKey: requireNonEmptyString(body.idempotencyKey, 'idempotencyKey'),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} must be a non-empty string`, field);
  }
  return value;
}

/** Amounts are minor units: a positive integer as a numeric string or a safe integer. */
function parseAmount(value: unknown): bigint {
  if (typeof value === 'string' && /^\d{1,19}$/.test(value)) {
    const amount = BigInt(value);
    if (amount > 0n) {
      return amount;
    }
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    if (value > 0) {
      return BigInt(value);
    }
  }
  throw invalid('amount must be a positive integer in minor units (numeric string or integer)', 'amount');
}

function invalid(message: string, field: string): ApiError {
  return new ApiError(400, 'validation_error', message, { field });
}
