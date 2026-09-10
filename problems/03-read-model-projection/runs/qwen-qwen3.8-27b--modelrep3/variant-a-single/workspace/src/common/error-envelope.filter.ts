import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
  [HttpStatus.CONFLICT]: 'conflict',
};

interface Envelope {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.toEnvelope(exception);
    res.status(status).json({ error: { code, message, details } });
  }

  private toEnvelope(exception: unknown): Envelope {
    if (exception instanceof ApiError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        return { status, code: 'internal_error', message: 'Internal server error', details: {} };
      }

      const body = exception.getResponse();
      let message = exception.message;
      let details: Record<string, unknown> = {};
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = 'Request validation failed';
          details = { fields: record.message };
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
        if (record.details && typeof record.details === 'object') {
          details = { ...details, ...(record.details as Record<string, unknown>) };
        }
      }

      return { status, code: CODE_BY_STATUS[status] ?? 'request_error', message, details };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Internal server error',
      details: {},
    };
  }
}
