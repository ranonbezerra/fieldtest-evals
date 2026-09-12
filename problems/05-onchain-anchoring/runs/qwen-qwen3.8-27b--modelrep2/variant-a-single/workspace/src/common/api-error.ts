/**
 * Base class for expected API failures. `code` is the snake_case contract
 * surfaced in the error envelope; `message` is developer-facing English.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
