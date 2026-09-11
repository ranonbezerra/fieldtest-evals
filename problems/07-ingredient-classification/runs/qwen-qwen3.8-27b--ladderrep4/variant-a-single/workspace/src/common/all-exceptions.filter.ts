import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, type ErrorCode } from './errors.js';

/**
 * Single error envelope for the whole API:
 * { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 * `code` is the contract, `message` is developer-facing English, and
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code: ErrorCode = 'internal_error';
    let message = 'An unexpected error occurred.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null && 'message' in body) {
        message = String((body as { message: unknown }).message);
      }
      if (status === 404) code = 'resource_not_found';
      else if (status === 400) code = 'invalid_request';
      else if (status === 409) code = 'duplicate_version';
      else code = 'internal_error';
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
