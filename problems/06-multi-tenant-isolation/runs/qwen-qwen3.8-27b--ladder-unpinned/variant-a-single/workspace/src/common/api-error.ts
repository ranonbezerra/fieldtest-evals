import { HttpException } from '@nestjs/common';

/**
 * The single error type for the whole API. Every failure is serialised as
 * { error: { code, message, details } } by the global exception filter and by
 * the tenant middleware (which responds before Nest's filters would run).
 * `code` is snake_case and is the contract; `details` is always an object.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SerializedError {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export function toApiError(error: unknown): SerializedError {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code =
      status === 404
        ? 'resource_not_found'
        : status === 401
          ? 'unauthenticated'
          : status === 403
            ? 'forbidden'
            : status === 400
              ? 'validation_failed'
              : 'http_error';
    return { status, code, message: error.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'An unexpected error occurred.', details: {} };
}
