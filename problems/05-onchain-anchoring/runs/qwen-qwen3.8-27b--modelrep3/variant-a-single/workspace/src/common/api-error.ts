/**
 * Domain error carrying a snake_case `code` (the contract), an HTTP status and
 * developer-facing details. Rendered as the single error envelope by the
 * global exception filter.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
