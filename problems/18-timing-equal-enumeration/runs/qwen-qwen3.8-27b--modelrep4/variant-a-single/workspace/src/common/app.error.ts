/**
 * Application-level failure. ErrorEnvelopeFilter renders it as the standard
 * error envelope; `code` is the public contract (snake_case) and `details`
 * is always an object, never null.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
