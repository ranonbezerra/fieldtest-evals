import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppException } from './app.exception.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppException) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details ?? {};
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        code = status === 404 ? 'resource_not_found' : status === 400 ? 'invalid_input' : 'request_error';
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        code =
          typeof record.code === 'string'
            ? record.code
            : status === 404
              ? 'resource_not_found'
              : status === 400
                ? 'invalid_input'
                : 'request_error';
        message = typeof record.message === 'string' ? record.message : exception.message;
        details =
          record.details && typeof record.details === 'object' && !Array.isArray(record.details)
            ? (record.details as Record<string, unknown>)
            : {};
      } else {
        message = exception.message;
      }
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
