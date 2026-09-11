import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from './app-exception.js';

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessable_entity',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'internal_error',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = STATUS_CODES[status] ?? 'internal_error';
    let message: string = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppException) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details ?? {};
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'internal_error';

      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        message = String((response as { message: unknown }).message);
      } else {
        message = 'Request failed';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (res.headersSent) {
      return;
    }

    res.status(status).json({ error: { code, message, details } });
  }
}
