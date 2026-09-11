import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error carrying the stable snake_case `code` (the contract), a
 * developer-facing message, and structured details (always an object).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    super(message);
  }
}

const HTTP_STATUS_TO_CODE: Record<number, string> = {
  400: 'invalid_input',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  422: 'unprocessable_entity',
};

/** Shapes every response error into the single `{ error: { code, message, details } }` envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const error = exception;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Unexpected server error.';
    let details: Record<string, unknown> = {};

    if (error instanceof ApiError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = HTTP_STATUS_TO_CODE[status] ?? 'request_error';
      const body = error.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const nested = (body as { message?: unknown }).message;
        if (typeof nested === 'string') {
          message = nested;
        }
      }
      details = {};
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
