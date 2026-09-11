import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

import { RefreshRejectedError } from '../auth/refresh-rejected.error.js';

/**
 * One error envelope for every failure:
 * { "error": { "code": "<snake_case>", "message": "...", "details": {} } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof RefreshRejectedError) {
      response.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        error: { code: 'http_error', message: exception.message, details: {} },
      });
      return;
    }

    response.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error.', details: {} },
    });
  }
}
