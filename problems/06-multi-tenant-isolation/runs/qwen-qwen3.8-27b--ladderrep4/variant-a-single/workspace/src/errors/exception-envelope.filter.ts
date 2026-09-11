import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConflictError, ResourceNotFoundError, TenantMismatchError, UnauthenticatedError } from './exceptions.js';
import type { ErrorEnvelope } from './error-envelope.js';

const STATUS_BY_TYPE: Array<[new (...args: never[]) => unknown, number]> = [
  [ResourceNotFoundError, 404],
  [ConflictError, 409],
  [UnauthenticatedError, 401],
  [TenantMismatchError, 403],
];

function toCode(exception: unknown): string {
  if (exception instanceof Error && exception.name) {
    return exception.name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }
  return 'internal_error';
}

function statusOf(exception: unknown): number {
  for (const [type, status] of STATUS_BY_TYPE) {
    if (exception instanceof type) return status;
  }
  if (exception instanceof HttpException) return exception.getStatus();
  return 500;
}

function extractMessage(exception: unknown): string {
  if (exception instanceof Error && exception.message) return exception.message;
  if (typeof exception === 'string') return exception;
  return 'Internal server error';
}

@Catch()
export class ExceptionEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const status = statusOf(exception);
    const message = extractMessage(exception);
    const envelope: ErrorEnvelope = {
      error: { code: toCode(exception), message, details: {} },
    };
    if (status >= 500) {
      // developer-facing only; never leak internals to the client
      // eslint-disable-next-line no-console
      console.error(`[unhandled] ${req.method} ${req.url}`, exception);
    }
    res.status(status).json(envelope);
  }
}
