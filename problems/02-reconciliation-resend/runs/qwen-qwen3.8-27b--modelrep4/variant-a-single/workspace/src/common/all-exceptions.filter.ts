import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { HttpError } from './http-error.js';

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'resource_not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable_entity';
    case 429:
      return 'too_many_requests';
    case 503:
      return 'service_unavailable';
    default:
      return 'internal_error';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse() as {
      status(code: number): { json(body: unknown): void };
    };

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details ?? {};
    } else {
      const possible = exception as { status?: unknown; message?: unknown } | null;
      if (typeof possible?.status === 'number') {
        status = possible.status;
      }
      if (Array.isArray(possible?.message)) {
        message = possible.message.join('; ');
      } else if (typeof possible?.message === 'string') {
        message = possible.message;
      }
      code = codeForStatus(status);
    }

    if (status >= 500) {
      console.error(exception);
    }

    response.status(status).json({
      error: { code, message, details },
    });
  }
}
