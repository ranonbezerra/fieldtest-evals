import { HttpException } from '@nestjs/common';

/**
 * Business exception that carries the error-envelope fields. The global filter
 * serializes every exception into `{ error: { code, message, details } }`.
 */
export class DomainError extends HttpException {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, httpStatus);
    this.message = message;
  }
}

export function validationError(details: Record<string, unknown> = {}): DomainError {
  return new DomainError(400, 'validation_error', 'Request validation failed.', details);
}

export function resourceNotFound(resource: string, id: string): DomainError {
  return new DomainError(404, 'resource_not_found', `${resource} ${id} was not found.`, { resource, id });
}

export function insufficientFunds(accountId: string, available: bigint, requested: bigint): DomainError {
  return new DomainError(
    409,
    'insufficient_funds',
    'The account does not have sufficient available funds for this payout.',
    { accountId, available: available.toString(), requested: requested.toString() },
  );
}
