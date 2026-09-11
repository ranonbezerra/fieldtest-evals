import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ServiceError } from '../common/service-error.js';
import { PayoutService, type PayoutDto } from './payout.service.js';

// 10^15 — far below Number.MAX_SAFE_INTEGER, so JSON number amounts stay exact.
const MAX_PAYOUT_AMOUNT_MINOR = 1_000_000_000_000_000;

interface CreatePayoutResponse {
  payout: PayoutDto;
  replayed: boolean;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<CreatePayoutResponse> {
    const issues = validateCreatePayoutBody(body);
    if (issues.length > 0) {
      throw new ServiceError(400, 'validation_failed', 'the request body is invalid', { issues });
    }
    const b = body as Record<string, unknown>;
    const result = await this.service.createPayout({
      accountId: b.accountId as string,
      amountMinor: BigInt(b.amount as number),
      destinationAddress: b.destinationAddress as string,
      idempotencyKey: b.idempotencyKey as string,
    });
    return { payout: result.payout, replayed: result.replayed };
  }
}

/** Controller-level shape validation only; no business logic here. */
function validateCreatePayoutBody(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['body must be a JSON object'];
  }
  const b = body as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof b.accountId !== 'string' || b.accountId.length === 0 || b.accountId.length > 64) {
    issues.push('accountId must be a non-empty string of at most 64 characters');
  }
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > MAX_PAYOUT_AMOUNT_MINOR) {
    issues.push(`amount must be a positive integer in minor units (max ${MAX_PAYOUT_AMOUNT_MINOR})`);
  }
  if (typeof b.destinationAddress !== 'string' || b.destinationAddress.length === 0 || b.destinationAddress.length > 256) {
    issues.push('destinationAddress must be a non-empty string of at most 256 characters');
  }
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.length === 0 || b.idempotencyKey.length > 128) {
    issues.push('idempotencyKey must be a non-empty string of at most 128 characters');
  }
  return issues;
}
