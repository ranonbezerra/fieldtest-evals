/** A domain error carrying a stable wire code; the global filter renders the envelope. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(accountId: string) {
    super('account_not_found', 404, `Account ${accountId} does not exist.`, { accountId });
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(accountId: string, requested: bigint, available: bigint) {
    super('insufficient_funds', 422, 'The account does not have enough available funds for this payout.', {
      accountId,
      requestedMinorUnits: requested.toString(),
      availableMinorUnits: available.toString(),
    });
  }
}

export class ValidationError extends DomainError {
  constructor(problems: string[]) {
    super('validation_error', 400, 'Request body is invalid.', { problems });
  }
}
