/**
 * Typed application error. `code` is the snake_case contract exposed in the
 * single error envelope; `message` is developer-facing English; `details` is
 * an object, never null.
 */
export class ApiException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}
