import { HttpException } from '@nestjs/common';

/**
 * Domain errors carry the API-contract code (snake_case, stable). Known codes:
 * resource_not_found, validation_failed, invalid_state_transition, conflict,
 * internal_error.
 */
export class DomainException extends HttpException {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
