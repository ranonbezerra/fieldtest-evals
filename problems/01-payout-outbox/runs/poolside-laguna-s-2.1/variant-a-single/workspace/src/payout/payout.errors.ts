import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientFundsException extends HttpException {
  constructor(accountId: string) {
    super(
      {
        error: {
          code: 'insufficient_funds',
          message: 'Account does not have sufficient available funds for this payout',
          details: { accountId },
        },
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class AccountNotFoundException extends HttpException {
  constructor(accountId: string) {
    super(
      {
        error: {
          code: 'account_not_found',
          message: `Account with id '${accountId}' was not found`,
          details: { accountId },
        },
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class InvalidAmountException extends HttpException {
  constructor(raw: string) {
    super(
      {
        error: {
          code: 'invalid_amount',
          message: 'Amount must be a valid non-negative integer string',
          details: { amount: raw },
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
