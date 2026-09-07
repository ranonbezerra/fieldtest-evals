import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from './errors';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/** Single error envelope for the whole API: `{ error: { code, message, details } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const body: ErrorEnvelope = {
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
      res.status(exception.httpStatus).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ErrorEnvelope = {
        error: {
          code: status >= 500 ? 'internal_error' : 'http_error',
          message: exception.message,
          details: {},
        },
      };
      res.status(status).json(body);
      return;
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    const body: ErrorEnvelope = {
      error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} },
    };
    res.status(500).json(body);
  }
}
