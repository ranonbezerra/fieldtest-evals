export class PayoutDomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends PayoutDomainError {
  constructor(accountId: string) {
    super(`Account ${accountId} does not exist`, 'account_not_found', 404, { accountId });
  }
}

export class InsufficientFundsError extends PayoutDomainError {
  constructor(accountId: string) {
    super(
      `Account ${accountId} does not have sufficient available funds for this payout`,
      'insufficient_funds',
      422,
      { accountId },
    );
  }
}

export class InvalidAmountError extends PayoutDomainError {
  constructor(amount: string) {
    super(
      `Amount ${JSON.stringify(amount)} must be a positive integer in minor units`,
      'invalid_amount',
      400,
      { amount },
    );
  }
}

export class DuplicateIdempotencyKeyError extends PayoutDomainError {
  constructor(accountId: string, idempotencyKey: string) {
    super(
      `A payout already exists for this idempotency key`,
      'duplicate_idempotency_key',
      409,
      { accountId, idempotencyKey },
    );
  }
}
