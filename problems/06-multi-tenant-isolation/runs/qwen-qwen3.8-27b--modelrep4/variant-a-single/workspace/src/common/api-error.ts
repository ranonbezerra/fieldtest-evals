import { HttpException } from '@nestjs/common';

/**
 * Base error for every error the API can produce. Carries the HTTP status and
 * the `code` that forms the public contract; the exception filter shapes it
 * into the single envelope `{ error: { code, message, details } }`.
 */
export class ApiError extends HttpException {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'validation_failed', message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(404, 'resource_not_found', message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(409, code, message, details);
  }
}
