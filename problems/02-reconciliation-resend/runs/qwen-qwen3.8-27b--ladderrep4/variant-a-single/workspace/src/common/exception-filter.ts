import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/**
 * The single error envelope for the API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiError) {
      this.write(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.message;
      this.write(
        response,
        status,
        status === 404 ? 'resource_not_found' : 'request_rejected',
        typeof message === 'string' ? message : 'Request rejected',
        {},
      );
      return;
    }
    this.write(response, 500, 'internal_error', 'Unexpected server error', {});
  }

  private write(
    response: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): void {
    response.status(status).json({ error: { code, message, details } });
  }
}
