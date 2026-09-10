export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('resource_not_found', message, details);
  }
}

export class InsufficientFundsError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('insufficient_funds', message, details);
  }
}
