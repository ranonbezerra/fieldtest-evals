import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { ErrorCode, PayoutError } from './payout.errors.js';
import { CreatePayoutDto, PayoutView } from './payout.types.js';
import { PayoutService } from './payout.service.js';

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  resource_not_found: 404,
  insufficient_funds: 409,
  duplicate_idempotency_key: 409,
};

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutView> {
    try {
      const dto = this.validate(body);
      return await this.service.createPayout(dto);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private validate(body: unknown): CreatePayoutDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new PayoutError('invalid_request', 'Request body must be a JSON object');
    }

    const raw = body as Record<string, unknown>;

    return {
      accountId: this.requireString(raw.accountId, 'accountId'),
      amount: this.parseAmount(raw.amount),
      destinationAddress: this.requireString(raw.destinationAddress, 'destinationAddress'),
      idempotencyKey: this.requireString(raw.idempotencyKey, 'idempotencyKey'),
    };
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayoutError('invalid_request', `${field} must be a non-empty string`);
    }
    return value;
  }

  private parseAmount(value: unknown): bigint {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
      }
    }
    throw new PayoutError(
      'invalid_request',
      'amount must be a non-negative integer in minor units (number or numeric string)',
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        ERROR_STATUS[err.code],
      );
    }
    // ASSUMPTION: the plan defines no code for unexpected failures, but the one-envelope
    // convention requires a snake_case code, so they are mapped to 500 internal_error.
    return new HttpException(
      { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
      500,
    );
  }
}
