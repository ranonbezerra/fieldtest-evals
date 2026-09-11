/**
 * Application-level error carrying the public error envelope contract:
 * { error: { code, message, details } }. `code` is snake_case and is the
 * contract; `message` is developer-facing English; `details` is always an object.
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
