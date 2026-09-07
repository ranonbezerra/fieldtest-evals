import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from '../exceptions/app.exception.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let body: ErrorBody = {
      error: {
        code: 'internal_error',
        message: 'Internal server error.',
        details: {},
      },
    };

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = {
        error: {
          code: exception.code,
          message: exception.developerMessage,
          details: exception.details ?? {},
        },
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        body = {
          error: {
            code: httpExceptionCode(status),
            message: response,
            details: {},
          },
        };
      } else if (typeof response === 'object' && response !== null && 'error' in response) {
        const raw = response as {
          error?: {
            code?: string;
            message?: string;
            details?: Record<string, unknown>;
          };
        };

        body = {
          error: {
            code: typeof raw.error?.code === 'string' ? raw.error.code : httpExceptionCode(status),
            message: typeof raw.error?.message === 'string' ? raw.error.message : exception.message,
            details: raw.error?.details ?? {},
          },
        };
      } else {
        body = {
          error: {
            code: httpExceptionCode(status),
            message: exception.message,
            details: {},
          },
        };
      }
    }

    res.status(status).json(body);
  }
}

function httpExceptionCode(status: number): string {
  if (status === 400) {
    return 'bad_request';
  }
  if (status === 401) {
    return 'unauthorized';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'resource_not_found';
  }
  if (status === 409) {
    return 'conflict';
  }
  if (status >= 500) {
    return 'internal_error';
  }
  return 'http_error';
}
