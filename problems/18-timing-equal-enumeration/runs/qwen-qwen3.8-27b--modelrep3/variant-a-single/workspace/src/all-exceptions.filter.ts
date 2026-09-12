import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request',
  401: 'invalid_credentials',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'unprocessable_request',
  429: 'too_many_requests',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let envelope: ErrorEnvelope = {
      error: { code: 'internal_error', message: 'Internal server error.', details: {} },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      envelope = isEnvelope(body) ? body : this.toEnvelope(status, body);
    } else {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(envelope);
  }

  private toEnvelope(status: number, body: unknown): ErrorEnvelope {
    let message = 'Request failed.';
    if (typeof body === 'string') {
      message = body;
    } else if (typeof body === 'object' && body !== null && 'message' in body) {
      const raw = (body as { message: unknown }).message;
      message = Array.isArray(raw) ? raw.join('; ') : String(raw);
    }
    return {
      error: {
        code: CODE_BY_STATUS[status] ?? 'request_failed',
        message,
        details: {},
      },
    };
  }
}

function isEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const error = (body as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}
