/**
 * Base class for domain errors. `code` is the snake_case contract carried in
 * the error envelope; `httpStatus` is the transport status.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 500,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('resource_not_found', `The ${resource} with id ${id} was not found`, 404, {
      [resource]: id,
    });
  }
}

export class InsufficientFundsError extends AppError {
  constructor(accountId: string, requestedMinor: bigint, availableMinor: bigint) {
    super(
      'insufficient_funds',
      'The account does not have sufficient available funds for this payout',
      409,
      {
        accountId,
        requestedMinor: requestedMinor.toString(),
        availableMinor: availableMinor.toString(),
      },
    );
  }
}
