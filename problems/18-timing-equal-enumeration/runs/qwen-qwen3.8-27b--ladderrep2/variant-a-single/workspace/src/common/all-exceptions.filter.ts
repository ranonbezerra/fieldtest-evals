import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppException } from './app.exception.js';

const CODES_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  401: 'invalid_credentials',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  422: 'unprocessable_input',
};

interface EnvelopeError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * Every error leaves the process as the single envelope:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, error } = this.toEnvelope(exception);
    if (status >= 500) {
      console.error('Unhandled error while handling a request:', exception);
    }
    response.status(status).json({ error });
  }

  private toEnvelope(exception: unknown): { status: number; error: EnvelopeError } {
    if (exception instanceof AppException) {
      return {
        status: exception.status,
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { status, error: { code: this.codeFor(status), message: body, details: {} } };
      }
      const record = body as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : this.codeFor(status);
      const message =
        typeof record.message === 'string'
          ? record.message
          : Array.isArray(record.message)
            ? record.message.join('; ')
            : exception.message;
      const details =
        typeof record.details === 'object' && record.details !== null
          ? (record.details as Record<string, unknown>)
          : {};
      return { status, error: { code, message, details } };
    }
    return { status: 500, error: { code: 'internal_error', message: 'Internal server error.', details: {} } };
  }

  private codeFor(status: number): string {
    return CODES_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'invalid_input');
  }
}
