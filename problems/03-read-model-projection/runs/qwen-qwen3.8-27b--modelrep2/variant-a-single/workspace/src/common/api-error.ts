/**
 * Application error. The global filter maps it into the single error envelope:
 * { error: { code, message, details } } — `code` (snake_case) is the contract.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
