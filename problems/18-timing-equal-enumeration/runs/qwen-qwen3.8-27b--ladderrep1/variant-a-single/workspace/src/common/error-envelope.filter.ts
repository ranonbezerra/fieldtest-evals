import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * Single error envelope for the whole API:
 * { "error": { "code": ..., "message": ..., "details": ... } }.
 * `code` is the stable contract; `message` is developer-facing English.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.describe(exception);
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { status, code: this.codeForStatus(status), message: body, details: {} };
      }
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const inner = record.error;
        if (this.isPlainObject(inner)) {
          return {
            status,
            code: typeof inner.code === 'string' ? inner.code : this.codeForStatus(status),
            message:
              typeof inner.message === 'string' ? inner.message : this.codeForStatus(status),
            details: this.isPlainObject(inner.details) ? inner.details : {},
          };
        }
        return {
          status,
          code: this.codeForStatus(status),
          message: typeof record.message === 'string' ? record.message : 'Request failed.',
          details: {},
        };
      }
      return { status, code: this.codeForStatus(status), message: 'Request failed.', details: {} };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Unexpected server error.',
      details: {},
    };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'resource_not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'validation_failed';
      default:
        return 'error';
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
