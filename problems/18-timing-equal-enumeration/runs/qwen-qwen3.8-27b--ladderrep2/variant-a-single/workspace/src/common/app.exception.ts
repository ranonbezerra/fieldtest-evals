/**
 * Application-level error carrying the single error-envelope fields.
 * Thrown by the layers; shaped into the envelope by AllExceptionsFilter.
 */
export class AppException extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppException';
  }
}
