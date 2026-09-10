import { NotFoundException } from '@nestjs/common';

export class AccountNotFound extends NotFoundException {
  constructor(accountId: string) {
    super(`Account ${accountId} was not found`);
  }
}

export class InsufficientFundsError extends Error {
  constructor(readonly available: bigint, readonly requested: bigint) {
    super(
      `Available funds ${available.toString()} are less than requested ${requested.toString()}`,
    );
  }
}

export class PayoutValidationError extends Error {
  constructor(readonly details: Record<string, string>) {
    super('Request body is invalid');
  }
}
