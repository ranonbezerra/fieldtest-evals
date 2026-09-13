import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    const details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'code' in resp) {
        response.status(status).json(resp);
        return;
      }
      if (typeof resp === 'string') {
        message = resp;
      } else if (
        typeof resp === 'object' &&
        resp !== null &&
        'message' in resp
      ) {
        message = (resp as any).message;
      }
      switch (status) {
        case HttpStatus.NOT_FOUND:
          code = 'resource_not_found';
          break;
        case HttpStatus.BAD_REQUEST:
          code = 'bad_request';
          break;
        default:
          code = 'internal_error';
      }
    }

    const errorEnvelope: ErrorEnvelope = {
      error: {
        code,
        message,
        details,
      },
    };

    response.status(status).json(errorEnvelope);
  }
}
