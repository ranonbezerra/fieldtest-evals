import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Application error carrying the single error envelope contract:
 * { "error": { "code": snake_case, "message": "...", "details": {} } }
 * `code` is the contract; `details` is always an object, never null.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Normalises every failure — ours or unexpected — into the one envelope. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { statusCode, error } = this.toBody(exception);
    response.status(statusCode).json({ error });
  }

  private toBody(exception: unknown): {
    statusCode: number;
    error: { code: string; message: string; details: Record<string, unknown> };
  } {
    if (exception instanceof ApiError) {
      return {
        statusCode: exception.statusCode,
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }
    const message = exception instanceof Error ? exception.message : 'unknown error';
    return {
      statusCode: 500,
      error: { code: 'internal_error', message: `unhandled error: ${message}`, details: {} },
    };
  }
}
