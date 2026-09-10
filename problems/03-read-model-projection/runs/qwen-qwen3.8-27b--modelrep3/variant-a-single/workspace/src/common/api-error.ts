/**
 * Application error carrying the snake_case `code` that is part of the API
 * contract, rendered by ErrorEnvelopeFilter into the standard envelope.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
