/**
 * Application error. `code` is the snake_case contract consumed by clients;
 * `message` is developer-facing English; `details` is always an object.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly httpStatus: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(resource: string, id: string): AppError {
    return new AppError('resource_not_found', `${resource} with id ${id} was not found`, { resource, id }, 404);
  }

  static validation(message: string, details: Record<string, unknown>): AppError {
    return new AppError('validation_error', message, details, 400);
  }
}
