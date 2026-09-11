import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

interface Envelope {
  code: string;
  status: number;
  message: string;
  details: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { code, status, message, details } = this.toEnvelope(exception);
    response.status(status).json({ error: { code, message, details } });
  }

  private toEnvelope(exception: unknown): Envelope {
    if (exception instanceof ApiError) {
      return {
        code: exception.code,
        status: exception.status,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as Record<string, unknown>).message ?? exception.message);
      return { code: this.codeForStatus(status), status, message, details: {} };
    }
    const message = exception instanceof Error ? exception.message : 'Unexpected error.';
    return { code: 'internal_error', status: 500, message, details: {} };
  }

  private codeForStatus(status: number): string {
    if (status === 400) {
      return 'invalid_input';
    }
    if (status === 404) {
      return 'resource_not_found';
    }
    if (status === 409) {
      return 'conflict';
    }
    return 'internal_error';
  }
}
