import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** An HTTP error whose body already carries the one-envelope contract. */
export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } } as ErrorEnvelope, status);
  }

  getEnvelope(): ErrorEnvelope {
    return this.getResponse() as ErrorEnvelope;
  }
}

const GENERIC_CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
};

/** Renders every error as the single { error: { code, message, details } } envelope. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json(exception.getEnvelope());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const envelope: ErrorEnvelope = {
        error: {
          code: GENERIC_CODE_BY_STATUS[status] ?? 'internal_error',
          message: exception.message,
          details: {},
        },
      };
      response.status(status).json(envelope);
      return;
    }

    const envelope: ErrorEnvelope = {
      error: { code: 'internal_error', message: 'An unexpected error occurred.', details: {} },
    };
    response.status(500).json(envelope);
  }
}
