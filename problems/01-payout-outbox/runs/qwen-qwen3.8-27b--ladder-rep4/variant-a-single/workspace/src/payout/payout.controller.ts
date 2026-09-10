import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { errorEnvelope } from '../common/error-envelope.js';
import {
  AccountNotFound,
  InsufficientFundsError,
  PayoutValidationError,
} from './payout.errors.js';
import { parseAmount, PayoutService } from './payout.service.js';

export interface PayoutRequestBody {
  accountId?: unknown;
  amount?: unknown;
  destinationAddress?: unknown;
  idempotencyKey?: unknown;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: PayoutRequestBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body must be a JSON object', {
          body: 'missing or not an object',
        }),
      );
    }

    const details: Record<string, string> = {};
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      details.accountId = 'accountId is required and must be a non-empty string';
    }
    if (
      typeof body.destinationAddress !== 'string' ||
      body.destinationAddress.length === 0
    ) {
      details.destinationAddress =
        'destinationAddress is required and must be a non-empty string';
    }
    if (
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.length === 0
    ) {
      details.idempotencyKey =
        'idempotencyKey is required and must be a non-empty string';
    }
    if (Object.keys(details).length > 0) {
      throw new BadRequestException(
        errorEnvelope('validation_error', 'Request body is invalid', details),
      );
    }

    let amount: bigint;
    try {
      amount = parseAmount(body.amount);
    } catch (e) {
      if (e instanceof PayoutValidationError) {
        throw new BadRequestException(
          errorEnvelope('validation_error', 'Request body is invalid', e.details),
        );
      }
      throw e;
    }

    const accountId = body.accountId as string;
    const destinationAddress = body.destinationAddress as string;
    const idempotencyKey = body.idempotencyKey as string;

    try {
      const payout = await this.service.createPayout({
        accountId,
        amount,
        destinationAddress,
        idempotencyKey,
      });
      return this.service.toView(payout);
    } catch (e) {
      if (e instanceof AccountNotFound) {
        throw new NotFoundException(
          errorEnvelope('account_not_found', e.message, {
            accountId,
          }),
        );
      }
      if (e instanceof InsufficientFundsError) {
        throw new UnprocessableEntityException(
          errorEnvelope('insufficient_funds', e.message, {
            available: e.available.toString(),
            requested: e.requested.toString(),
          }),
        );
      }
      throw e;
    }
  }
}
