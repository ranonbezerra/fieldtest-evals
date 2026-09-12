/**
 * Base class for errors that carry the single error-envelope contract:
 * { error: { code, message, details } }. `code` is the snake_case contract,
 * `message` is developer-facing English, `details` is always an object.
 */
export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
