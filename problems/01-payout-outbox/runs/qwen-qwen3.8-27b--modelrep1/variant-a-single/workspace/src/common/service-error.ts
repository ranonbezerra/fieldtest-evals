/**
 * Base class for domain errors. The global exception filter renders these as the
 * single error envelope: { error: { code, message, details } }.
 * `code` is snake_case and is the stable API contract.
 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends ServiceError {
  constructor(accountId: string) {
    super(404, 'resource_not_found', `account '${accountId}' was not found`, {
      resource: 'account',
      id: accountId,
    });
  }
}

export class InsufficientFundsError extends ServiceError {
  constructor(availableMinor: bigint, requestedMinor: bigint) {
    super(409, 'insufficient_funds', 'the account does not have sufficient available funds for this payout', {
      available_minor: Number(availableMinor),
      requested_minor: Number(requestedMinor),
    });
  }
}
