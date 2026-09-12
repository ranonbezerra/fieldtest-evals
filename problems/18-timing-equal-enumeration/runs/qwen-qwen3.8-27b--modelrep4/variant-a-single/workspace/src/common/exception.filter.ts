import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app.error';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'too_many_requests',
};

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the contract; `details` is always an object, never null.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      ({ status, code, details } = exception);
      message = exception.message;
    } else if (exception instanceof HttpException) {
      // Nest's own exceptions (e.g. 404 on an unknown route) get a stable
      // code instead of leaking framework internals.
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'request_error');
      message = this.extractMessage(exception);
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ error: { code, message, details } });
  }

  private extractMessage(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return body;
    }
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    return exception.message;
  }
}
