import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

const STATUS_TO_CODE: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  410: 'gone',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
};

/**
 * Guarantees the single error envelope for every failure, including errors
 * raised in global middleware:
 * `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details ?? {};
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? 'invalid_request';
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        const raw = (response as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join('; ') : String(raw);
      }
    } else if (exception instanceof Error && exception.message) {
      message = exception.message;
    }

    if (status >= 500) {
      console.error(exception);
    }

    res.status(status).json({ error: { code, message, details } });
  }
}
