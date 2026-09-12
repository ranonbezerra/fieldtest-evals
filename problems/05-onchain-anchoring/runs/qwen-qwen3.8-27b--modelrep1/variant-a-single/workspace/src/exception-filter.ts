import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainError } from './errors.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Maps every exception to the single error envelope:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as {
      status(code: number): { json(payload: unknown): void };
    };

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Unexpected server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        status === HttpStatus.NOT_FOUND
          ? 'resource_not_found'
          : status === HttpStatus.BAD_REQUEST
            ? 'invalid_input'
            : 'http_error';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null && 'message' in body) {
        const m = (body as { message?: unknown }).message;
        if (typeof m === 'string') message = m;
      }
    } else if (exception instanceof Error) {
      // Log the real error server-side; never leak internals to the client.
      console.error('Unhandled exception', exception);
    }

    const payload: ErrorResponse = { error: { code, message, details } };
    res.status(status).json(payload);
  }
}
