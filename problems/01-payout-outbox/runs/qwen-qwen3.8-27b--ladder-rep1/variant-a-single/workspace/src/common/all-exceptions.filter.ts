import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { ApiError } from './api-error.js';

type HttpResponse = { status: (code: number) => { json: (body: unknown) => void } };

/**
 * Single error envelope for every response:
 * `{ "error": { "code": "...", "message": "...", "details": {} } }`.
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();

    if (exception instanceof ApiError) {
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    response.status(500).json({
      error: { code: 'internal_error', message: 'unexpected internal error', details: {} },
    });
  }
}
