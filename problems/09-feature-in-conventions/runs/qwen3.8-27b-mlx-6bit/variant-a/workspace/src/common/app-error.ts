/**
 * Every failure the API returns is one of these. `code` is the contract: the
 * client maps it to copy. Adding a code is normal; inventing an envelope is not.
 */
export type AppErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'internal';

const STATUS: Record<AppErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  internal: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }

  static notFound(message = 'not found', details: Record<string, unknown> = {}): AppError {
    return new AppError('not_found', message, details);
  }

  static conflict(message: string, details: Record<string, unknown> = {}): AppError {
    return new AppError('conflict', message, details);
  }

  static validation(message: string, details: Record<string, unknown> = {}): AppError {
    return new AppError('validation_failed', message, details);
  }
}
