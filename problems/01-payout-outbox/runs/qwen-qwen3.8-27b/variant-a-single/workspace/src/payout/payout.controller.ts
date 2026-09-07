import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Payout } from '@prisma/client';
import { validationError } from '../common/errors';
import { CreatePayoutInput, PayoutService } from './payout.service';

const MAX_ACCOUNT_ID = 64;
const MAX_DESTINATION = 256;
const MAX_IDEMPOTENCY_KEY = 128;
// Conservative cap: well inside int64 range for the ledger columns.
const MAX_AMOUNT = 2n ** 62n;

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  async create(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const input = this.parseBody(body);
    const { payout, created } = await this.payoutService.createPayout(input);
    // 201 on creation, 200 on an idempotent replay of the same key.
    res.status(created ? 201 : 200).json(toPayoutDto(payout));
  }

  private parseBody(body: unknown): CreatePayoutInput {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw validationError({ body: 'must be a JSON object' });
    }
    const fields = body as Record<string, unknown>;
    return {
      accountId: nonEmptyString(fields.accountId, 'accountId', MAX_ACCOUNT_ID),
      amount: parseMinorUnits(fields.amount, 'amount'),
      destinationAddress: nonEmptyString(fields.destinationAddress, 'destinationAddress', MAX_DESTINATION),
      idempotencyKey: nonEmptyString(fields.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY),
    };
  }
}

function nonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError({ [field]: 'must be a non-empty string' });
  }
  if (value.length > max) {
    throw validationError({ [field]: `must be at most ${max} characters` });
  }
  return value;
}

/** Money is integer minor units; floating point is rejected by construction. */
function parseMinorUnits(value: unknown, field: string): bigint {
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    raw = value.toString();
  } else {
    throw validationError({ [field]: 'must be a positive integer in minor units (number or integer string)' });
  }
  if (!/^\d+$/.test(raw)) {
    throw validationError({ [field]: 'must be a positive integer in minor units (no sign, no decimals)' });
  }
  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw validationError({ [field]: 'must be greater than zero' });
  }
  if (amount > MAX_AMOUNT) {
    throw validationError({ [field]: 'exceeds the maximum representable amount' });
  }
  return amount;
}

/** BigInt is not JSON-serializable; amounts cross the wire as strings. */
export function toPayoutDto(payout: Payout) {
  return {
    id: payout.id,
    accountId: payout.accountId,
    idempotencyKey: payout.idempotencyKey,
    destinationAddress: payout.destinationAddress,
    amount: payout.amount.toString(),
    status: payout.status,
    txHash: payout.txHash,
    failureReason: payout.failureReason,
    createdAt: payout.createdAt.toISOString(),
    updatedAt: payout.updatedAt.toISOString(),
  };
}
