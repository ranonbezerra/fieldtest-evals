import { Body, Controller, Inject, Post } from '@nestjs/common';
import { PayoutError, PayoutService, type PayoutDto } from './payout.service';
import type { CreatePayoutInput } from './payout.repository';

const MAX_ACCOUNT_ID_LENGTH = 64;
const MAX_DESTINATION_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
/** Reasonable payout ceiling in minor units (10^15). */
const MAX_AMOUNT_MINOR = 10n ** 15n;

@Controller('payouts')
export class PayoutController {
  constructor(@Inject(PayoutService) private readonly payoutService: PayoutService) {}

  @Post()
  async createPayout(@Body() rawBody: unknown): Promise<PayoutDto> {
    return this.payoutService.createPayout(this.parseCreateInput(rawBody));
  }

  private parseCreateInput(rawBody: unknown): CreatePayoutInput {
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      throw new PayoutError(400, 'invalid_request', 'request body must be a JSON object', {});
    }
    const body = rawBody as Record<string, unknown>;
    const fields: Record<string, string> = {};

    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (accountId.length < 1 || accountId.length > MAX_ACCOUNT_ID_LENGTH) {
      fields.accountId = 'must be a non-empty string of at most 64 characters';
    }

    const amountMinor = this.parseAmount(body.amount, fields);

    const destinationAddress =
      typeof body.destinationAddress === 'string' ? body.destinationAddress.trim() : '';
    if (destinationAddress.length < 1 || destinationAddress.length > MAX_DESTINATION_LENGTH) {
      fields.destinationAddress = 'must be a non-empty string of at most 128 characters';
    }

    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (idempotencyKey.length < 1 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      fields.idempotencyKey = 'must be a non-empty string of at most 128 characters';
    }

    if (Object.keys(fields).length > 0) {
      throw new PayoutError(400, 'invalid_request', 'request body is invalid', { fields });
    }

    return { accountId, amountMinor, destinationAddress, idempotencyKey };
  }

  /** Amounts are integer minor units; floating point is rejected. */
  private parseAmount(value: unknown, fields: Record<string, string>): bigint {
    let digits: string | null = null;
    if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
      digits = value.toString();
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      digits = value;
    } else {
      fields.amount = 'must be a positive integer in minor units (number or numeric string)';
    }
    if (digits === null) {
      return 0n;
    }
    const amountMinor = BigInt(digits);
    if (amountMinor <= 0n) {
      fields.amount = 'must be greater than zero (minor units)';
    } else if (amountMinor > MAX_AMOUNT_MINOR) {
      fields.amount = 'exceeds the maximum payout size';
    }
    return amountMinor;
  }
}
