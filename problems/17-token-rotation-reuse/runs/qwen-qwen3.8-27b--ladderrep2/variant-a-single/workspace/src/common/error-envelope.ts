import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorEnvelopeBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * An error that renders into the single error envelope:
 * { "error": { "code": ..., "message": ..., "details": { ... } } }
 */
export class EnvelopeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof EnvelopeError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      } satisfies ErrorEnvelopeBody);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string' ? raw : (raw as { message?: unknown }).message ?? 'Request could not be processed.';
      res.status(status).json({
        error: { code: `http_${status}`, message: String(message), details: {} },
      } satisfies ErrorEnvelopeBody);
      return;
    }

    res.status(500).json({
      error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} },
    } satisfies ErrorEnvelopeBody);
  }
}
