import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  404: 'resource_not_found',
  409: 'conflict',
};

/**
 * Every error leaves the API through one envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODE_BY_STATUS[status] ?? 'error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        code = typeof body.code === 'string' ? body.code : CODE_BY_STATUS[status] ?? 'error';
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (Array.isArray(body.message)) {
          message = body.message.join('; ');
        }
      }
      if (status >= 500) {
        // Never leak internals of an unexpected error.
        code = 'internal_error';
        message = 'An unexpected error occurred.';
      }
    } else {
      this.logger.error(
        'unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ error: { code, message, details: {} } });
  }
}
