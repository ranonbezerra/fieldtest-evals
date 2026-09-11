import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { RefreshRejected } from '../auth/refresh-rejected.exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

function envelope(code: string, message: string, details: Record<string, unknown> = {}): ErrorEnvelope {
  return { error: { code, message, details } };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof RefreshRejected) {
      res
        .status(HttpStatus.UNAUTHORIZED)
        .json(envelope('invalid_refresh_token', 'The refresh token was not accepted.'));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code =
        typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string'
          ? (body as { code: string }).code
          : `http_${status}`;
      res.status(status).json(envelope(code, exception.message));
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(envelope('internal_error', 'An unexpected error occurred.'));
  }
}
