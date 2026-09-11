/**
 * Application-level error with a stable, snake_case machine-readable code.
 * The global exception filter turns it into the single error envelope:
 * { error: { code, message, details } }
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
