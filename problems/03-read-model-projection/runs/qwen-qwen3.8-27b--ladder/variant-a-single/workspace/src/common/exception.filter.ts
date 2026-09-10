import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

// Single error envelope for every failure:
//   { "error": { "code": "snake_case", "message": "...", "details": {} } }
// `code` is the contract; `message` is developer-facing English; `details` is
// always an object, never null.
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EnvelopeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = (record.message as string[]).join('; ');
          details = { fields: record.message };
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const code = this.codeFor(status);
    if (status >= 500) {
      this.logger.error(
        `Unhandled error (${code}): ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ error: { code, message, details } });
  }

  private codeFor(status: number): string {
    switch (status) {
      case 400:
        return 'validation_failed';
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'resource_not_found';
      case 409:
        return 'conflict';
      default:
        return 'internal_error';
    }
  }
}
