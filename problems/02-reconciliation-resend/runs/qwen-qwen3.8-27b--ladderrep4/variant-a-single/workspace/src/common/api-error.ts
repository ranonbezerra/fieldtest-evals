/**
 * Application error carrying the stable snake_case `code` of the error
 * envelope. The message is developer-facing English; `details` is always an
 * object (never null).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
