import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_server_error';
    let message = 'Internal server error';
    let details = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseObj = exception.getResponse();

      if (typeof responseObj === 'object' && responseObj !== null) {
        const resp = responseObj as any;
        message = resp.message || resp.error || exception.message;
        if (resp.code) {
          code = resp.code;
        }
        if (resp.details) {
          details = resp.details;
        }
      } else {
        message = responseObj as string;
      }
    }

    // Map generic status codes to default error codes if not set explicitly
    if (code === 'internal_server_error') {
      if (status === HttpStatus.NOT_FOUND) {
        code = 'resource_not_found';
      } else if (status === HttpStatus.FORBIDDEN) {
        code = 'forbidden';
      } else if (status === HttpStatus.UNAUTHORIZED) {
        code = 'unauthenticated';
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        details,
      },
    });
  }
}
