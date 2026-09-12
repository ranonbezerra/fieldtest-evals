import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter as NestExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from './api-exception.js';

const GENERIC_CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  500: 'internal_error',
  503: 'service_unavailable',
};

/** Maps every thrown error to the single { error: { code, message, details } } envelope. */
@Catch()
export class ExceptionFilter implements NestExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    res.status(status).json({ error: { code, message, details } });
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof ApiException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as Record<string, unknown>).message ?? exception.message);
      return { status, code: GENERIC_CODE_BY_STATUS[status] ?? 'error', message, details: {} };
    }
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: `unexpected error: ${error.message}`,
      details: { exception: error.name },
    };
  }
}
