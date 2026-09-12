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
    let errorResponse = {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        details: {},
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'error' in resp) {
        errorResponse = resp as any;
      } else {
        const message = (exception.message || 'Error') as string;
        const code = this.mapStatusToCode(status);
        errorResponse = {
          error: {
            code,
            message,
            details: {},
          },
        };
      }
    } else if (exception instanceof Error) {
      const message = exception.message || 'Error';
      errorResponse = {
        error: {
          code: 'internal_error',
          message,
          details: {},
        },
      };
    }

    response.status(status).json(errorResponse);
  }

  private mapStatusToCode(status: number): string {
    const map: { [key: number]: string } = {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'resource_not_found',
      409: 'conflict',
    };
    return map[status] ?? 'error';
  }
}
