import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * The single error envelope for the whole API:
 *   { "error": { "code": "...", "message": "...", "details": {} } }
 * `code` is snake_case and is the contract; `details` is always an object,
 * never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorEnvelope } {
    if (exception instanceof DomainException) {
      return {
        status: exception.httpStatus,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const err = (payload as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
        if (err && typeof err.code === 'string') {
          return {
            status,
            body: {
              error: {
                code: err.code,
                message: typeof err.message === 'string' ? err.message : exception.message,
                details: (err.details as Record<string, unknown> | undefined) ?? {},
              },
            },
          };
        }
      }
      const code =
        status === 400
          ? 'validation_error'
          : status === 404
            ? 'not_found'
            : status === 409
              ? 'conflict'
              : status === 422
                ? 'unprocessable_content'
                : 'http_error';
      return { status, body: { error: { code, message: exception.message, details: {} } } };
    }
    return { status: 500, body: { error: { code: 'internal_error', message: 'internal server error', details: {} } } };
  }
}
