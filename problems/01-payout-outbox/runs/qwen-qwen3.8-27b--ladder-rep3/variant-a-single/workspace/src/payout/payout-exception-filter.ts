import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { PayoutDomainError } from './payout-errors.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** Every error leaves the process in one envelope shape. */
@Catch()
export class PayoutExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PayoutExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof PayoutDomainError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus();
      const body = exception.getResponse();
      if (
        httpStatus === HttpStatus.BAD_REQUEST &&
        typeof body === 'object' &&
        body !== null &&
        'message' in body
      ) {
        code = 'invalid_input';
        message = 'The request is invalid';
        const raw = (body as { message: unknown }).message;
        details = { violations: (Array.isArray(raw) ? raw : [raw]).map(String) };
      } else {
        status = httpStatus;
        code = 'http_error';
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }
}
