/**
 * Domain errors carry the public error contract: a snake_case `code` (the
 * stable API contract), a developer-facing English message, and a `details`
 * object (never null). The global exception filter serializes these into the
 * single error envelope.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInputError extends DomainError {
  constructor(details: Record<string, unknown>, message = 'Invalid request input') {
    super('invalid_input', message, 400, details);
  }
}

export class AnchorConflictError extends DomainError {
  constructor(
    details: Record<string, unknown>,
    message = 'An anchor already exists for this (document, version) with different content',
  ) {
    super('anchor_conflict', message, 409, details);
  }
}

export class UniqueViolationError extends DomainError {
  constructor(details: Record<string, unknown>, message = 'A record with the same unique key already exists') {
    super('unique_violation', message, 409, details);
  }
}

export class ChainError extends DomainError {
  constructor(details: Record<string, unknown>, message = 'The chain client reported an error') {
    super('chain_error', message, 502, details);
  }
}
