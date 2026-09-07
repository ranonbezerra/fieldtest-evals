import { Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

/** Base class for domain errors. `code` is snake_case and is the API contract. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DocumentNotFoundError extends AppError {
  constructor(documentId: string, version: number) {
    super(
      'document_not_found',
      `No structured content is available for document "${documentId}" version ${version}.`,
      404,
      { documentId, version },
    );
  }
}

export class AnchorNotFoundError extends AppError {
  constructor(documentId: string, version: number) {
    super(
      'anchor_not_found',
      `No anchor exists for document "${documentId}" version ${version}.`,
      404,
      { documentId, version },
    );
  }
}

export class AnchorFailedError extends AppError {
  constructor(documentId: string, version: number, cause: string) {
    super(
      'anchor_failed',
      `The anchor for document "${documentId}" version ${version} is in a failed state: ${cause}`,
      409,
      { documentId, version, cause },
    );
  }
}

export class ValidationError extends AppError {
  constructor(issues: string[]) {
    super('invalid_request', `Request validation failed: ${issues.join('; ')}`, 400, { issues });
  }
}

/** Raised by the repository when the (document, version) unique constraint trips. */
export class UniqueConstraintViolationError extends AppError {
  constructor() {
    super('unique_constraint_violation', 'An anchor already exists for this (document, version).', 409, {});
  }
}

const NEST_STATUS_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'route_not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  415: 'unsupported_media_type',
  422: 'unprocessable_request',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

/** Every error leaves the process as the single `{ error: { code, message, details } }` envelope. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = NEST_STATUS_CODES[status] ?? 'http_error';
      const payload = exception.getResponse();
      message = typeof payload === 'string' ? payload : exception.message;
    }

    res.status(status).json({ error: { code, message, details } });
  }
}
