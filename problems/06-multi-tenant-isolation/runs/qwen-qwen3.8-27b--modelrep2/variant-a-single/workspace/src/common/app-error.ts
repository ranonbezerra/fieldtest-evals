export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Application error carrying its HTTP status, a stable snake_case code and
 * structured details. The global filter (and the tenant-resolution
 * middleware) render these into the single error envelope.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, message, details } };
}
