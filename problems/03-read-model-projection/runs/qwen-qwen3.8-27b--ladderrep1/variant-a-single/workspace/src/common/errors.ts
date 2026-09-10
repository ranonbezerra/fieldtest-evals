export type ErrorCode = 'resource_not_found' | 'validation_failed' | 'conflict' | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(404, 'resource_not_found', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'validation_failed', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'conflict', message, details);
  }
}
