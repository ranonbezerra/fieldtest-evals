import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './errors.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number;
    let body: ErrorEnvelope;

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = { error: { code: exception.code, message: exception.message, details: exception.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        error: {
          code: CODE_BY_STATUS[status] ?? 'internal_error',
          message: exception.message,
          details: {},
        },
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { error: { code: 'internal_error', message: 'Unexpected server error', details: {} } };
    }

    response.status(status).json(body);
  }
}
