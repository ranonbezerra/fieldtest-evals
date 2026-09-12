import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from './api-exception.js';

const STATUS_TO_CODE: Record<number, string> = {
  400: 'invalid_request',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'unprocessable',
};

/**
 * Serializes every exception into the single error envelope so callers can
 * rely on `error.code` as the contract.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error.';
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? 'internal_error';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = 'Request validation failed.';
          details = { issues: record.message.map((issue) => String(issue)) };
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
      }
    } else {
      console.error(exception);
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
