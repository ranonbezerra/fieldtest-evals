import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

interface HttpWriter {
  status(code: number): { json(body: unknown): void };
}

const FALLBACK_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_error',
};

/**
 * Single error envelope for the whole API:
 * { "error": { "code": string, "message": string, "details": object } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private static readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as HttpWriter;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'internal server error';
    let details: Record<string, unknown> = {};
    let explicitCode = false;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body !== null && typeof body === 'object') {
        const obj = body as { error?: unknown; message?: unknown };
        if (obj.error !== null && typeof obj.error === 'object') {
          const err = obj.error as { code?: unknown; message?: unknown; details?: unknown };
          if (typeof err.code === 'string') {
            code = err.code;
            explicitCode = true;
          }
          if (typeof err.message === 'string') message = err.message;
          if (err.details !== null && typeof err.details === 'object' && !Array.isArray(err.details)) {
            details = err.details as Record<string, unknown>;
          }
        } else if (typeof obj.message === 'string') {
          message = obj.message;
        }
      }
    } else if (exception instanceof Error && exception.message !== '') {
      message = exception.message;
    }

    if (!explicitCode) {
      code = FALLBACK_CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
    }

    if (status >= 500) {
      AllExceptionsFilter.logger.error(
        `unhandled exception: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      );
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
