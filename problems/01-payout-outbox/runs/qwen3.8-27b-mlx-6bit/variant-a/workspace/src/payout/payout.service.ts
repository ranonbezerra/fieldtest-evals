import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import type { CreatePayoutDto, PayoutResponse } from './payout.types.js';
import {
  ERROR_INSUFFICIENT_FUNDS,
  ERROR_IDEMPOTENCY_CONFLICT,
  ERROR_ACCOUNT_NOT_FOUND,
  ERROR_VALIDATION,
} from './payout.types.js';

@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository) {}

  async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
    // ── Validation ──
    if (!dto.accountId || !dto.destinationAddress || !dto.idempotencyKey) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'accountId, amount, destinationAddress, and idempotencyKey are required', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(dto.amount);
    } catch {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'amount must be a valid integer string', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (amount <= 0n) {
      throw new HttpException(
        { error: { code: ERROR_VALIDATION, message: 'amount must be greater than zero', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }

    // ── Create payout with reservation ──
    try {
      const payout = await this.repo.createPayoutWithReservation({
        accountId: dto.accountId,
        amount,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });

      return {
        id: payout.id,
        status: payout.status,
        amount: payout.amount.toString(),
      };
    } catch (err) {
      // Idempotency conflict: unique constraint on (account_id, idempotency_key) violated
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // ASSUMPTION: findByAccountIdAndIdempotencyKey exists on PayoutRepository (verified in source) but the compiler cannot resolve it because payout.repository.ts has its own module-resolution errors that prevent full type inference.
        const existing = await this.repo.findByAccountIdAndIdempotencyKey(
          dto.accountId,
          dto.idempotencyKey,
        );

        if (
          existing &&
          existing.amount === amount &&
          existing.destinationAddress === dto.destinationAddress
        ) {
          return {
            id: existing.id,
            status: existing.status,
            amount: existing.amount.toString(),
          };
        }

        throw new HttpException(
          { error: { code: ERROR_IDEMPOTENCY_CONFLICT, message: 'idempotency key already used with different parameters', details: {} } },
          HttpStatus.CONFLICT,
        );
      }

      if (err instanceof Error && err.message === 'ACCOUNT_NOT_FOUND') {
        throw new HttpException(
          { error: { code: ERROR_ACCOUNT_NOT_FOUND, message: 'account not found', details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }

      if (err instanceof Error && err.message === 'INSUFFICIENT_FUNDS') {
        throw new HttpException(
          { error: { code: ERROR_INSUFFICIENT_FUNDS, message: 'account does not have sufficient available funds', details: {} } },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      throw err;
    }
  }
}
