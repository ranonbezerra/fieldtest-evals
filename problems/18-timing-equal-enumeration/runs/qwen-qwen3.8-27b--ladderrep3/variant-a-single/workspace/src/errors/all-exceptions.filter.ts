import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** The single error envelope used by every error response in the API. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

function fallbackCode(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'authentication_failed';
    case 403:
      return 'forbidden';
    case 404:
      return 'resource_not_found';
    default:
      return 'internal_error';
  }
}

function asEnvelope(value: unknown): ErrorEnvelope | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  if (typeof e.code !== 'string' || typeof e.message !== 'string') {
    return null;
  }
  if (typeof e.details !== 'object' || e.details === null) {
    return null;
  }
  return { error: { code: e.code, message: e.message, details: e.details as Record<string, unknown> } };
}

/**
 * Forces every error response through the single envelope
 * { error: { code, message, details } }. Payloads already thrown in envelope
 * form pass through untouched; anything else is shaped into the envelope.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let envelope: ErrorEnvelope = {
      error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      const preformatted = asEnvelope(payload);
      if (preformatted !== null) {
        envelope = preformatted;
      } else {
        const message = typeof payload === 'string' ? payload : exception.message;
        envelope = { error: { code: fallbackCode(status), message, details: {} } };
      }
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    response.status(status).json(envelope);
  }
}
